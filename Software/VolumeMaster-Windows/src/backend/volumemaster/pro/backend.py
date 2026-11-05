"""VolumeMaster Pro backend: push-button rotary encoders.

Serial protocol (on top of the standard backend's):
    +@<knob> / -@<knob>        one encoder tick right / left. Accumulated into a
                               volume in EncoderMode 'absolute', or run as turn
                               actions in 'increment'. A bare '<value>@<knob>' is
                               still accepted as a legacy / manual-test path.
    BTN_DOWN:<knob>            button pressed: runs the knob's button actions and
                               is forwarded to Electron as BUTTON:<knob> (plugin
                               actions, held state in the UI).
    BTN_UP:<knob>:<hold ms>    button released: forwarded as BUTTON_UP for the UI;
                               no action fires on release.

While a knob selector is open (selector.py) it takes over that knob's ticks and
all button presses.
"""
import json

from ..backend import Backend
from ..config import mapping_items
from . import output_devices
from .actions import ActionRunner
from .selector import SelectorManager

ENCODER_STEP = 2  # volume change per tick, for EncoderMode 'absolute'
ENCODER_MODES = ('absolute', 'increment')


class ProBackend(Backend):
    def __init__(self):
        # Created before Backend.__init__, which loads the config through
        # on_config_loaded() and so needs these to exist already.
        self.selectors = SelectorManager()  # knob-driven pick-one-of-N popup
        self.actions = ActionRunner(self)
        self.encoder_modes = {}      # knob index -> 'absolute' | 'increment'
        self.encoder_positions = {}  # knob index -> software-accumulated 0-100 volume ('absolute')
        super().__init__()

    def on_config_loaded(self, config):
        self.encoder_modes = {}
        for index, val in mapping_items(config):
            mode = val.get('EncoderMode')
            self.encoder_modes[index] = mode if mode in ENCODER_MODES else 'absolute'
        self.actions.load(config)

    def handle_command(self, cmd):
        if cmd == 'LIST_OUTPUTS':
            # JSON, since device names contain commas/parentheses.
            try:
                payload = {
                    'devices': output_devices.list_outputs(),
                    'default': output_devices.get_default_output_id(),
                }
            except Exception as e:
                print(f'Failed to list output devices: {e}', flush=True)
                payload = {'devices': [], 'default': None}
            print(f'OUTPUTS:{json.dumps(payload)}', flush=True)
        elif cmd.startswith('SET_OUTPUT:'):
            try:
                output_devices.set_default_output(cmd[len('SET_OUTPUT:'):])
                self.audio.refresh_master()
            except Exception as e:
                print(f'Failed to set output device: {e}', flush=True)
        elif cmd.startswith('OPEN_SELECTOR:'):
            self.selectors.open_from_command(cmd[len('OPEN_SELECTOR:'):])
        elif cmd == 'CLOSE_SELECTOR':
            self.selectors.cancel()
        else:
            super().handle_command(cmd)

    def on_loop(self):
        self.selectors.check_timeout()

    def on_serial_closed(self):
        # A selector in use has no timeout — with the knob gone nothing could
        # ever confirm or dismiss it.
        self.selectors.cancel()

    def handle_line(self, line):
        if line.startswith('BTN_DOWN:'):
            self._on_button_down(line)
        elif line.startswith('BTN_UP:'):
            self._on_button_up(line)
        else:
            super().handle_line(line)

    def handle_knob_line(self, line):
        try:
            left_str, index_str = line.split('@')
            index = int(index_str)
        except ValueError:
            print("Malformed input:", line)
            return

        if left_str not in ('+', '-'):
            try:
                self.volume_cache.append((index, int(left_str)))
            except ValueError:
                print("Malformed input:", line)
            return

        step = 1 if left_str == '+' else -1
        if self.selectors.is_open_for(index):
            # An open selector takes over this knob's ticks entirely.
            self.selectors.move(step)
        elif self.encoder_modes.get(index, 'absolute') == 'increment':
            self.actions.run_turn(index, 'right' if step > 0 else 'left')
        else:
            position = self.encoder_positions.get(index, 50)
            position = max(0, min(100, position + step * ENCODER_STEP))
            self.encoder_positions[index] = position
            self.volume_cache.append((index, position))

    def _on_button_down(self, line):
        try:
            index = int(line[len('BTN_DOWN:'):])
        except ValueError:
            print("Malformed button input:", line)
            return
        # While a selector is open, presses belong to it: the same knob
        # confirms, any other knob cancels. Either way the press is consumed —
        # no BUTTON: line, so no actions/plugins fire.
        if self.selectors.active is not None:
            if self.selectors.is_open_for(index):
                self.selectors.confirm()
            else:
                self.selectors.cancel()
            return
        print(f'BUTTON:{index}', flush=True)
        self.actions.run_button(index)

    def _on_button_up(self, line):
        # The hold duration is forwarded in case a future feature (e.g. long-
        # vs short-press actions) wants it; nothing fires on release.
        try:
            index_str, duration_str = line[len('BTN_UP:'):].split(':')
            index, hold_ms = int(index_str), int(duration_str)
        except ValueError:
            print("Malformed button input:", line)
            return
        print(f'BUTTON_UP:{index}:{hold_ms}', flush=True)
