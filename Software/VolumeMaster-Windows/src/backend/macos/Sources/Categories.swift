import Foundation

/// macOS port of the Windows backend's CATEGORIES dict (main.pyw).
///
/// Windows matches by executable name (.exe) and install-path fragments.
/// On macOS the analogues are bundle identifier (for known apps) and
/// bundle path (for game stores that put titles under a predictable path).
struct AppCategoryDef {
    let pathFragments: [String]   // matched against bundle path, lowercased
    let knownBundleIDs: Set<String> // matched against bundle identifier, lowercased
}

let appCategories: [String: AppCategoryDef] = [
    "Games": AppCategoryDef(
        pathFragments: [
            "steamapps/common",
            "epic games",
            "gog galaxy",
            "riot games",
            "ea games",
            "ubisoft/games",
            "battle.net",
            "rockstar games",
            "heroic/games",
        ],
        knownBundleIDs: []
    ),
    "Browser": AppCategoryDef(
        pathFragments: [],
        knownBundleIDs: [
            "com.google.chrome",
            "com.google.chrome.canary",
            "org.mozilla.firefox",
            "com.microsoft.edgemac",
            "com.brave.browser",
            "com.operasoftware.opera",
            "com.vivaldi.vivaldi",
            "net.waterfox.waterfox",
            "io.gitlab.librewolf-community",
        ]
    ),
    "Chat": AppCategoryDef(
        pathFragments: [],
        knownBundleIDs: [
            "com.hnc.discord",
            "com.tinyspeck.slackmacgui",
            "com.microsoft.teams",
            "com.microsoft.teams2",
            "org.telegram.desktop",
            "ru.keepcoder.telegram",
            "org.whispersystems.signal-desktop",
            "us.zoom.xos",
            "com.skype.skype",
            "com.cisco.webexmeetings",
            "com.mattermost.desktop",
            "io.element.desktop",
            "net.whatsapp.whatsapp",
        ]
    ),
    "Media": AppCategoryDef(
        pathFragments: [],
        knownBundleIDs: [
            "com.spotify.client",
            "org.videolan.vlc",
            "com.apple.music",
            "com.apple.itunes",
            "tv.plex.player",
            "com.plexamp.plexamp",
            "com.apple.podcasts",
            "com.apple.tv",
        ]
    ),
]

func matchesCategory(bundleID: String, bundlePath: String, categoryName: String) -> Bool {
    guard let cat = appCategories[categoryName] else { return false }
    let idLower = bundleID.lowercased()
    if cat.knownBundleIDs.contains(idLower) { return true }
    let pathLower = bundlePath.lowercased()
    return cat.pathFragments.contains { pathLower.contains($0) }
}
