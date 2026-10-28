"""Windows audio: per-app sessions (on every output device), master volume, mics.

A knob's mapping (see config.build_mappings) names its targets; this module
applies a volume or mute to all of them. VoiceMeeter targets are separate
(voicemeeter_link.py).
"""
from pycaw.pycaw import AudioUtilities, AudioSession, IAudioSessionControl2, DEVICE_STATE
from pycaw.constants import EDataFlow

from .categories import matches_category


def get_all_output_sessions():
    """Like AudioUtilities.GetAllSessions(), but across every active render device, not just the default one."""
    sessions = []
    devices = AudioUtilities.GetAllDevices(
        data_flow=EDataFlow.eRender.value, device_state=DEVICE_STATE.ACTIVE.value
    )
    for device in devices:
        try:
            session_enumerator = device.AudioSessionManager.GetSessionEnumerator()
            for i in range(session_enumerator.GetCount()):
                ctl = session_enumerator.GetSession(i)
                if ctl is None:
                    continue
                ctl2 = ctl.QueryInterface(IAudioSessionControl2)
                if ctl2 is not None:
                    sessions.append(AudioSession(ctl2))
        except Exception:
            continue
    return sessions


def _session_instance_id(session):
    """Windows' unique ID for this session instance. One app can have several
    sessions at once — one per output device it has played through, plus old
    inactive ones — so (pid, exe) alone doesn't identify a session."""
    try:
        return session.InstanceIdentifier or ''
    except Exception:
        return ''


class AudioController:
    def __init__(self):
        # Keyed (pid, exe_name_lower, instance_id): every session of a mapped app
        # is controlled, not just whichever one Windows happened to list last.
        self.session_cache = {}   # key -> ISimpleAudioVolume
        self.session_paths = {}   # key -> exe_path_lower
        self.master = None        # default output's IAudioEndpointVolume, when a knob maps 'master'
        self.mics = {}            # mapped mic name (lowercase) -> IAudioEndpointVolume
        self._available = True    # tracks state so we only print on change

    def session_names(self):
        return list({key[1] for key in self.session_cache.keys()})

    def refresh(self, mappings):
        """Re-enumerates sessions (and the master / mic endpoints the mappings
        need). Returns True if a new session appeared since last time — a new
        app, or an existing app that created a fresh session (e.g. after
        switching output device), which starts at its own volume until the
        knob's value is re-applied."""
        try:
            sessions = get_all_output_sessions()
        except Exception as e:
            if self._available:
                print(f'ERROR:AUDIO_UNAVAILABLE:Windows Audio is unavailable: {e}', flush=True)
                self._available = False
            return False

        new_session_cache = {}
        new_session_paths = {}
        newly_opened = False

        for session in sessions:
            if session.Process:
                try:
                    pid = session.Process.pid
                    # Store the lowercase executable name immediately for fast matching
                    exe_name_lower = session.Process.name().lower()
                    key = (pid, exe_name_lower, _session_instance_id(session))
                    vol_interface = session.SimpleAudioVolume

                    new_session_cache[key] = vol_interface

                    if key not in new_session_paths:
                        try:
                            new_session_paths[key] = session.Process.exe().lower()
                        except Exception:
                            new_session_paths[key] = ''

                    if key not in self.session_cache:
                        newly_opened = True
                except Exception:
                    pass

        self.session_cache = new_session_cache
        self.session_paths = new_session_paths

        if any('master' in entry.get('apps', []) for entry in mappings.values()):
            try:
                self.master = AudioUtilities.GetSpeakers().EndpointVolume
            except Exception as e:
                if self._available:
                    print(f'ERROR:AUDIO_UNAVAILABLE:No default audio output device: {e}', flush=True)
                    self._available = False
                self.master = None
                return newly_opened

        self._refresh_mics(mappings)

        if not self._available:
            print('STATUS:AUDIO_OK', flush=True)
            self._available = True
        return newly_opened

    def refresh_master(self):
        """Re-point 'master' at the current default output right away (after a
        default-device switch) instead of waiting for the next refresh()."""
        try:
            self.master = AudioUtilities.GetSpeakers().EndpointVolume
        except Exception:
            self.master = None

    def _refresh_mics(self, mappings):
        self.mics.clear()

        wanted = set()
        for entry in mappings.values():
            for name in entry.get('mics', []):
                wanted.add(name)  # Already lowercased by build_mappings

        if not wanted:
            return

        try:
            capture_devices = AudioUtilities.GetAllDevices(
                data_flow=EDataFlow.eCapture.value, device_state=1
            )
        except Exception as e:
            print(f'ERROR:AUDIO_UNAVAILABLE:Could not enumerate capture devices: {e}', flush=True)
            return

        for device in capture_devices:
            try:
                friendly_name = device.FriendlyName.lower() if device.FriendlyName else ''
                for w in wanted:
                    if w in friendly_name:
                        self.mics[w] = device.EndpointVolume
                        break
            except Exception as e:
                print(f"Could not open mic device '{device.FriendlyName}': {e}")

    def _category_sessions(self, cat_name):
        for key, vol_interface in list(self.session_cache.items()):
            if matches_category(key[1], self.session_paths.get(key, ''), cat_name):
                yield key, vol_interface

    def set_volume(self, mapping, volume_scalar):
        for name in mapping.get('apps', []):
            if name == 'master' and self.master:
                try:
                    self.master.SetMasterVolumeLevelScalar(volume_scalar, None)
                except Exception:
                    self.master = None
                continue

            for key, vol_interface in list(self.session_cache.items()):
                if name in key[1]:
                    try:
                        vol_interface.SetMasterVolume(volume_scalar, None)
                    except Exception:
                        self.session_cache.pop(key, None)

        for mic_name in mapping.get('mics', []):
            interface = self.mics.get(mic_name)
            if interface:
                try:
                    interface.SetMasterVolumeLevelScalar(volume_scalar, None)
                except Exception as e:
                    print(f"Failed to set mic volume for '{mic_name}': {e}")
                    self.mics.pop(mic_name, None)
            else:
                print(f"Mic not found in cache: '{mic_name}' — will retry on next refresh")

        for cat_name in mapping.get('categories', []):
            for key, vol_interface in self._category_sessions(cat_name):
                try:
                    vol_interface.SetMasterVolume(volume_scalar, None)
                except Exception:
                    self.session_cache.pop(key, None)

    def set_mute(self, mapping, state):
        for name in mapping.get('apps', []):
            if name == 'master':
                if self.master:
                    try:
                        self.master.SetMute(state, None)
                    except Exception as e:
                        print(f"Failed to mute master volume: {e}")
                continue

            for key, vol_interface in list(self.session_cache.items()):
                if name in key[1]:
                    try:
                        vol_interface.SetMute(state, None)
                    except Exception:
                        self.session_cache.pop(key, None)

        for mic_name in mapping.get('mics', []):
            interface = self.mics.get(mic_name)
            if interface:
                try:
                    interface.SetMute(state, None)
                except Exception as e:
                    print(f"Failed to mute mic '{mic_name}': {e}")

        for cat_name in mapping.get('categories', []):
            for key, vol_interface in self._category_sessions(cat_name):
                try:
                    vol_interface.SetMute(state, None)
                except Exception:
                    self.session_cache.pop(key, None)
