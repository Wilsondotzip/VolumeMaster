import CoreAudio
import Foundation

/// CoreAudio access for master output volume and input (microphone) device
/// volume — the macOS equivalent of pycaw's IAudioEndpointVolume usage.
enum AudioController {
    // kAudioHardwareServiceDeviceProperty_VirtualMainVolume ('vmvc'):
    // device-wide volume that CoreAudio maps onto the right channels for us.
    private static let virtualMainVolume = AudioObjectPropertySelector(0x766D_7663)

    static func defaultOutputDevice() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
        )
        guard status == noErr, deviceID != kAudioObjectUnknown else { return nil }
        return deviceID
    }

    /// Sets the volume (0.0–1.0) on a device. Tries the virtual main volume
    /// first, then falls back to per-channel volume scalars.
    @discardableResult
    static func setVolume(device: AudioDeviceID, scope: AudioObjectPropertyScope, scalar: Float32) -> Bool {
        var value = min(max(scalar, 0), 1)
        let size = UInt32(MemoryLayout<Float32>.size)

        var address = AudioObjectPropertyAddress(
            mSelector: virtualMainVolume,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        if isSettable(device: device, address: &address) {
            return AudioObjectSetPropertyData(device, &address, 0, nil, size, &value) == noErr
        }

        var anySet = false
        for channel in [UInt32(kAudioObjectPropertyElementMain), 1, 2] {
            var channelAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyVolumeScalar,
                mScope: scope,
                mElement: channel
            )
            if isSettable(device: device, address: &channelAddress) {
                if AudioObjectSetPropertyData(device, &channelAddress, 0, nil, size, &value) == noErr {
                    anySet = true
                }
            }
        }
        return anySet
    }

    /// All devices that have at least one input channel, with their names.
    static func inputDevices() -> [(id: AudioDeviceID, name: String)] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
        ) == noErr else { return [] }

        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceIDs
        ) == noErr else { return [] }

        return deviceIDs.compactMap { id in
            guard inputChannelCount(device: id) > 0, let name = deviceName(id) else { return nil }
            return (id: id, name: name)
        }
    }

    private static func inputChannelCount(device: AudioDeviceID) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr, size > 0 else {
            return 0
        }
        let bufferList = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { bufferList.deallocate() }
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, bufferList) == noErr else {
            return 0
        }
        let buffers = UnsafeMutableAudioBufferListPointer(bufferList.assumingMemoryBound(to: AudioBufferList.self))
        return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    private static func deviceName(_ device: AudioDeviceID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        let status = withUnsafeMutablePointer(to: &name) {
            AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0)
        }
        guard status == noErr else { return nil }
        return name as String
    }

    private static func isSettable(device: AudioDeviceID, address: inout AudioObjectPropertyAddress) -> Bool {
        guard AudioObjectHasProperty(device, &address) else { return false }
        var settable: DarwinBoolean = false
        guard AudioObjectIsPropertySettable(device, &address, &settable) == noErr else { return false }
        return settable.boolValue
    }
}
