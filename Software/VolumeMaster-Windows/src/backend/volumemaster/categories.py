"""App categories a knob can be mapped to instead of individual apps."""

CATEGORIES = {
    'Games': {
        'path_fragments': [
            r'steamapps\common',
            r'epic games',
            r'gog galaxy\games',
            r'xboxgames',
            r'riot games',
            r'ea games',
            r'ubisoft\games',
            r'battle.net',
            r'rockstar games',
            r'origin games',
        ],
        'known_names': frozenset(),
    },
    'Browser': {
        'path_fragments': [],
        'known_names': frozenset({
            'chrome.exe', 'firefox.exe', 'msedge.exe', 'brave.exe',
            'opera.exe', 'vivaldi.exe', 'waterfox.exe', 'librewolf.exe',
            'palemoon.exe', 'iridium.exe',
        }),
    },
    'Chat': {
        'path_fragments': [],
        'known_names': frozenset({
            'discord.exe', 'slack.exe', 'teams.exe', 'telegram.exe',
            'signal.exe', 'zoom.exe', 'skype.exe', 'webex.exe',
            'mattermost.exe', 'wire.exe', 'element.exe', 'whatsapp.exe',
        }),
    },
    'Media': {
        'path_fragments': [],
        'known_names': frozenset({
            'spotify.exe', 'vlc.exe', 'foobar2000.exe', 'winamp.exe',
            'mpc-hc64.exe', 'mpc-hc.exe', 'musicbee.exe', 'itunes.exe',
            'plex.exe', 'aimp.exe', 'potplayermini64.exe',
        }),
    },
}


def matches_category(exe_name_lower, path_lower, cat_name):
    cat = CATEGORIES.get(cat_name)
    if not cat:
        return False
    if exe_name_lower in cat['known_names']:
        return True
    return any(frag in path_lower for frag in cat['path_fragments'])
