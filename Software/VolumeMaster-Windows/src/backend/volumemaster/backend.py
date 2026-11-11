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
MAX_PARTIAL_LINE = 1024     # bytes without a newline before the partial line is discarded


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
        self._serial_buffer = bytearray()  # bytes of a line still arriving
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

    def refresh_audio(self):
        # A new app session appeared (including an app moving to another output
        # device) or the default output changed: give it the knobs' current
        # volumes. Re-applied from memory rather than by asking the device to
        # re-send (SYNC), since encoder devices have no absolute positions to send.
        if self.audio.refresh(self.mappings):
            self.reapply_volumes()

    def refresh_master(self):
        """Call after switching the default output device, so the master knob's
        volume carries over to the new device straight away."""
        if self.audio.refresh_master():
            self.reapply_volumes()

    def reapply_volumes(self):
        for index, value in list(self.volumes.items()):
            self.apply_volume(index, value, reapply=True)

    def apply_volume(self, index, value, reapply=False):
        mapping = self.mappings.get(index, {})
        # On a reapply, skip the 'Focused' target: whatever app is in front now
        # isn't necessarily the one the knob was last turned for.
        self.audio.set_volume(mapping, round(value / 100, 2), include_focused=not reapply)
        if self.voicemeeter and 'vm' in mapping:
            self.voicemeeter.set_gain(mapping['vm'], value)

    def apply_mute(self, index, state, reapply=False):
        mapping = self.mappings.get(index, {})
        self.audio.set_mute(mapping, state, include_focused=not reapply)
        if self.voicemeeter and 'vm' in mapping:
            self.voicemeeter.set_mute(mapping['vm'], state)

    def _read_serial_lines(self):
        """Every complete line received so far; a partial line waits for the rest.

        Waits up to 0.1s for data when idle (so the periodic work in run() still
        happens with no traffic), not at all while volumes are waiting to be
        applied. A fast-turning knob sends lines faster than one per pass, and
        readline() with no wait hands back whatever has arrived — half a line
        ('+@' now, '1' next pass), and both halves were dropped as malformed.
        """
        timeout = 0 if self.volume_cache else 0.1
        if self.ser.timeout != timeout:
            self.ser.timeout = timeout
        data = self.ser.read(max(1, self.ser.in_waiting))
        if not data:
            return []
        self._serial_buffer += data
        *lines, rest = self._serial_buffer.split(b'\n')
        # A runaway line with no newline (noise, wrong baud rate) can't grow forever
        self._serial_buffer = bytearray(rest if len(rest) <= MAX_PARTIAL_LINE else b'')
        decoded = (line.decode(errors='replace').strip() for line in lines)
        return [line for line in decoded if line]

    def _close_serial(self):
        self.on_serial_closed()
        try:
            self.ser.close()
        except Exception:
            pass
        self.ser = None
        self._serial_buffer.clear()

    def _flush_volumes(self):
        # Only each knob's latest value matters — when several ticks were read in
        # one pass, applying the in-between values would just slow things down.
        latest = {}
        while self.volume_cache:
            index, val = self.volume_cache.popleft()
            latest[index] = val
        for index, val in latest.items():
            if index not in self.volumes or self.volumes[index] != val:
                self.volumes[index] = val
                self.apply_volume(index, val)
                print(f'VOLUME:{index}:{val}', flush=True)

    # --- main loop -----------------------------------------------------------

    def run(self):
        last_refresh = time.monotonic()
        sync_needed = False
        sync_time_target = 0

        self.refresh_audio()
        watcher = ConfigWatcher()
        watcher.start()

        try:
            while True:
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
                    lines = self._read_serial_lines()
                except Exception:
                    print('ERROR:COM_PORT:Device disconnected from serial port.', flush=True)
                    self._close_serial()
                    continue

                for line in lines:
                    self.handle_line(line)

                if self.volume_cache:
                    self._flush_volumes()

                if time.monotonic() - last_refresh > AUDIO_REFRESH_SECONDS:
                    last_refresh = time.monotonic()
                    try:
                        self.refresh_audio()
                    except Exception as e:
                        print(f'[Audio] Session refresh failed: {e}', flush=True)

        except OSError:
            # Stdout pipe closed — Electron shut down while backend was writing.
            # Exit silently; no stderr traceback, so Electron won't crash-loop.
            pass
        finally:
            watcher.stop()
