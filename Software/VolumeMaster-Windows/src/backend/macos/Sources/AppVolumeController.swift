import AppKit
import Foundation

/// Per-application volume control.
///
/// macOS has no public per-app audio session API (the Windows backend uses
/// WASAPI sessions via pycaw). The closest native mechanism is AppleScript:
/// media apps such as Spotify, Music, and VLC expose a `sound volume`
/// property. Apps that aren't scriptable are reported once and skipped.
final class AppVolumeController {
    private struct RunningApp {
        let name: String
        let bundleID: String
    }

    // bundle id → compiled script exposing a setvol(v) handler
    private var scripts: [String: NSAppleScript] = [:]
    private var unsupported: Set<String> = []
    private var reportedMissing: Set<String> = []
    private var runningApps: [RunningApp] = []

    /// Refreshes the running-application cache (the macOS analogue of
    /// re-enumerating WASAPI sessions every 2 seconds).
    func refreshRunningApps() {
        runningApps = NSWorkspace.shared.runningApplications.compactMap { app in
            guard let name = app.localizedName, let bundleID = app.bundleIdentifier else { return nil }
            return RunningApp(name: name, bundleID: bundleID)
        }
    }

    /// Applies `value` (0–100) to every running app whose name contains
    /// `target`, matching the substring semantics of the Windows backend.
    func setVolume(target: String, value: Int) {
        var cleaned = target
        if cleaned.lowercased().hasSuffix(".exe") {
            cleaned = String(cleaned.dropLast(4))
        }
        let needle = cleaned.lowercased()
        guard !needle.isEmpty else { return }

        let matches = runningApps.filter { $0.name.lowercased().contains(needle) }
        if matches.isEmpty {
            if !reportedMissing.contains(needle) {
                reportedMissing.insert(needle)
                emit("App not running: '\(cleaned)' — will retry on next refresh")
            }
            return
        }
        reportedMissing.remove(needle)

        var anySucceeded = false
        var failed: [RunningApp] = []
        for app in matches where !unsupported.contains(app.bundleID) {
            if apply(value: value, to: app) {
                anySucceeded = true
            } else {
                unsupported.insert(app.bundleID)
                failed.append(app)
            }
        }
        // Only complain when no matching app accepted the volume — substring
        // matches often include unscriptable helper processes of an app that
        // did accept it (e.g. Music's VisualizerService).
        if !anySucceeded {
            for app in failed {
                emit("'\(app.name)' does not support per-app volume on macOS (app is not AppleScript-controllable). Use a 'master' or mic mapping instead.")
            }
        }
    }

    private func apply(value: Int, to app: RunningApp) -> Bool {
        let script: NSAppleScript
        if let cached = scripts[app.bundleID] {
            script = cached
        } else {
            let source = """
            on setvol(v)
                tell application id "\(app.bundleID)" to set sound volume to v
            end setvol
            """
            guard let compiled = NSAppleScript(source: source) else { return false }
            var compileError: NSDictionary?
            guard compiled.compileAndReturnError(&compileError) else { return false }
            scripts[app.bundleID] = compiled
            script = compiled
        }

        // Call the setvol handler via a subroutine Apple event so the
        // compiled script can be reused for every knob tick.
        let parameters = NSAppleEventDescriptor.list()
        parameters.insert(NSAppleEventDescriptor(int32: Int32(value)), at: 1)

        let event = NSAppleEventDescriptor(
            eventClass: AEEventClass(0x6173_6372), // kASAppleScriptSuite 'ascr'
            eventID: AEEventID(0x7073_6272), // kASSubroutineEvent 'psbr'
            targetDescriptor: nil,
            returnID: AEReturnID(kAutoGenerateReturnID),
            transactionID: AETransactionID(kAnyTransactionID)
        )
        event.setDescriptor(
            NSAppleEventDescriptor(string: "setvol"),
            forKeyword: AEKeyword(0x736E_616D) // keyASSubroutineName 'snam'
        )
        event.setDescriptor(parameters, forKeyword: AEKeyword(0x2D2D_2D2D)) // keyDirectObject '----'

        var error: NSDictionary?
        script.executeAppleEvent(event, error: &error)
        return error == nil
    }
}
