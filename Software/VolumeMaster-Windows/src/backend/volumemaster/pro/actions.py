"""Built-in button-press and turn actions (VolumeMaster Pro).

Mappings[knob].ButtonActions / TurnLeftActions / TurnRightActions hold entries
{'kind': 'builtin', 'type': ..., 'id': ..., 'params': {...}}. Only 'builtin'
entries run here: plugin entries are dispatched by Electron (on the BUTTON:
stdout line), and 'switch_preset' / 'encoder_mode' are executed by Electron's
main process (it owns presets) — their effect reaches us as a config reload.
"""
import subprocess

import keyboard

from ..config import mapping_items
from . import output_devices


def _builtin_entries(raw):
    return [entry for entry in raw if isinstance(entry, dict) and entry.get('kind') == 'builtin'] if isinstance(raw, list) else []


def send_keyboard_shortcut(keys):
    if not keys:
        return
    try:
        keyboard.send(keys)
    except Exception as e:
        print(f"Failed to send keyboard shortcut '{keys}': {e}")


def launch_program(path):
    if not path:
        return
    try:
        subprocess.Popen([path])
    except Exception as e:
        print(f"Failed to launch program '{path}': {e}")


class ActionRunner:
    def __init__(self, backend):
        self._backend = backend
        self._button_actions = {}  # knob index -> [entry]
        self._turn_actions = {}    # knob index -> {'left': [entry], 'right': [entry]}
        self._mute_state = {}      # knob index -> bool, toggled by the 'mute' action

    def load(self, config):
        self._button_actions = {}
        self._turn_actions = {}
        for index, val in mapping_items(config):
            buttons = _builtin_entries(val.get('ButtonActions'))
            if buttons:
                self._button_actions[index] = buttons
            left = _builtin_entries(val.get('TurnLeftActions'))
            right = _builtin_entries(val.get('TurnRightActions'))
            if left or right:
                self._turn_actions[index] = {'left': left, 'right': right}

    def run_button(self, index):
        self._run(index, self._button_actions.get(index, []), 'button action')

    def run_turn(self, index, direction):
        self._run(index, self._turn_actions.get(index, {}).get(direction, []), 'turn action')

    def _run(self, index, entries, failure_label):
        # Each action already guards its own execution; this outer guard exists so a
        # bug in one action type can't take down the serial read loop for every knob.
        for entry in entries:
            try:
                action_type = entry.get('type')
                params = entry.get('params') or {}
                if action_type == 'mute':
                    self._toggle_mute(index)
                elif action_type == 'keyboard_shortcut':
                    send_keyboard_shortcut(params.get('keys', ''))
                elif action_type == 'open_program':
                    launch_program(params.get('path', ''))
                elif action_type == 'switch_output':
                    self._switch_output(index, entry.get('id'), params)
            except Exception as e:
                print(f"Failed to execute {failure_label} {entry}: {e}")

    def _toggle_mute(self, index):
        """Toggles mute for whatever this knob's turn controls (its volume targets)."""
        new_state = not self._mute_state.get(index, False)
        self._mute_state[index] = new_state
        self._backend.apply_mute(index, new_state)

    def _apply_output(self, device_id, name, include_communications):
        output_devices.set_default_output(device_id, include_communications)
        self._backend.audio.refresh_master()
        print(f'OUTPUT_CHANGED:{name}', flush=True)

    def _switch_output(self, index, action_id, params):
        include_communications = params.get('communications', True) is not False

        if params.get('mode', 'toggle') == 'selector':
            items, current = output_devices.selector_items(params.get('devices'))
            if not self._backend.selectors.open(
                index, 'Output Device', items, current,
                on_select=lambda item: self._apply_output(item['id'], item['label'], include_communications),
            ):
                print('No output devices available to choose from', flush=True)
            return

        name = output_devices.toggle_output(action_id, params.get('device'), include_communications)
        if name:
            self._backend.audio.refresh_master()
            print(f'OUTPUT_CHANGED:{name}', flush=True)
