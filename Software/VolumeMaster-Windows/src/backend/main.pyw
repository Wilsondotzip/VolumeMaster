import sys
import os
import yaml
import serial
import atexit
import threading
import queue
from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume, IAudioEndpointVolume, AudioSession
from pycaw.constants import EDataFlow, ERole
from comtypes import CLSCTX_ALL
import serial.tools.list_ports
import time
from collections import deque
from ctypes import POINTER, cast
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

_stdin_queue = queue.Queue()

def _start_stdin_reader():
    def _reader():
        try:
            for line in sys.stdin:
                cmd = line.strip()
                if cmd:
                    _stdin_queue.put(cmd)
        except Exception:
            pass
    t = threading.Thread(target=_reader, daemon=True)
    t.start()

_start_stdin_reader()

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


def _matches_category(exe_name_lower, path_lower, cat_name):
    cat = CATEGORIES.get(cat_name)
    if not cat:
        return False
    if exe_name_lower in cat['known_names']:
        return True
    return any(frag in path_lower for frag in cat['path_fragments'])


class ConfigHandler(FileSystemEventHandler):
    def __init__(self, on_change):
        self.on_change = on_change
        self._last_triggered = 0

    def on_modified(self, event):
        if not event.src_path:
            return
        if event.src_path.endswith('config.yaml'):
            now = time.time()
            if now - self._last_triggered < 0.5:
                return
            self._last_triggered = now
            print('[Watcher] Config changed, reloading...')
            self.on_change()

def find_arduino_port():
    for port in serial.tools.list_ports.comports():
        if 'arduino' in port.description.lower():
            return port.device
    return ''

def watch_config(config_path, on_change):
    handler = ConfigHandler(on_change)
    observer = Observer()
    observer.schedule(handler, path=os.path.dirname(config_path), recursive=False)
    observer.start()
    return observer

def load_config():
    with open('config.yaml', 'r', encoding='UTF-8') as file:
        return yaml.safe_load(file) or {}

def connect_serial(config):
    """Try once to open the serial port. Returns a Serial object or None."""
    port = config.get('comport', '')
    if not port or port == 'COM':
        print('ERROR:COM_PORT:No COM port selected. Please select a port in Settings.', flush=True)
        return None
    try:
        ser = serial.Serial(port)
        ser.baudrate = config['baudrate']
        ser.bytesize = config['bytesize']
        ser.parity = config['parity']
        ser.stopbits = config['stopbits']
        return ser
    except serial.SerialException as e:
        cause = e.__cause__ or e.__context__
        msg = str(e)
        if isinstance(cause, PermissionError) or ('Access is denied' in msg or 'PermissionError' in msg):
            print(f'ERROR:COM_PORT:{port} is in use by another program. Close any serial monitors (Arduino IDE, PuTTY, etc.) and it will reconnect automatically.', flush=True)

        elif isinstance(cause, FileNotFoundError) or ('filenotfounderror' in msg.lower() or 'cannot find the file' in msg.lower()):

            print(f'ERROR:COM_PORT:{port} not found. Check the correct port is selected in Settings.', flush=True)
        else:
            print(f'ERROR:COM_PORT:Cannot open {port} — {e}', flush=True)
        return None

# Voicemeeter setup
veme = 0
vmr = None
buttons = {}

def setup_voicemeeter(config):
    global vmr, veme
    import voicemeeter
    try:
        vmr = voicemeeter.remote(config['vmversion'])
        vmr.login()
    except Exception as e:
        print(f'ERROR:VM_NOT_RUNNING:{e}', flush=True)
        return None, None, None
    veme = 1

    def scalar_to_gain(value):
        value = int(value) / 100
        return (0.5 - value) * -120 if value < 0.5 else (value - 0.5) * 24 if value > 0.5 else 0

    def set_input_gain(index, value):
        vmr.inputs[int(index)].gain = int(scalar_to_gain(value))

    def set_output_gain(index, value):
        vmr.outputs[int(index)].gain = round(scalar_to_gain(value), 1)

    def set_button_toggle(srep, state):
        if srep not in buttons:
            return
        for action in buttons[srep]:
            kind, control = action.split('.')
            target = vmr.inputs if 'Input' in kind else vmr.outputs
            channel = target[int(kind.strip('InputOutput'))]
            setattr(channel, control.lower(), state)

    return set_input_gain, set_output_gain, set_button_toggle

def build_mappings(config):
    mappings = {}
    for key, val in config.get('Mappings', {}).items():
        try:
            index = int(key)
        except ValueError:
            print(f"Invalid mapping key: {key}")
            continue

        entry = {}

        apps = val.get('ProcessNames')
        if isinstance(apps, list):
            entry['apps'] = [a.strip().lower() for a in apps if isinstance(a, str) and a.strip()]

        vm = val.get('VoiceMeeter')
        if vm:
            if isinstance(vm, list):
                entry['vm'] = [v.strip().lower() for v in vm if isinstance(v, str) and v.strip()]
            elif isinstance(vm, str):
                entry['vm'] = [vm.strip().lower()]

        mics = val.get('MicNames')
        if isinstance(mics, list):
            entry['mics'] = [m.strip().lower() for m in mics if isinstance(m, str) and m.strip()]

        cats = val.get('Categories')
        if isinstance(cats, list):
            entry['categories'] = [c.strip() for c in cats if isinstance(c, str) and c.strip()]

        mappings[index] = entry
    return mappings

# Load config and initialize
config = load_config()

mappings = build_mappings(config)
buttons = {
    key: val.split(';') for key, val in config.get('Buttons', {}).items() if val
}
volumes = {}

# Setup Voicemeeter if enabled
set_input_gain = set_output_gain = set_button_toggle = None
if config.get('vm'):
    result = setup_voicemeeter(config)
    if result != (None, None, None):
        set_input_gain, set_output_gain, set_button_toggle = result

atexit.register(lambda: vmr.logout() if veme else None)

session_cache = {}
session_paths = {}  # (pid, exe_name_lower) -> exe_path_lower
master_volume_interface = None
mic_interfaces = {}
_audio_available = True  # tracks state so we only print on change
_reconnect_serial = False  # set by reload_config when comport changes


def setup_mic_interfaces():
    global mic_interfaces
    mic_interfaces.clear()

    wanted = set()
    for entry in mappings.values():
        for name in entry.get('mics', []):
            wanted.add(name)  # Already lowercased from build_mappings

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
                    mic_interfaces[w] = device.EndpointVolume
                    break
        except Exception as e:
            print(f"Could not open mic device '{device.FriendlyName}': {e}")


def setup_audio_interfaces(ser=None):
    global session_cache, session_paths, master_volume_interface, _audio_available, volumes

    try:
        sessions = AudioUtilities.GetAllSessions()
    except Exception as e:
        if _audio_available:
            print(f'ERROR:AUDIO_UNAVAILABLE:Windows Audio is unavailable: {e}', flush=True)
            _audio_available = False
        return

    new_session_cache = {}
    new_session_paths = {}
    newly_opened = False

    for session in sessions:
        if session.Process:
            try:
                pid = session.Process.pid
                # Store the lowercase executable name immediately for fast matching
                exe_name_lower = session.Process.name().lower()
                key = (pid, exe_name_lower)
                vol_interface = session.SimpleAudioVolume

                new_session_cache[key] = vol_interface

                if key not in new_session_paths:
                    try:
                        new_session_paths[key] = session.Process.exe().lower()
                    except Exception:
                        new_session_paths[key] = ''

                if key not in session_cache:
                    newly_opened = True
            except Exception:
                pass

    session_cache = new_session_cache
    session_paths = new_session_paths

    # If a new process was detected, request a SYNC pulse from the Arduino.
    # We clear the volumes cache first so that the incoming values aren't
    # ignored as duplicates, forcing the volume to apply to the new process.
    if newly_opened and ser is not None:
        try:
            volumes.clear()
            ser.write(b"SYNC\n")
        except Exception:
            pass

    if any('master' in entry.get('apps', []) for entry in mappings.values()):
        try:
            device = AudioUtilities.GetSpeakers()
            master_volume_interface = device.EndpointVolume
        except Exception as e:
            if _audio_available:
                print(f'ERROR:AUDIO_UNAVAILABLE:No default audio output device: {e}', flush=True)
                _audio_available = False
            master_volume_interface = None
            return

    setup_mic_interfaces()

    if not _audio_available:
        print('STATUS:AUDIO_OK', flush=True)
        _audio_available = True


def reload_config():
    global config, mappings, buttons, volumes, _reconnect_serial
    print('[Watcher] Reloading config...')
    try:
        old_port = config.get('comport')

        config = load_config()
        mappings = build_mappings(config)
        buttons = {
            key: val.split(';') for key, val in config.get('Buttons', {}).items() if val
        }

        if config.get('comport') != old_port:
            _reconnect_serial = True

        setup_audio_interfaces()
        print('[Watcher] Reloaded successfully.')
    except Exception as e:
        print(f'[Watcher] Failed to reload: {e}')


def process_audio_change(index, value):
    global master_volume_interface
    mapping = mappings.get(index, {})
    volume_scalar = round(value / 100, 2)

    if 'apps' in mapping:
        for name in mapping['apps']:
            if name == 'master' and master_volume_interface:
                try:
                    master_volume_interface.SetMasterVolumeLevelScalar(volume_scalar, None)
                except Exception:
                    master_volume_interface = None
                continue

            for (pid, exe_name_lower), vol_interface in list(session_cache.items()):
                if name in exe_name_lower:
                    try:
                        vol_interface.SetMasterVolume(volume_scalar, None)
                    except Exception:
                        session_cache.pop((pid, exe_name_lower), None)

    if 'mics' in mapping:
        for mic_name in mapping['mics']:
            interface = mic_interfaces.get(mic_name)
            if interface:
                try:
                    interface.SetMasterVolumeLevelScalar(volume_scalar, None)
                except Exception as e:
                    print(f"Failed to set mic volume for '{mic_name}': {e}")
                    mic_interfaces.pop(mic_name, None)
            else:
                print(f"Mic not found in cache: '{mic_name}' — will retry on next refresh")

    if 'categories' in mapping:
        for cat_name in mapping['categories']:
            for (pid, exe_name_lower), vol_interface in list(session_cache.items()):
                path_lower = session_paths.get((pid, exe_name_lower), '')
                if _matches_category(exe_name_lower, path_lower, cat_name):
                    try:
                        vol_interface.SetMasterVolume(volume_scalar, None)
                    except Exception:
                        session_cache.pop((pid, exe_name_lower), None)

    if set_input_gain and set_output_gain and 'vm' in mapping:
        for target in mapping['vm']:
            try:
                if target.startswith('input'):
                    set_input_gain(target.removeprefix('input'), value)
                elif target.startswith('output'):
                    set_output_gain(target.removeprefix('output'), value)
            except Exception as e:
                print(f"Failed to set VoiceMeeter gain for '{target}': {e}")


def main():
    global volumes
    volume_cache = deque()
    last_update_time = 0
    timeSinceLastRefresh = time.time()
    update_interval = 0.00001
    ser = None
    sync_needed = False
    sync_time_target = 0

    setup_audio_interfaces()

    observer = watch_config(os.path.abspath('config.yaml'), reload_config)

    try:
        while True:
            now = time.monotonic()

            while not _stdin_queue.empty():
                cmd = _stdin_queue.get_nowait()
                if cmd == 'LIST_SESSIONS':
                    names = list({exe for (_, exe) in session_cache.keys()})
                    print(f"SESSIONS:{','.join(names)}", flush=True)

            # If comport changed via settings, close current connection and reconnect
            global _reconnect_serial
            if _reconnect_serial and ser is not None:
                _reconnect_serial = False
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None

            # Reconnect serial if not connected
            if ser is None:
                ser = connect_serial(config)
                if ser is None:
                    # No serial — still refresh audio so banners stay current
                    if time.time() - timeSinceLastRefresh > 2:
                        timeSinceLastRefresh = time.time()
                        try:
                            setup_audio_interfaces()
                        except Exception as e:
                            print(f'[Audio] Session refresh failed: {e}', flush=True)
                    time.sleep(2)
                    continue
                print('STATUS:SERIAL_OK', flush=True)
                sync_needed = True
                # Wait 2.5 seconds to ensure Arduino has fully initialized before sending SYNC
                sync_time_target = time.monotonic() + 2.5

            if sync_needed and ser is not None and time.monotonic() > sync_time_target:
                sync_needed = False
                try:
                    # Clear volumes cache so the initial SYNC pulse values are fully 
                    # applied to all already-open processes, bypassing deduplication
                    volumes.clear()
                    ser.write(b"SYNC\n")
                except Exception:
                    pass

            try:
                if volume_cache:
                    if ser.timeout != 0:
                        ser.timeout = 0
                else:
                    # 0.1s timeout prevents readline from blocking indefinitely, allowing background tasks to run
                    if ser.timeout != 0.1:
                        ser.timeout = 0.1

                line = ser.readline().decode().strip()
                if not line:
                    pass
            except Exception:
                print('ERROR:COM_PORT:Device disconnected from serial port.', flush=True)
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
                continue

            if '@' in line:
                try:
                    value_str, index_str = line.split('@')
                    value, index = int(value_str), int(index_str)
                    volume_cache.append((index, value))
                except ValueError:
                    print("Malformed input:", line)
                    continue

            elif line and set_button_toggle:
                if line.endswith('!='):
                    set_button_toggle(line.strip('!='), False)
                else:
                    set_button_toggle(line.strip('='), True)

            if now - last_update_time >= update_interval and volume_cache:
                while volume_cache:
                    if not volume_cache:
                        break
                    index, val = volume_cache.popleft()
                    if index not in volumes or volumes[index] != val:
                        volumes[index] = val
                        process_audio_change(index, val)
                        print(f'VOLUME:{index}:{val}', flush=True)
                    last_update_time = now

            if time.time() - timeSinceLastRefresh > 2:
                timeSinceLastRefresh = time.time()
                try:
                    setup_audio_interfaces(ser)
                except Exception as e:
                    print(f'[Audio] Session refresh failed: {e}', flush=True)

    except OSError:
        # Stdout pipe closed — Electron shut down while backend was writing.
        # Exit silently; no stderr traceback, so Electron won't crash-loop.
        pass
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    main()