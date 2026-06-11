import AppKit
import Foundation

/// Per-application volume control.
///
/// macOS has no public per-app audio session API (the Windows backend uses
/// WASAPI sessions via pycaw), so two strategies are used:
///
/// 1. FineTune (https://github.com/ronitsingh10/FineTune) — preferred.
///    FineTune is a GPL-3.0 per-app volume mixer built on Core Audio process
///    taps. When it is installed, the backend drives it through its public
///    URL scheme (finetune://set-volumes?app=<bundle-id>&volume=<0-100>),
///    which gives true per-app mixing for any app. The integration is
///    arm's-length (URL API only, no FineTune code is linked or copied).
///
/// 2. AppleScript `sound volume` — fallback when FineTune is not installed.
///    Works only for scriptable media apps (Spotify, Music, VLC, ...).
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

    private var fineTuneInstalled = false
    private var fineTuneAnnounced = false
    private var fineTuneSendFailureReported = false

    /// Refreshes the running-application cache and FineTune availability
    /// (the macOS analogue of re-enumerating WASAPI sessions every 2 seconds).
    func refreshRunningApps() {
        runningApps = NSWorkspace.shared.runningApplications.compactMap { app in
            guard let name = app.localizedName, let bundleID = app.bundleIdentifier else { return nil }
            return RunningApp(name: name, bundleID: bundleID)
        }
        detectFineTune()
    }

    private func detectFineTune() {
        guard let probe = URL(string: "finetune://set-volumes") else { return }
        fineTuneInstalled = NSWorkspace.shared.urlForApplication(toOpen: probe) != nil
        if fineTuneInstalled && !fineTuneAnnounced {
            fineTuneAnnounced = true
            emit("Per-app volume: using FineTune for app mixing (https://github.com/ronitsingh10/FineTune).")
        }
    }

    /// Applies `value` (0–100) to every running app matching one of `targets`.
    /// Matching uses the substring semantics of the Windows backend, but
    /// exact name matches win so "Music" doesn't also hit helper processes.
    func setVolumes(targets: [String], value: Int) {
        var matched: [RunningApp] = []

        for target in targets {
            var cleaned = target
            if cleaned.lowercased().hasSuffix(".exe") {
                cleaned = String(cleaned.dropLast(4))
            }
            let needle = cleaned.lowercased()
            guard !needle.isEmpty else { continue }

            let exact = runningApps.filter { $0.name.lowercased() == needle }
            let matches = exact.isEmpty
                ? runningApps.filter { $0.name.lowercased().contains(needle) }
                : exact
            if matches.isEmpty {
                if !reportedMissing.contains(needle) {
                    reportedMissing.insert(needle)
                    emit("App not running: '\(cleaned)' — will retry on next refresh")
                }
                continue
            }
            reportedMissing.remove(needle)
            matched.append(contentsOf: matches)
        }

        guard !matched.isEmpty else { return }

        var seen = Set<String>()
        let apps = matched.filter { seen.insert($0.bundleID).inserted }

        if fineTuneInstalled {
            sendFineTuneVolumes(bundleIDs: apps.map { $0.bundleID }, value: value)
        } else {
            applyViaAppleScript(apps: apps, value: value)
        }
    }

    // MARK: - FineTune (https://github.com/ronitsingh10/FineTune)

    /// Sends one batched finetune://set-volumes URL for all apps on a knob.
    /// FineTune applies the gain in its process-tap engine; apps that are
    /// not playing audio yet get the value persisted for when they do.
    private func sendFineTuneVolumes(bundleIDs: [String], value: Int) {
        var components = URLComponents()
        components.scheme = "finetune"
        components.host = "set-volumes"
        components.queryItems = bundleIDs.flatMap { id in
            [
                URLQueryItem(name: "app", value: id),
                URLQueryItem(name: "volume", value: String(value)),
            ]
        }
        guard let url = components.url else { return }

        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.open(url, configuration: config) { [weak self] _, error in
            guard let self, let error, !self.fineTuneSendFailureReported else { return }
            self.fineTuneSendFailureReported = true
            emit("FineTune did not accept the volume command (\(error.localizedDescription)). Falling back to AppleScript until it recovers.")
            self.fineTuneInstalled = false  // re-detected on next refresh
        }
    }

    // MARK: - AppleScript fallback

    private func applyViaAppleScript(apps: [RunningApp], value: Int) {
        var anySucceeded = false
        var failed: [RunningApp] = []
        for app in apps where !unsupported.contains(app.bundleID) {
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
                emit("'\(app.name)' does not support per-app volume on macOS without FineTune installed (https://github.com/ronitsingh10/FineTune). Use a 'master' or mic mapping, or install FineTune.")
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
