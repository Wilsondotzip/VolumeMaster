import Foundation
import Yams

struct MappingEntry {
    var apps: [String] = []
    var mics: [String] = []
}

struct Config {
    var comport: String = ""
    var baudrate: Int = 9600
    var bytesize: Int = 8
    var parity: String = "N"
    var stopbits: Int = 1
    var vmEnabled: Bool = false
    var mappings: [Int: MappingEntry] = [:]

    static func load(path: String) throws -> Config {
        let text = try String(contentsOfFile: path, encoding: .utf8)
        let root = (try Yams.load(yaml: text) as? [String: Any]) ?? [:]

        var config = Config()
        config.comport = (root["comport"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        config.baudrate = root["baudrate"] as? Int ?? 9600
        config.bytesize = root["bytesize"] as? Int ?? 8
        config.parity = root["parity"] as? String ?? "N"
        config.stopbits = root["stopbits"] as? Int ?? 1
        config.vmEnabled = root["vm"] as? Bool ?? false

        if let rawMappings = root["Mappings"] as? [String: Any] {
            for (key, value) in rawMappings {
                guard let index = Int(key) else {
                    emit("Invalid mapping key: \(key)")
                    continue
                }
                guard let entry = value as? [String: Any] else { continue }

                var mapping = MappingEntry()
                if let apps = entry["ProcessNames"] as? [Any] {
                    mapping.apps = apps.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }
                }
                if let mics = entry["MicNames"] as? [Any] {
                    mapping.mics = mics.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }
                }
                config.mappings[index] = mapping
            }
        }
        return config
    }
}
