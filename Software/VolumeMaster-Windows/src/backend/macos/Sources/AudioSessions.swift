import CoreAudio
import Foundation

/// Enumerates processes that are currently producing audio — the macOS
/// equivalent of the WASAPI session list the Windows backend reports for
/// the "Audio" process filter.
///
/// Uses the Core Audio process objects API (macOS 14.4+), the same
/// mechanism per-app mixers like FineTune discover audio apps with.
/// On older macOS versions the property doesn't exist and this returns [].
enum AudioSessions {
    private static let processObjectList = AudioObjectPropertySelector(0x7072_7323) // 'prs#' kAudioHardwarePropertyProcessObjectList
    private static let processPID = AudioObjectPropertySelector(0x7070_6964) // 'ppid' kAudioProcessPropertyPID
    private static let isRunningOutput = AudioObjectPropertySelector(0x7069_726F) // 'piro' kAudioProcessPropertyIsRunningOutput

    /// Names of processes currently playing audio, deduplicated. Helper
    /// processes are reported as their outermost .app bundle's executable
    /// (e.g. a Chrome renderer helper becomes "Google Chrome") so the names
    /// line up with the process list shown in the UI.
    static func activeOutputNames() -> [String] {
        var names: [String] = []
        var seen = Set<String>()
        for object in processObjects() {
            guard readUInt32(object: object, selector: isRunningOutput) == 1,
                  let pid = readPID(object: object),
                  let name = processName(pid: pid),
                  seen.insert(name.lowercased()).inserted
            else { continue }
            names.append(name)
        }
        return names
    }

    private static func processObjects() -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(
            mSelector: processObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let systemObject = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(systemObject, &address, 0, nil, &size) == noErr, size > 0 else {
            return []
        }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(systemObject, &address, 0, nil, &size, &objects) == noErr else {
            return []
        }
        return objects
    }

    private static func readUInt32(object: AudioObjectID, selector: AudioObjectPropertySelector) -> UInt32? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }

    private static func readPID(object: AudioObjectID) -> pid_t? {
        var address = AudioObjectPropertyAddress(
            mSelector: processPID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: pid_t = 0
        var size = UInt32(MemoryLayout<pid_t>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }

    private static func processName(pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let path = String(cString: buffer)

        // Report the outermost bundle's executable name so helpers match
        // their parent app's entry in the process list
        let components = path.split(separator: "/")
        if let appIndex = components.firstIndex(where: { $0.hasSuffix(".app") }) {
            let bundlePath = "/" + components[0...appIndex].joined(separator: "/")
            if let executable = Bundle(path: bundlePath)?.executableURL?.lastPathComponent {
                return executable
            }
            return String(components[appIndex].dropLast(4))
        }
        return (path as NSString).lastPathComponent
    }
}
