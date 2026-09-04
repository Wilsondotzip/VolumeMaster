import { state } from './state.js';
import { saveConfigAndSync } from './config-sync.js';
import { isPluginItem, pluginItemParts, pluginActionKey, PLUGIN_PREFIX, pluginActionAllowsKind } from './plugins.js';

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
// target for plugin action cards from the Plugins sub-tab, and a modal's
// backdrop would block pointer events to that source list while open.

function getButtonActions(knobId) {
  const list = state.config.Mappings[knobId]?.ButtonActions;
  return Array.isArray(list) ? list : [];
}

function createButtonActionCard(actionKey, knobId, host) {
  const dragName = `${PLUGIN_PREFIX}${actionKey}`;
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 p-2 rounded border border-cyan-600 bg-cyan-900 bg-opacity-30 hover:bg-red-900 hover:bg-opacity-30 hover:border-red-500 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-button-action', actionKey);

  const icon = document.createElement('div');
  icon.className = 'w-8 h-8 rounded bg-cyan-700 flex items-center justify-center text-lg shrink-0';
  icon.textContent = '🔌';

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const { pluginId, actionId } = pluginItemParts(dragName);
  const plugin = state.pluginActions.find((p) => p.pluginId === pluginId);
  const action = plugin?.actions.find((a) => a.id === actionId);

  const labelEl = document.createElement('div');
  labelEl.textContent = action?.label ?? actionKey;
  labelEl.className = 'text-sm font-semibold text-cyan-300';

  const sub = document.createElement('div');
  sub.textContent = plugin ? plugin.name : `${pluginId} (offline)`;
  sub.className = 'text-xs text-slate-500';

  textCol.append(labelEl, sub);
  card.append(icon, textCol);

  card.onclick = async () => {
    const mapping = state.config.Mappings[knobId];
    if (!mapping) return;
    const list = getButtonActions(knobId);
    const idx = list.indexOf(actionKey);
    if (idx === -1) return;
    list.splice(idx, 1);
    mapping.ButtonActions = list;
    await saveConfigAndSync();
    window._autoSaveActivePreset?.();
    card.remove();
    refreshButtonActionEmptyState(host);
  };

  return card;
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
  msg.textContent = 'Drag a plugin action here.';
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

  for (const actionKey of getButtonActions(knobId)) {
    host.appendChild(createButtonActionCard(actionKey, knobId, host));
  }
  refreshButtonActionEmptyState(host);

  wrapper.appendChild(host);
  return wrapper;
}

export function isButtonActionHost(target) {
  return !!target?.closest?.('[data-button-action-host]');
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

  if (!isPluginItem(name)) return;

  const { pluginId, actionId } = pluginItemParts(name);
  if (!pluginActionAllowsKind(pluginId, actionId, 'button')) return;
  const key = pluginActionKey(pluginId, actionId);

  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;
  const list = getButtonActions(knobId);
  if (list.includes(key)) return;
  list.push(key);
  mapping.ButtonActions = list;

  await saveConfigAndSync();
  window._autoSaveActivePreset?.();

  host.querySelector('[data-button-action-empty]')?.remove();
  host.appendChild(createButtonActionCard(key, knobId, host));
}
