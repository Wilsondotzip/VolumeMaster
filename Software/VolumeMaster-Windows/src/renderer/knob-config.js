import { state } from './state.js';
import { saveConfigAndSync } from './config-sync.js';

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
