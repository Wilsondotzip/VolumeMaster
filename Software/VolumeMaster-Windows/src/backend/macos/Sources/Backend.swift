import CoreAudio
import Foundation

/// macOS port of the Windows backend (src/backend/main.pyw).
///
/// Reads `value@index` lines from the serial device named in config.yaml,
/// applies volume changes to mapped targets, and reports over the same
/// stdout protocol that backend-process.js parses:
///   ERROR:COM_PORT:<msg>          serial problems
///   STATUS:SERIAL_OK              serial connected
///   ERROR:AUDIO_UNAVAILABLE:<msg> audio system problems
///   STATUS:AUDIO_OK               audio recovered
///   ERROR:VM_NOT_RUNNING:<msg>    Voicemeeter (unsupported on macOS)
///   VOLUME:<index>:<value>        applied volume change
final class Backend {
    private let configPath = FileManager.default.currentDirectoryPath + "/config.yaml"

    private var config = Config()
    private var volumes: [Int: Int] = [:]
    private let serial = SerialPort()
    private var serialConnected = false
    private var reconnectSerial = false

    private let appVolume = AppVolumeController()
    private var masterDevice: AudioDeviceID?
    private var micDevices: [String: AudioDeviceID] = [:] // lowercased wanted name → device
    private var audioAvailable = true
    private var vmWarned = false

    private var lastAudioRefresh = Date.distantPast
    private var lastConfigMtime: Date?
    private var lastReloadTime = Date.distantPast

    func run() {
        signal(SIGPIPE, SIG_IGN)

        if CommandLine.arguments.contains("--list-inputs") {
            for device in AudioController.inputDevices() {
                emit(device.name)
            }
            return
        }

        do {
            config = try Config.load(path: configPath)
        } catch {
            emit("ERROR:COM_PORT:Could not read config.yaml: \(error.localizedDescription)")
            exit(1)
        }
        lastConfigMtime = configMtime()
        volumes = [:]
        warnIfVoicemeeterEnabled()
        setupAudioInterfaces()

        while true {
            checkConfigChanged()

            if reconnectSerial, serial.isOpen {
                reconnectSerial = false
                serial.close()
                serialConnected = false
            }

            if !serial.isOpen {
                if !connectSerial() {
                    refreshAudioIfDue()
                    Thread.sleep(forTimeInterval: 2)
                    continue
                }
                emit("STATUS:SERIAL_OK")
            }

            let lines: [String]
            do {
                lines = try serial.readLines(timeoutMs: 500)
            } catch {
                emit("ERROR:COM_PORT:Device disconnected from serial port.")
                serial.close()
                serialConnected = false
                continue
            }

            // Coalesce to the latest value per knob, then apply changes
            var pending: [Int: Int] = [:]
            var order: [Int] = []
            for line in lines {
                guard line.contains("@") else { continue } // button lines are Voicemeeter-only
                let parts = line.split(separator: "@")
                guard parts.count == 2, let value = Int(parts[0]), let index = Int(parts[1]) else {
                    emit("Malformed input: \(line)")
                    continue
                }
                if pending[index] == nil { order.append(index) }
                pending[index] = value
            }
            for index in order {
                guard let value = pending[index], volumes[index] != value else { continue }
                volumes[index] = value
                processAudioChange(index: index, value: value)
                emit("VOLUME:\(index):\(value)")
            }

            refreshAudioIfDue()
        }
    }

    // MARK: - Serial

    private func connectSerial() -> Bool {
        let port = config.comport
        // Treat Windows-style identifiers as "nothing selected" — a freshly
        // synced config from a Windows install can still say COM3.
        if port.isEmpty || port.uppercased().hasPrefix("COM") {
            reportSerial("ERROR:COM_PORT:No serial port selected. Please select a port in Settings.")
            return false
        }
        do {
            try serial.open(
                path: port,
                baudrate: config.baudrate,
                bytesize: config.bytesize,
                parity: config.parity,
                stopbits: config.stopbits
            )
            serialConnected = true
            return true
        } catch SerialPort.OpenError.notFound {
            reportSerial("ERROR:COM_PORT:\(port) not found. Check the correct port is selected in Settings.")
        } catch SerialPort.OpenError.busy {
            reportSerial("ERROR:COM_PORT:\(port) is in use by another program. Close any serial monitors (Arduino IDE, etc.) and it will reconnect automatically.")
        } catch {
            reportSerial("ERROR:COM_PORT:Cannot open \(port) — \(error)")
        }
        return false
    }

    private var lastSerialError = ""

    private func reportSerial(_ message: String) {
        // The Python backend re-prints every 2s; keep that behaviour only on
        // message change to avoid flooding banners with identical errors.
        if message != lastSerialError {
            lastSerialError = message
            emit(message)
        }
    }

    // MARK: - Audio

    private func setupAudioInterfaces() {
        let wantsMaster = config.mappings.values.contains { entry in
            entry.apps.contains { $0.lowercased() == "master" }
        }
        if wantsMaster {
            masterDevice = AudioController.defaultOutputDevice()
            if masterDevice == nil {
                if audioAvailable {
                    emit("ERROR:AUDIO_UNAVAILABLE:No default audio output device.")
                    audioAvailable = false
                }
                return
            }
        } else {
            masterDevice = nil
        }

        setupMicDevices()
        appVolume.refreshRunningApps()

        if !audioAvailable {
            emit("STATUS:AUDIO_OK")
            audioAvailable = true
        }
    }

    private func setupMicDevices() {
        micDevices.removeAll()

        var wanted = Set<String>()
        for entry in config.mappings.values {
            for name in entry.mics {
                wanted.insert(name.lowercased())
            }
        }
        guard !wanted.isEmpty else { return }

        for device in AudioController.inputDevices() {
            let deviceName = device.name.lowercased()
            for name in wanted where deviceName.contains(name) {
                micDevices[name] = device.id
                break
            }
        }
    }

    private func refreshAudioIfDue() {
        guard Date().timeIntervalSince(lastAudioRefresh) > 2 else { return }
        lastAudioRefresh = Date()
        setupAudioInterfaces()
    }

    private func processAudioChange(index: Int, value: Int) {
        guard let mapping = config.mappings[index] else { return }
        let scalar = Float32(value) / 100

        for name in mapping.apps {
            if name.lowercased() == "master" {
                if let device = masterDevice {
                    AudioController.setVolume(device: device, scope: kAudioObjectPropertyScopeOutput, scalar: scalar)
                }
                continue
            }
            appVolume.setVolume(target: name, value: value)
        }

        for micName in mapping.mics {
            let key = micName.lowercased()
            if let device = micDevices[key] {
                if !AudioController.setVolume(device: device, scope: kAudioObjectPropertyScopeInput, scalar: scalar) {
                    emit("Failed to set mic volume for '\(micName)'")
                }
            } else {
                emit("Mic not found in cache: '\(micName)' — will retry on next refresh")
            }
        }
    }

    // MARK: - Config reload

    private func configMtime() -> Date? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: configPath)
        return attrs?[.modificationDate] as? Date
    }

    private func checkConfigChanged() {
        guard let mtime = configMtime(), mtime != lastConfigMtime else { return }
        lastConfigMtime = mtime
        if Date().timeIntervalSince(lastReloadTime) < 0.5 { return }
        lastReloadTime = Date()

        emit("[Watcher] Config changed, reloading...")
        do {
            let oldPort = config.comport
            config = try Config.load(path: configPath)
            volumes = [:]
            if config.comport != oldPort {
                reconnectSerial = true
                lastSerialError = ""
            }
            warnIfVoicemeeterEnabled()
            setupAudioInterfaces()
            emit("[Watcher] Reloaded successfully.")
        } catch {
            emit("[Watcher] Failed to reload: \(error.localizedDescription)")
        }
    }

    private func warnIfVoicemeeterEnabled() {
        if config.vmEnabled && !vmWarned {
            vmWarned = true
            emit("ERROR:VM_NOT_RUNNING:Voicemeeter is Windows-only and not available on macOS. Voicemeeter mappings and buttons will be ignored.")
        }
    }
}
