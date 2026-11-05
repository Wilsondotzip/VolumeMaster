"""The serial read loop shared by every device model.

Backend handles the standard VolumeMaster (potentiometers sending absolute
'<value>@<knob>' readings). Device models with a different serial protocol
subclass it and override the hooks (see pro/backend.py):

    on_config_loaded(config)   rebuild model-specific state from config.yaml
    handle_command(cmd)        a command from Electron over stdin
    handle_line(line)          one line from the device
    handle_knob_line(line)     a line containing '@' (knob movement)
    on_loop()                  once per main-loop pass
    on_serial_closed()         the device connection was closed or lost
"""
import time
from collections import deque

from .audio import AudioController
from .commands import StdinCommands
from .config import ConfigWatcher, build_mappings, is_enabled, load_config
from .serial_link import connect_serial
from .voicemeeter_link import VoiceMeeter

AUDIO_REFRESH_SECONDS = 2   # how often app sessions / devices are re-enumerated
SYNC_DELAY_SECONDS = 2.5    # after connecting, so the device has fully initialised
UPDATE_INTERVAL = 0.00001   # minimum spacing between volume-cache flushes


class Backend:
    def __init__(self):
        self.commands = StdinCommands()
        self.audio = AudioController()
        self.config = load_config()
        self.voicemeeter = None
        self.mappings = {}
        self.apply_config(self.config)
        # VoiceMeeter is connected once at startup; toggling it in Settings
        # restarts the backend rather than going through a config reload.
        # connect() returns None if VoiceMeeter is missing or not running.
        if is_enabled(self.config.get('vm')):
            self.voicemeeter = VoiceMeeter.connect(self.config)

        self.ser = None
        self.volumes = {}              # knob index -> last applied value (dedupes repeats)
        self.volume_cache = deque()    # (knob index, value) waiting to be applied
        self._reconnect_serial = False  # set when the configured COM port changes

    # --- hooks for device models -------------------------------------------

    def on_config_loaded(self, config):
        pass

    def handle_command(self, cmd):
        if cmd == 'LIST_SESSIONS':
            print(f"SESSIONS:{','.join(self.audio.session_names())}", flush=True)

    def handle_line(self, line):
        if '@' in line:
            self.handle_knob_line(line)
        elif self.voicemeeter:
            self.voicemeeter.handle_button_line(line)

    def handle_knob_line(self, line):
        """'<value>@<knob>': the knob's absolute position, 0-100."""
        try:
            value_str, index_str = line.split('@')
            value, index = int(value_str), int(index_str)
        except ValueError:
            print("Malformed input:", line)
            return
        self.volume_cache.append((index, value))

    def on_loop(self):
        pass

    def on_serial_closed(self):
        pass

    # --- shared behaviour ----------------------------------------------------

    def apply_config(self, config):
        self.mappings = build_mappings(config)
        if self.voicemeeter:
            self.voicemeeter.reload(config)
        self.on_config_loaded(config)

    def reload_config(self):
        print('[Watcher] Reloading config...')
        try:
            old_port = self.config.get('comport')
            self.config = load_config()
            self.apply_config(self.config)
            if self.config.get('comport') != old_port:
                self._reconnect_serial = True
            self.refresh_audio()
            print('[Watcher] Reloaded successfully.')
        except Exception as e:
            print(f'[Watcher] Failed to reload: {e}')

    def refresh_audio(self, request_sync=False):
        newly_opened = self.audio.refresh(self.mappings)
        # A new app with audio appeared: ask the device to re-send every knob
        # (SYNC) so it gets the current volume. Clearing the dedupe cache first
        # makes those repeated values actually apply.
        if newly_opened and request_sync and self.ser is not None:
            try:
                self.volumes.clear()
                self.ser.write(b"SYNC\n")
            except Exception:
                pass

    def apply_volume(self, index, value):
        mapping = self.mappings.get(index, {})
        self.audio.set_volume(mapping, round(value / 100, 2))
        if self.voicemeeter and 'vm' in mapping:
            self.voicemeeter.set_gain(mapping['vm'], value)

    def apply_mute(self, index, state):
        mapping = self.mappings.get(index, {})
        self.audio.set_mute(mapping, state)
        if self.voicemeeter and 'vm' in mapping:
            self.voicemeeter.set_mute(mapping['vm'], state)

    def _close_serial(self):
        self.on_serial_closed()
        try:
            self.ser.close()
        except Exception:
            pass
        self.ser = None

    def _flush_volumes(self):
        while self.volume_cache:
            index, val = self.volume_cache.popleft()
            if index not in self.volumes or self.volumes[index] != val:
                self.volumes[index] = val
                self.apply_volume(index, val)
                print(f'VOLUME:{index}:{val}', flush=True)

    # --- main loop -----------------------------------------------------------

    def run(self):
        last_update_time = 0
        last_refresh = time.monotonic()
        sync_needed = False
        sync_time_target = 0

        self.refresh_audio()
        watcher = ConfigWatcher()
        watcher.start()

        try:
            while True:
                now = time.monotonic()

                if watcher.consume_change():
                    self.reload_config()

                for cmd in self.commands.drain():
                    self.handle_command(cmd)

                self.on_loop()

                # If comport changed via settings, close current connection and reconnect
                if self._reconnect_serial and self.ser is not None:
                    self._reconnect_serial = False
                    self._close_serial()

                # Reconnect serial if not connected
                if self.ser is None:
                    self.ser = connect_serial(self.config)
                    if self.ser is None:
                        # No serial — still refresh audio so banners stay current
                        if time.monotonic() - last_refresh > AUDIO_REFRESH_SECONDS:
                            last_refresh = time.monotonic()
                            try:
                                self.refresh_audio()
                            except Exception as e:
                                print(f'[Audio] Session refresh failed: {e}', flush=True)
                        time.sleep(2)
                        continue
                    print('STATUS:SERIAL_OK', flush=True)
                    sync_needed = True
                    sync_time_target = time.monotonic() + SYNC_DELAY_SECONDS

                if sync_needed and time.monotonic() > sync_time_target:
                    sync_needed = False
                    try:
                        # Clear volumes cache so the initial SYNC pulse values are fully
                        # applied to all already-open processes, bypassing deduplication
                        self.volumes.clear()
                        self.ser.write(b"SYNC\n")
                    except Exception:
                        pass

                try:
                    # Don't block while volumes are waiting to be applied; otherwise a
                    # 0.1s timeout keeps readline from blocking forever, so the
                    # periodic work below still runs with no serial traffic.
                    timeout = 0 if self.volume_cache else 0.1
                    if self.ser.timeout != timeout:
                        self.ser.timeout = timeout
                    line = self.ser.readline().decode().strip()
                except Exception:
                    print('ERROR:COM_PORT:Device disconnected from serial port.', flush=True)
                    self._close_serial()
                    continue

                if line:
                    self.handle_line(line)

                if now - last_update_time >= UPDATE_INTERVAL and self.volume_cache:
                    self._flush_volumes()
                    last_update_time = now

                if time.monotonic() - last_refresh > AUDIO_REFRESH_SECONDS:
                    last_refresh = time.monotonic()
                    try:
                        self.refresh_audio(request_sync=True)
                    except Exception as e:
                        print(f'[Audio] Session refresh failed: {e}', flush=True)

        except OSError:
            # Stdout pipe closed — Electron shut down while backend was writing.
            # Exit silently; no stderr traceback, so Electron won't crash-loop.
            pass
        finally:
            watcher.stop()
