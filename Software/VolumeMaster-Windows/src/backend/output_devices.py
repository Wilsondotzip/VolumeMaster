# Default output (render) device switching for main_pro.pyw — the 'switch_output'
# button action and the LIST_OUTPUTS / SET_OUTPUT stdin commands.
#
# Kept self-contained (no main_pro globals) so it could later move out into a
# standalone plugin once the plugin API supports what the selector needs.
#
# Switching goes through pycaw's AudioUtilities.SetDefaultDevice, which wraps
# the undocumented-but-stable IPolicyConfig::SetDefaultEndpoint — the same
# interface Windows' own Sound settings, EarTrumpet and SoundSwitch use.
from pycaw.pycaw import AudioUtilities, DEVICE_STATE
from pycaw.constants import EDataFlow, ERole

# Windows' Sound settings sets console + multimedia together; communications is
# a separate default that Discord/Teams/etc. use, switched too unless opted out.
_BASE_ROLES = [ERole.eConsole, ERole.eMultimedia]

# action id -> device id that was the default before that action switched away
# from it, so a second press can toggle back. In-memory only: after a backend
# restart the first press always switches *to* the target.
_previous_output = {}


def list_outputs():
    """Active render devices as [{'id', 'name'}]."""
    devices = AudioUtilities.GetAllDevices(
        data_flow=EDataFlow.eRender.value, device_state=DEVICE_STATE.ACTIVE.value
    )
    return [{'id': d.id, 'name': d.FriendlyName or d.id} for d in devices if d is not None]


def get_default_output_id():
    try:
        enumerator = AudioUtilities.GetDeviceEnumerator()
        return enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender.value, ERole.eMultimedia.value).GetId()
    except Exception:
        return None


def set_default_output(device_id, include_communications=True):
    roles = _BASE_ROLES + ([ERole.eCommunications] if include_communications else [])
    AudioUtilities.SetDefaultDevice(device_id, roles=roles)


def resolve_output(saved, outputs=None):
    """Find the active device for a saved {'id', 'name'} reference. Ids are stable
    across reboots but can change on driver reinstall / USB port change, so fall
    back to matching by name. Returns a device id, or None if it's not connected."""
    if not isinstance(saved, dict):
        return None
    outputs = list_outputs() if outputs is None else outputs
    saved_id, saved_name = saved.get('id'), saved.get('name')
    for d in outputs:
        if saved_id and d['id'] == saved_id:
            return d['id']
    for d in outputs:
        if saved_name and d['name'] == saved_name:
            return d['id']
    return None


def selector_items(include=None):
    """Items for the knob selector (see selector.py) and the index of the current
    default. `include` is the action's saved [{'id', 'name'}] list — empty/None
    means every active output; saved entries that aren't connected are skipped."""
    outputs = list_outputs()
    if include:
        wanted = {resolve_output(saved, outputs) for saved in include}
        outputs = [d for d in outputs if d['id'] in wanted]

    current_id = get_default_output_id()
    items = [
        {'id': d['id'], 'label': d['name'], 'detail': 'Current' if d['id'] == current_id else ''}
        for d in outputs
    ]
    index = next((i for i, d in enumerate(outputs) if d['id'] == current_id), 0)
    return items, index


def toggle_output(action_id, target, include_communications=True):
    """Switch to `target`; if it's already the default, switch back to whatever
    was default before this action last switched. Deciding from the live default
    (not a stored on/off flag) stays correct if the user changes device in
    Windows in between presses. Returns the new default's name, or None."""
    outputs = list_outputs()
    target_id = resolve_output(target, outputs)
    if not target_id:
        print(f"Output device '{(target or {}).get('name', '?')}' is not connected", flush=True)
        return None

    current_id = get_default_output_id()
    if current_id == target_id:
        previous_id = _previous_output.get(action_id)
        if not previous_id or previous_id == target_id or not any(d['id'] == previous_id for d in outputs):
            return None
        new_id = previous_id
    else:
        if current_id:
            _previous_output[action_id] = current_id
        new_id = target_id

    set_default_output(new_id, include_communications)
    return next((d['name'] for d in outputs if d['id'] == new_id), new_id)
