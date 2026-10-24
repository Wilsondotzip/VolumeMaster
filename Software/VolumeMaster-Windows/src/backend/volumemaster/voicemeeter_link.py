"""VoiceMeeter control: channel gain from knobs, mute, and device buttons."""
import atexit


def _scalar_to_gain(value):
    value = int(value) / 100
    return (0.5 - value) * -120 if value < 0.5 else (value - 0.5) * 24 if value > 0.5 else 0


def _parse_buttons(config):
    """config['Buttons']: {button id: 'Input0.Mute;Output1.A1', ...}."""
    return {key: val.split(';') for key, val in config.get('Buttons', {}).items() if val}


class VoiceMeeter:
    def __init__(self, remote, config):
        self._vmr = remote
        self._buttons = _parse_buttons(config)

    @classmethod
    def connect(cls, config):
        """Logs in to VoiceMeeter, or prints VM_NOT_RUNNING and returns None."""
        import voicemeeter  # only needed (and only bundled-in work done) when enabled
        try:
            remote = voicemeeter.remote(config['vmversion'])
            remote.login()
        except Exception as e:
            print(f'ERROR:VM_NOT_RUNNING:{e}', flush=True)
            return None
        atexit.register(remote.logout)
        return cls(remote, config)

    def reload(self, config):
        self._buttons = _parse_buttons(config)

    def _channel(self, target):
        """'input0' / 'output1' -> that strip/bus, or None for anything else."""
        if target.startswith('input'):
            return self._vmr.inputs[int(target.removeprefix('input'))]
        if target.startswith('output'):
            return self._vmr.outputs[int(target.removeprefix('output'))]
        return None

    def set_gain(self, targets, value):
        for target in targets:
            try:
                if target.startswith('input'):
                    self._vmr.inputs[int(target.removeprefix('input'))].gain = int(_scalar_to_gain(value))
                elif target.startswith('output'):
                    self._vmr.outputs[int(target.removeprefix('output'))].gain = round(_scalar_to_gain(value), 1)
            except Exception as e:
                print(f"Failed to set VoiceMeeter gain for '{target}': {e}")

    def set_mute(self, targets, state):
        for target in targets:
            try:
                channel = self._channel(target)
                if channel is not None:
                    channel.mute = state
            except Exception as e:
                print(f"Failed to set VoiceMeeter mute for '{target}': {e}")

    def handle_button_line(self, line):
        """'<id>=' presses / '<id>!=' releases a device button mapped in config['Buttons']."""
        if line.endswith('!='):
            self._set_button(line.strip('!='), False)
        else:
            self._set_button(line.strip('='), True)

    def _set_button(self, srep, state):
        if srep not in self._buttons:
            return
        for action in self._buttons[srep]:
            kind, control = action.split('.')
            target = self._vmr.inputs if 'Input' in kind else self._vmr.outputs
            channel = target[int(kind.strip('InputOutput'))]
            setattr(channel, control.lower(), state)
