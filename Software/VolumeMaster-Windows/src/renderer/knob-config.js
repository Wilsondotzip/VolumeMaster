import { state } from './state.js';
import { saveConfigAndSync } from './config-sync.js';
import { isPluginItem, pluginItemParts, pluginActionKey, pluginActionAllowsKind } from './plugins.js';
import {
  isBuiltinItem,
  builtinTypeFromDragName,
  getBuiltinTypeMeta,
  describeBuiltinAction,
  isBuiltinTurnCompatible,
} from './builtin-actions.js';

const ENCODER_MODE_DEFAULT = 'absolute';
const ENCODER_MODE_OPTIONS = [['absolute', 'Absolute'], ['increment', 'Increment']];

export function isProDevice() {
  return state.config.deviceModel === 'volumemaster_pro';
}

export function getEncoderMode(knobId) {
  return state.config.Mappings[knobId]?.EncoderMode || ENCODER_MODE_DEFAULT;
}

export function createKnobConfigButton(knobId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Configure knob';
  btn.className =
    'ml-auto shrink-0 p-1.5 rounded text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition';
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  btn.onclick = () => openKnobConfigModal(knobId);
  return btn;
}

// Pro knobs can be switched between absolute and incremental encoder reporting;
// the backend sends the corresponding mode command to the device on change.
function openKnobConfigModal(knobId) {
  const modal = document.getElementById('knobConfigModal');
  if (!modal) return;
  document.getElementById('knobConfigModalTitle').textContent = `Configure Knob ${knobId}`;

  const fields = document.getElementById('knobConfigFields');
  fields.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-1';

  const label = document.createElement('label');
  label.className = 'text-xs text-gray-400';
  label.textContent = 'Encoder Mode';
  label.htmlFor = 'knobConfigEncoderMode';

  const select = document.createElement('select');
  select.id = 'knobConfigEncoderMode';
  select.className =
    'w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 focus:outline-none focus:border-indigo-500';
  for (const [value, optLabel] of ENCODER_MODE_OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = optLabel;
    select.appendChild(option);
  }
  select.value = getEncoderMode(knobId);

  wrapper.append(label, select);
  fields.appendChild(wrapper);

  document.getElementById('knobConfigSaveBtn').onclick = async () => {
    const mapping = state.config.Mappings[knobId];
    if (mapping) {
      const modeChanged = select.value !== getEncoderMode(knobId);
      mapping.EncoderMode = select.value;
      await saveConfigAndSync();
      window._autoSaveActivePreset?.();
      // Turn Action sections only render in increment mode — re-render this
      // knob's card so they appear/disappear immediately rather than only
      // after the next unrelated re-render. Dynamic import avoids a static
      // circular dependency (mappings.js already imports from this module).
      if (modeChanged) {
        const { renderAllKnobsAndApps } = await import('./mappings.js');
        await renderAllKnobsAndApps();
      }
    }
    modal.close();
  };
  document.getElementById('knobConfigCancelBtn').onclick = () => modal.close();
  document.getElementById('knobConfigCloseBtn').onclick = () => modal.close();

  modal.showModal();
}

// --- Button press action (Pro only) -----------------------------------------
//
// Lives inline on the knob card rather than in the modal above: it's a drag
// target for cards from the Plugins and Actions sub-tabs, and a modal's
// backdrop would block pointer events to those source lists while open.
//
// Mappings[knobId].ButtonActions is an array of either:
//   { kind: 'plugin', key: 'pluginId:actionId' }
//   { kind: 'builtin', type: 'keyboard_shortcut'|'mute'|'open_program', id, params }
//   { kind: 'builtin', type: 'switch_preset', id, params: { mode: 'next'|'previous'|'specific', name? } }
//   { kind: 'builtin', type: 'encoder_mode', id, params: { knob: ''|'<knobId>', mode: 'toggle'|'absolute'|'increment' } }
// The last two are executed by the Electron main process, not the Python backend.

function getButtonActions(knobId) {
  const list = state.config.Mappings[knobId]?.ButtonActions;
  if (!Array.isArray(list)) return [];
  // Migrate the older bare-string plugin-key format ("pluginId:actionId") transparently;
  // re-saved as the current { kind: 'plugin', key } shape the next time this knob changes.
  return list.map((entry) => (typeof entry === 'string' ? { kind: 'plugin', key: entry } : entry));
}

/** Stable per-entry identifier for DOM lookups/removal (a plugin key is already unique per knob). */
function buttonActionUid(entry) {
  return entry.kind === 'builtin' ? entry.id : entry.key;
}

async function removeButtonAction(knobId, entry, card, host) {
  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;
  const list = getButtonActions(knobId);
  const idx = list.findIndex((e) => buttonActionUid(e) === buttonActionUid(entry));
  if (idx === -1) return;
  list.splice(idx, 1);
  mapping.ButtonActions = list;
  await saveConfigAndSync();
  window._autoSaveActivePreset?.();
  card.remove();
  refreshButtonActionEmptyState(host);
}

function createRemoveBadge(onRemove) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Remove';
  btn.className = 'ml-auto shrink-0 text-slate-500 hover:text-red-400 transition text-sm leading-none px-1';
  btn.textContent = '✕';
  btn.onclick = (e) => {
    e.stopPropagation();
    onRemove();
  };
  return btn;
}

function createPluginButtonActionCard(entry, knobId, host) {
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 p-2 rounded border border-cyan-600 bg-cyan-900 bg-opacity-30 hover:bg-red-900 hover:bg-opacity-30 hover:border-red-500 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-button-action', buttonActionUid(entry));

  const icon = document.createElement('div');
  icon.className = 'w-8 h-8 rounded bg-cyan-700 flex items-center justify-center text-lg shrink-0';
  icon.textContent = '🔌';

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const colonIdx = entry.key.indexOf(':');
  const pluginId = entry.key.slice(0, colonIdx);
  const actionId = entry.key.slice(colonIdx + 1);
  const plugin = state.pluginActions.find((p) => p.pluginId === pluginId);
  const action = plugin?.actions.find((a) => a.id === actionId);

  const labelEl = document.createElement('div');
  labelEl.textContent = action?.label ?? entry.key;
  labelEl.className = 'text-sm font-semibold text-cyan-300';

  const sub = document.createElement('div');
  sub.textContent = plugin ? plugin.name : `${pluginId} (offline)`;
  sub.className = 'text-xs text-slate-500';

  textCol.append(labelEl, sub);
  card.append(icon, textCol);

  card.onclick = () => removeButtonAction(knobId, entry, card, host);

  return card;
}

function createBuiltinButtonActionCard(entry, knobId, host) {
  const meta = getBuiltinTypeMeta(entry.type);
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 p-2 rounded border border-amber-600 bg-amber-900 bg-opacity-20 hover:border-amber-400 transition overflow-hidden';
  card.setAttribute('data-button-action', buttonActionUid(entry));

  const icon = document.createElement('div');
  icon.className = 'w-8 h-8 rounded bg-amber-700 flex items-center justify-center text-lg shrink-0';
  icon.textContent = meta?.icon ?? '⚙️';

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const labelEl = document.createElement('div');
  labelEl.textContent = meta?.label ?? entry.type;
  labelEl.className = 'text-sm font-semibold text-amber-300';

  const sub = document.createElement('div');
  sub.textContent = describeBuiltinAction(entry);
  sub.className = 'text-xs text-slate-500 truncate';
  sub.setAttribute('data-button-action-sub', '');

  textCol.append(labelEl, sub);
  card.append(icon, textCol);
  card.classList.add('cursor-pointer');

  if (meta?.configurable) {
    card.onclick = () => openButtonActionConfigModal(knobId, entry, sub);
    card.appendChild(createRemoveBadge(() => removeButtonAction(knobId, entry, card, host)));
  } else {
    card.onclick = () => removeButtonAction(knobId, entry, card, host);
  }

  return card;
}

function createButtonActionCard(entry, knobId, host) {
  return entry.kind === 'builtin'
    ? createBuiltinButtonActionCard(entry, knobId, host)
    : createPluginButtonActionCard(entry, knobId, host);
}

function refreshButtonActionEmptyState(host) {
  const hasCards = !!host.querySelector('[data-button-action]');
  const existingMsg = host.querySelector('[data-button-action-empty]');
  if (hasCards) {
    existingMsg?.remove();
    return;
  }
  if (existingMsg) return;
  const msg = document.createElement('p');
  msg.setAttribute('data-button-action-empty', '');
  msg.className = 'text-xs text-slate-500 italic';
  msg.textContent = 'Drag a plugin or built-in action here.';
  host.appendChild(msg);
}

export function createButtonActionSection(knobId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mt-3 pt-3 border-t border-slate-700 shrink-0';

  const label = document.createElement('div');
  label.className = 'text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2';
  label.textContent = 'Button Press Action';
  wrapper.appendChild(label);

  const host = document.createElement('div');
  host.className = 'flex flex-col gap-2 min-h-12 rounded border border-dashed border-slate-700 p-2';
  host.setAttribute('data-button-action-host', '');

  for (const entry of getButtonActions(knobId)) {
    host.appendChild(createButtonActionCard(entry, knobId, host));
  }
  refreshButtonActionEmptyState(host);

  wrapper.appendChild(host);
  return wrapper;
}

export function isButtonActionHost(target) {
  return !!target?.closest?.('[data-button-action-host]');
}

// Maps DOM KeyboardEvent.key values to the names the Python `keyboard` package
// (keyboard.send()) expects. Anything not listed here is just lowercased.
const SHORTCUT_KEY_NAME_MAP = {
  ' ': 'space',
  'Escape': 'esc',
  'ArrowUp': 'up',
  'ArrowDown': 'down',
  'ArrowLeft': 'left',
  'ArrowRight': 'right',
  'Enter': 'enter',
  'Backspace': 'backspace',
  'Delete': 'delete',
  'Tab': 'tab',
  'PageUp': 'page up',
  'PageDown': 'page down',
  'Home': 'home',
  'End': 'end',
  'Insert': 'insert',
  'CapsLock': 'caps lock',
};

const SHORTCUT_MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function capitalize(s) {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function normalizeShortcutKeyName(key) {
  return SHORTCUT_KEY_NAME_MAP[key] || key.toLowerCase();
}

/** Live preview while only modifiers are held, e.g. "Ctrl+Shift+…". */
function describeHeldModifiers(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Windows');
  return parts.length ? `${parts.join('+')}+…` : '';
}

/** Builds the final "Ctrl+Shift+M"-style string once a non-modifier key is pressed. */
function buildShortcutString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Windows');
  parts.push(capitalize(normalizeShortcutKeyName(e.key)));
  return parts.join('+');
}

/** Wires an input up as a press-to-record hotkey field instead of free text entry. */
function makeShortcutRecorderInput(input, initialValue) {
  let capturedKeys = initialValue || '';
  input.readOnly = true;
  input.value = capturedKeys;

  function onKeyDown(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      input.blur();
      return;
    }
    if (SHORTCUT_MODIFIER_KEYS.has(e.key)) {
      input.value = describeHeldModifiers(e) || 'Press a key…';
      return;
    }

    capturedKeys = buildShortcutString(e);
    input.value = capturedKeys;
    input.blur();
  }

  input.addEventListener('focus', () => {
    input.classList.add('border-indigo-400', 'ring-1', 'ring-indigo-400');
    input.value = 'Press a key combo…';
    input.addEventListener('keydown', onKeyDown);
  });
  input.addEventListener('blur', () => {
    input.classList.remove('border-indigo-400', 'ring-1', 'ring-indigo-400');
    input.removeEventListener('keydown', onKeyDown);
    input.value = capturedKeys;
  });

  return {
    getValue: () => capturedKeys,
    clear: () => {
      capturedKeys = '';
      input.value = '';
      input.blur();
    },
  };
}

/**
 * Builds the param fields for a builtin action's type (keyboard combo, program
 * path) into `fields`, returning a getValue() that reads back the current form
 * state. Shared by the button-press and turn-action config modals below.
 */
function buildBuiltinActionFields(entry, fields) {
  if (!entry.params || typeof entry.params !== 'object') entry.params = {};

  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-1';

  let getValue = () => entry.params;

  if (entry.type === 'keyboard_shortcut') {
    const label = document.createElement('label');
    label.className = 'text-xs text-gray-400';
    label.textContent = 'Key Combination';
    label.htmlFor = 'knobConfigActionInput';

    const row = document.createElement('div');
    row.className = 'flex gap-2';

    const input = document.createElement('input');
    input.id = 'knobConfigActionInput';
    input.type = 'text';
    input.placeholder = 'Click, then press a key combo…';
    input.className =
      'flex-1 px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 placeholder-slate-500 focus:outline-none cursor-pointer caret-transparent';

    const recorder = makeShortcutRecorderInput(input, entry.params.keys || '');

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.className =
      'px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition font-medium shrink-0';
    clearBtn.onclick = () => recorder.clear();

    row.append(input, clearBtn);
    wrapper.append(label, row);

    const hint = document.createElement('p');
    hint.className = 'text-xs text-slate-500';
    hint.textContent = 'Press Esc to cancel while recording.';
    wrapper.appendChild(hint);

    getValue = () => ({ keys: recorder.getValue() });
  } else if (entry.type === 'open_program') {
    const label = document.createElement('label');
    label.className = 'text-xs text-gray-400';
    label.textContent = 'Program';

    const row = document.createElement('div');
    row.className = 'flex gap-2';

    const pathText = document.createElement('div');
    pathText.className =
      'flex-1 px-2 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-gray-300 truncate';
    pathText.textContent = entry.params.path || 'No program selected';

    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.textContent = 'Browse…';
    browseBtn.className =
      'px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition font-medium shrink-0';
    browseBtn.onclick = async () => {
      const exePath = await window.api.openExeDialog();
      if (exePath) {
        pathText.textContent = exePath;
        pathText.dataset.path = exePath;
      }
    };
    if (entry.params.path) pathText.dataset.path = entry.params.path;

    row.append(pathText, browseBtn);
    wrapper.append(label, row);
    getValue = () => ({ path: pathText.dataset.path || '' });
  } else if (entry.type === 'switch_preset') {
    const modeSelect = createSelectField(wrapper, 'Action', [
      ['next', 'Next preset'],
      ['previous', 'Previous preset'],
      ['specific', 'Specific preset'],
      ['selector', 'Choose with knob (popup)'],
    ], entry.params.mode || 'next');

    const presetWrap = document.createElement('div');
    presetWrap.className = 'flex flex-col gap-1 mt-2';
    const presetSelect = createSelectField(presetWrap, 'Preset', [], '');
    wrapper.appendChild(presetWrap);

    const hint = document.createElement('p');
    hint.className = 'text-xs text-slate-500 mt-1';
    hint.textContent =
      'Presets store their own button actions — add this action to each preset you want to be able to switch away from.';
    wrapper.appendChild(hint);

    const syncPresetVisibility = () => presetWrap.classList.toggle('hidden', modeSelect.value !== 'specific');
    modeSelect.addEventListener('change', syncPresetVisibility);
    syncPresetVisibility();

    window.api.listPresets().then((names) => {
      const saved = entry.params.name || '';
      const options = [...(names || [])];
      if (saved && !options.includes(saved)) options.unshift(saved);
      if (!options.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No presets yet';
        presetSelect.appendChild(opt);
      }
      for (const name of options) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        presetSelect.appendChild(opt);
      }
      presetSelect.value = saved || options[0] || '';
    });

    getValue = () =>
      modeSelect.value === 'specific'
        ? { mode: 'specific', name: presetSelect.value }
        : { mode: modeSelect.value };
  } else if (entry.type === 'encoder_mode') {
    const knobIds = Object.keys(state.config.Mappings || {}).sort((a, b) => Number(a) - Number(b));
    const knobSelect = createSelectField(wrapper, 'Knob', [
      ['', 'This knob'],
      ...knobIds.map((id) => [id, state.config.Mappings[id]?.Name || `Knob ${id}`]),
    ], entry.params.knob || '');

    const modeWrap = document.createElement('div');
    modeWrap.className = 'flex flex-col gap-1 mt-2';
    const modeSelect = createSelectField(modeWrap, 'Mode', [
      ['toggle', 'Toggle Absolute / Increment'],
      ['absolute', 'Set to Absolute'],
      ['increment', 'Set to Increment'],
    ], entry.params.mode || 'toggle');
    wrapper.appendChild(modeWrap);

    getValue = () => ({ knob: knobSelect.value, mode: modeSelect.value });
  } else if (entry.type === 'switch_output') {
    const saved = entry.params.device || null;
    const savedIncluded = Array.isArray(entry.params.devices) ? entry.params.devices : [];
    const sameDevice = (a, b) => a.id === b.id || a.name === b.name;

    const modeSelect = createSelectField(wrapper, 'Action', [
      ['toggle', 'Toggle to a device and back'],
      ['selector', 'Choose with knob (popup)'],
    ], entry.params.mode || 'toggle');

    // --- toggle mode
    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'flex flex-col gap-1 mt-2';
    const deviceSelect = createSelectField(toggleWrap, 'Output Device', [], '');
    const toggleHint = document.createElement('p');
    toggleHint.className = 'text-xs text-slate-500 mt-1';
    toggleHint.textContent = 'Press to switch to this output; press again to switch back to the previous one.';
    toggleWrap.appendChild(toggleHint);
    wrapper.appendChild(toggleWrap);

    // --- selector mode
    const selectorWrap = document.createElement('div');
    selectorWrap.className = 'flex flex-col gap-1 mt-2';
    const listLabel = document.createElement('div');
    listLabel.className = 'text-xs text-gray-400';
    listLabel.textContent = 'Show in popup';
    const checklist = document.createElement('div');
    checklist.className =
      'flex flex-col gap-1 max-h-48 overflow-y-auto p-2 bg-slate-900 border border-slate-700 rounded';
    const selectorHint = document.createElement('p');
    selectorHint.className = 'text-xs text-slate-500 mt-1';
    selectorHint.textContent =
      'Press to open the list, turn this knob to choose, press again to switch. Nothing ticked shows every output.';
    selectorWrap.append(listLabel, checklist, selectorHint);
    wrapper.appendChild(selectorWrap);

    const syncModeVisibility = () => {
      toggleWrap.classList.toggle('hidden', modeSelect.value !== 'toggle');
      selectorWrap.classList.toggle('hidden', modeSelect.value !== 'selector');
    };
    modeSelect.addEventListener('change', syncModeVisibility);
    syncModeVisibility();

    const commsRow = document.createElement('label');
    commsRow.className = 'flex items-center gap-2 mt-2 text-xs text-gray-400 cursor-pointer';
    const commsCheckbox = document.createElement('input');
    commsCheckbox.type = 'checkbox';
    commsCheckbox.checked = entry.params.communications !== false;
    commsRow.append(commsCheckbox, 'Also switch the communications device (Discord, Teams…)');
    wrapper.appendChild(commsRow);

    // The device list comes from the running backend (it owns the audio APIs).
    // Saved devices that aren't currently connected stay listed so re-saving
    // the action doesn't silently drop them.
    let devices = saved ? [saved] : [];
    let checkboxes = []; // [{ device, input }]
    window.api.listOutputDevices().then(({ devices: live = [] }) => {
      const missing = (list) => list.filter((s) => !live.some((d) => sameDevice(d, s)));
      const describe = (d) => (live.includes(d) ? d.name : `${d.name} (not connected)`);
      const emptyText = 'Start VolumeMaster (Run) to list devices';

      devices = [...(saved ? missing([saved]) : []), ...live];
      if (!devices.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = emptyText;
        deviceSelect.appendChild(opt);
      }
      devices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = describe(d);
        deviceSelect.appendChild(opt);
      });
      const savedIdx = saved ? devices.findIndex((d) => sameDevice(d, saved)) : -1;
      deviceSelect.value = String(Math.max(savedIdx, 0));

      const checklistDevices = [...missing(savedIncluded), ...live];
      if (!checklistDevices.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-slate-500 italic';
        empty.textContent = emptyText;
        checklist.appendChild(empty);
      }
      checkboxes = checklistDevices.map((device) => {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-xs text-gray-300 cursor-pointer';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = savedIncluded.some((s) => sameDevice(device, s));
        const text = document.createElement('span');
        text.className = 'truncate';
        text.textContent = describe(device);
        row.append(input, text);
        checklist.appendChild(row);
        return { device, input };
      });
    });

    getValue = () => {
      const d = devices[Number(deviceSelect.value)];
      // Before the device list has loaded, keep whatever was saved.
      const included = checkboxes.length
        ? checkboxes.filter((c) => c.input.checked).map(({ device }) => ({ id: device.id, name: device.name }))
        : savedIncluded;
      return {
        mode: modeSelect.value,
        device: d ? { id: d.id, name: d.name } : saved,
        devices: included,
        communications: commsCheckbox.checked,
      };
    };
  }

  fields.appendChild(wrapper);
  return getValue;
}

/** Appends a labelled <select> to `parent` and returns the select element. */
function createSelectField(parent, labelText, options, value) {
  const label = document.createElement('label');
  label.className = 'text-xs text-gray-400';
  label.textContent = labelText;

  const select = document.createElement('select');
  select.className =
    'w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 focus:outline-none focus:border-indigo-500';
  for (const [optValue, optLabel] of options) {
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optLabel;
    select.appendChild(option);
  }
  select.value = value;

  parent.append(label, select);
  return select;
}

/** Reuses the knob config dialog to fill in a built-in action's params (key combo, program path). */
function openButtonActionConfigModal(knobId, entry, sub) {
  const modal = document.getElementById('knobConfigModal');
  if (!modal) return;
  // `entry` may go stale by save-time — saveConfigAndSync() replaces state.config
  // wholesale with a fresh clone from the main process, so any object reference
  // held from before that round-trip no longer belongs to the live config tree.
  const uid = buttonActionUid(entry);
  const meta = getBuiltinTypeMeta(entry.type);
  document.getElementById('knobConfigModalTitle').textContent = `Configure ${meta?.label ?? entry.type}`;

  const fields = document.getElementById('knobConfigFields');
  fields.innerHTML = '';

  const getValue = buildBuiltinActionFields(entry, fields);

  document.getElementById('knobConfigSaveBtn').onclick = async () => {
    const current = getButtonActions(knobId).find((e) => buttonActionUid(e) === uid);
    if (current) current.params = getValue();
    await saveConfigAndSync();
    window._autoSaveActivePreset?.();
    if (sub) sub.textContent = describeBuiltinAction(current || entry);
    modal.close();
  };
  document.getElementById('knobConfigCancelBtn').onclick = () => modal.close();
  document.getElementById('knobConfigCloseBtn').onclick = () => modal.close();

  modal.showModal();
}

export async function handleButtonActionDrop(event, knobId) {
  const host = event.target.closest('[data-button-action-host]');
  if (!host || !knobId) return;

  let name = '';
  try {
    name = event.dataTransfer?.getData('text/plain') || '';
  } catch {
    // Electron/Chromium sometimes throws reading dataTransfer on drop; fall back below.
  }
  if (!name && state.mappingDragPayload?.name) name = state.mappingDragPayload.name;
  name = name.trim();
  state.mappingDragPayload = null;

  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;
  const list = getButtonActions(knobId);

  let entry;
  if (isPluginItem(name)) {
    const { pluginId, actionId } = pluginItemParts(name);
    if (!pluginActionAllowsKind(pluginId, actionId, 'button')) return;
    const key = pluginActionKey(pluginId, actionId);
    if (list.some((e) => e.kind === 'plugin' && e.key === key)) return;
    entry = { kind: 'plugin', key };
  } else if (isBuiltinItem(name)) {
    const type = builtinTypeFromDragName(name);
    if (!getBuiltinTypeMeta(type)) return;
    // Mute is parameterless and toggles — a second copy on the same knob would
    // flip it on then immediately back off on every press. Keyboard shortcuts
    // and Open Program each carry their own params, so duplicates are fine there.
    if (type === 'mute' && list.some((e) => e.kind === 'builtin' && e.type === 'mute')) return;
    entry = { kind: 'builtin', type, id: crypto.randomUUID(), params: {} };
  } else {
    return;
  }

  list.push(entry);
  mapping.ButtonActions = list;

  await saveConfigAndSync();
  window._autoSaveActivePreset?.();

  host.querySelector('[data-button-action-empty]')?.remove();
  const card = createButtonActionCard(entry, knobId, host);
  host.appendChild(card);

  if (entry.kind === 'builtin' && getBuiltinTypeMeta(entry.type)?.configurable) {
    const sub = card.querySelector('[data-button-action-sub]');
    openButtonActionConfigModal(knobId, entry, sub);
  }
}

// --- Turn action (Pro only, EncoderMode 'increment' only) -------------------
//
// Mappings[knobId].TurnLeftActions / TurnRightActions: array of
// { kind: 'builtin', type: 'keyboard_shortcut'|'mute'|'open_program', id, params }.
// Builtin only — no plugin dispatch for turn ticks (yet). Replaces volume
// control entirely for that knob rather than running alongside it.

function turnActionsKey(direction) {
  return direction === 'left' ? 'TurnLeftActions' : 'TurnRightActions';
}

function getTurnActions(knobId, direction) {
  const list = state.config.Mappings[knobId]?.[turnActionsKey(direction)];
  return Array.isArray(list) ? list : [];
}

async function removeTurnAction(knobId, direction, entry, card, host) {
  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;
  const list = getTurnActions(knobId, direction);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx === -1) return;
  list.splice(idx, 1);
  mapping[turnActionsKey(direction)] = list;
  await saveConfigAndSync();
  window._autoSaveActivePreset?.();
  card.remove();
  refreshTurnActionEmptyState(host);
}

function createTurnActionCard(entry, knobId, direction, host) {
  const meta = getBuiltinTypeMeta(entry.type);
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 p-2 rounded border border-amber-600 bg-amber-900 bg-opacity-20 hover:border-amber-400 transition overflow-hidden cursor-pointer';
  card.setAttribute('data-turn-action', entry.id);

  const icon = document.createElement('div');
  icon.className = 'w-8 h-8 rounded bg-amber-700 flex items-center justify-center text-lg shrink-0';
  icon.textContent = meta?.icon ?? '⚙️';

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const labelEl = document.createElement('div');
  labelEl.textContent = meta?.label ?? entry.type;
  labelEl.className = 'text-sm font-semibold text-amber-300 truncate';

  const sub = document.createElement('div');
  sub.textContent = describeBuiltinAction(entry);
  sub.className = 'text-xs text-slate-500 truncate';
  sub.setAttribute('data-turn-action-sub', '');

  textCol.append(labelEl, sub);
  card.append(icon, textCol);

  if (meta?.configurable) {
    card.onclick = () => openTurnActionConfigModal(knobId, direction, entry, sub);
    card.appendChild(createRemoveBadge(() => removeTurnAction(knobId, direction, entry, card, host)));
  } else {
    card.onclick = () => removeTurnAction(knobId, direction, entry, card, host);
  }

  return card;
}

function refreshTurnActionEmptyState(host) {
  const hasCards = !!host.querySelector('[data-turn-action]');
  const existingMsg = host.querySelector('[data-turn-action-empty]');
  if (hasCards) {
    existingMsg?.remove();
    return;
  }
  if (existingMsg) return;
  const msg = document.createElement('p');
  msg.setAttribute('data-turn-action-empty', '');
  msg.className = 'text-[11px] text-slate-500 italic';
  msg.textContent = 'Drag a built-in action here.';
  host.appendChild(msg);
}

function createTurnActionZone(knobId, direction, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-1 flex-1 min-w-0';

  const labelEl = document.createElement('div');
  labelEl.className = 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide';
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  const host = document.createElement('div');
  host.className = 'flex flex-col gap-2 min-h-12 rounded border border-dashed border-slate-700 p-2';
  host.setAttribute('data-turn-action-host', direction);

  for (const entry of getTurnActions(knobId, direction)) {
    host.appendChild(createTurnActionCard(entry, knobId, direction, host));
  }
  refreshTurnActionEmptyState(host);

  wrapper.appendChild(host);
  return wrapper;
}

/** Only rendered when the knob's EncoderMode is 'increment' — see createKnobSection in mappings.js. */
export function createTurnActionSection(knobId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mt-3 pt-3 border-t border-slate-700 shrink-0';

  const label = document.createElement('div');
  label.className = 'text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2';
  label.textContent = 'Turn Action';
  wrapper.appendChild(label);

  const row = document.createElement('div');
  row.className = 'flex gap-2';
  row.append(createTurnActionZone(knobId, 'left', '← Left'), createTurnActionZone(knobId, 'right', 'Right →'));
  wrapper.appendChild(row);

  return wrapper;
}

/** Returns 'left' | 'right' if target is inside a turn-action drop zone, else null. */
export function getTurnActionHostDirection(target) {
  return target?.closest?.('[data-turn-action-host]')?.getAttribute('data-turn-action-host') || null;
}

function openTurnActionConfigModal(knobId, direction, entry, sub) {
  const modal = document.getElementById('knobConfigModal');
  if (!modal) return;
  const uid = entry.id;
  const meta = getBuiltinTypeMeta(entry.type);
  document.getElementById('knobConfigModalTitle').textContent = `Configure ${meta?.label ?? entry.type}`;

  const fields = document.getElementById('knobConfigFields');
  fields.innerHTML = '';

  const getValue = buildBuiltinActionFields(entry, fields);

  document.getElementById('knobConfigSaveBtn').onclick = async () => {
    const current = getTurnActions(knobId, direction).find((e) => e.id === uid);
    if (current) current.params = getValue();
    await saveConfigAndSync();
    window._autoSaveActivePreset?.();
    if (sub) sub.textContent = describeBuiltinAction(current || entry);
    modal.close();
  };
  document.getElementById('knobConfigCancelBtn').onclick = () => modal.close();
  document.getElementById('knobConfigCloseBtn').onclick = () => modal.close();

  modal.showModal();
}

export async function handleTurnActionDrop(event, knobId, direction) {
  const host = event.target.closest('[data-turn-action-host]');
  if (!host || !knobId) return;

  let name = '';
  try {
    name = event.dataTransfer?.getData('text/plain') || '';
  } catch {
    // Electron/Chromium sometimes throws reading dataTransfer on drop; fall back below.
  }
  if (!name && state.mappingDragPayload?.name) name = state.mappingDragPayload.name;
  name = name.trim();
  state.mappingDragPayload = null;

  if (!isBuiltinItem(name) || !isBuiltinTurnCompatible(name)) return;
  const type = builtinTypeFromDragName(name);

  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;
  const list = getTurnActions(knobId, direction);
  // Same reasoning as the button-action zone: a second parameterless Mute
  // would just flip itself back off on every tick.
  if (type === 'mute' && list.some((e) => e.type === 'mute')) return;

  const entry = { kind: 'builtin', type, id: crypto.randomUUID(), params: {} };
  list.push(entry);
  mapping[turnActionsKey(direction)] = list;

  await saveConfigAndSync();
  window._autoSaveActivePreset?.();

  host.querySelector('[data-turn-action-empty]')?.remove();
  const card = createTurnActionCard(entry, knobId, direction, host);
  host.appendChild(card);

  if (getBuiltinTypeMeta(entry.type)?.configurable) {
    const sub = card.querySelector('[data-turn-action-sub]');
    openTurnActionConfigModal(knobId, direction, entry, sub);
  }
}
