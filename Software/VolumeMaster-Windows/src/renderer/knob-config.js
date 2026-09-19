import { state } from './state.js';
import { saveConfigAndSync } from './config-sync.js';
import { isPluginItem, pluginItemParts, pluginActionKey, pluginActionAllowsKind } from './plugins.js';
import {
  isBuiltinItem,
  builtinTypeFromDragName,
  getBuiltinTypeMeta,
  describeBuiltinAction,
} from './builtin-actions.js';

const ENCODER_MODE_DEFAULT = 'absolute';
const ENCODER_MODE_OPTIONS = [['absolute', 'Absolute'], ['increment', 'Increment']];

export function isProDevice() {
  return state.config.deviceModel === 'volumemaster_pro';
}

function getEncoderMode(knobId) {
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
      mapping.EncoderMode = select.value;
      await saveConfigAndSync();
      window._autoSaveActivePreset?.();
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
  }

  fields.appendChild(wrapper);

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
