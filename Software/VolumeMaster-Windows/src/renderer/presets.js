import { state } from './state.js';
import { saveConfigAndSync, cloneConfig } from './config-sync.js';
import { renderAllKnobsAndApps } from './mappings.js';
import { showAlert } from './alerts.js';
import { renderPluginActionList } from './plugins.js';

// Preset selector: a compact trigger ("PRESET Gaming ▾") that opens a menu with
// the presets as rows (click to load) and New / Save / Delete as buttons along
// the bottom. New swaps the buttons for a name field; Delete asks to confirm in
// place. The selected preset also receives every mapping change automatically
// (window._autoSaveActivePreset); Save overwrites it with the current knobs.

const ROW = 'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[5px] text-sm text-left transition';
const MENU_BTN =
  'flex-1 px-2 py-1.5 rounded-[5px] text-xs font-semibold transition disabled:opacity-35 disabled:pointer-events-none';

let names = [];
let selected = null;   // selected preset name, or null for "no preset"
let naming = false;    // New: name field showing instead of the buttons
let confirmingDelete = false;
let confirmTimer = null;

const el = {};

async function refreshNames() {
  names = (await window.api.listPresets()) || [];
  if (selected && !names.includes(selected)) selected = null;
}

function setOpen(open) {
  el.menu.classList.toggle('hidden', !open);
  el.trigger.setAttribute('aria-expanded', String(open));
  if (!open) {
    naming = false;
    resetDelete();
  }
  render();
  if (open) el.menu.querySelector('[aria-checked="true"]')?.focus();
}

function isOpen() {
  return !el.menu.classList.contains('hidden');
}

function row(label, name) {
  const isSelected = name === selected;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitemradio');
  btn.setAttribute('aria-checked', String(isSelected));
  btn.className = `${ROW} ${isSelected ? 'bg-indigo-500/15 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`;

  const check = document.createElement('span');
  check.className = `w-4 text-indigo-400 shrink-0 ${isSelected ? '' : 'invisible'}`;
  check.textContent = '✓';
  const text = document.createElement('span');
  text.className = `truncate ${name ? '' : 'italic text-slate-400'}`;
  text.textContent = label;
  btn.append(check, text);

  btn.onclick = async () => {
    setOpen(false);
    if (name === selected) return;
    if (name) await loadPreset(name);
    else await selectNone();
  };
  return btn;
}

function menuButton(label, classes, onClick, disabled = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${MENU_BTN} ${classes}`;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return btn;
}

function renderFooter() {
  el.footer.textContent = '';

  if (naming) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.placeholder = 'New preset name';
    input.className =
      'flex-1 min-w-0 px-2 py-1.5 rounded-[5px] text-sm bg-slate-950 border border-slate-700 text-white placeholder-slate-500 outline-none focus:border-indigo-400';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') createPreset(input.value);
      if (e.key === 'Escape') {
        e.stopPropagation();
        naming = false;
        render();
      }
    };
    el.footer.append(
      input,
      menuButton('Create', 'flex-none bg-indigo-600 hover:bg-indigo-500 text-white', () => createPreset(input.value)),
      menuButton('Cancel', 'flex-none bg-slate-800 hover:bg-slate-700 text-slate-300', () => {
        naming = false;
        render();
      }),
    );
    requestAnimationFrame(() => input.focus());
    return;
  }

  const none = !selected;
  el.footer.append(
    menuButton('+ New', 'bg-slate-800 hover:bg-slate-700 text-slate-200', () => {
      naming = true;
      resetDelete();
      render();
    }),
    menuButton('Save', 'bg-indigo-600 hover:bg-indigo-500 text-white', savePreset, none),
    confirmingDelete
      ? menuButton('Confirm', 'bg-red-600 hover:bg-red-500 text-white', deletePreset)
      : menuButton('Delete', 'bg-slate-800 hover:bg-red-700 text-slate-200 hover:text-white', askDelete, none),
  );
}

function render() {
  if (!el.trigger) return;
  el.triggerName.textContent = selected || 'None';
  el.triggerName.classList.toggle('text-slate-400', !selected);
  el.trigger.title = selected ? `Preset: ${selected}` : 'No preset selected';

  if (!isOpen()) return;
  el.list.textContent = '';
  el.list.appendChild(row('No preset', null));
  for (const name of names) el.list.appendChild(row(name, name));
  renderFooter();
}

async function loadPreset(name) {
  const mappings = await window.api.loadPreset(name);
  if (!mappings) return;
  state.config.Mappings = cloneConfig(mappings);
  await saveConfigAndSync();
  await renderAllKnobsAndApps();
  await window.api.setLastPreset(name);
  selected = name;
  render();
  showAlert('success', `Preset "${name}" loaded`);
}

async function selectNone() {
  await window.api.setLastPreset(null);
  selected = null;
  render();
}

async function createPreset(rawName) {
  const name = rawName.trim();
  if (!name) return;
  await window.api.savePreset(name, state.config.Mappings);
  await window.api.setLastPreset(name);
  selected = name;
  await refreshNames();
  setOpen(false);
  showAlert('success', `Preset "${name}" created`);
}

async function savePreset() {
  if (!selected) return;
  await window.api.savePreset(selected, state.config.Mappings);
  setOpen(false);
  showAlert('success', `Preset "${selected}" saved`);
}

function askDelete() {
  confirmingDelete = true;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => {
    resetDelete();
    render();
  }, 4000);
  render();
}

function resetDelete() {
  clearTimeout(confirmTimer);
  confirmingDelete = false;
}

async function deletePreset() {
  const name = selected;
  resetDelete();
  if (!name) return;
  await window.api.deletePreset(name);
  selected = null;
  await window.api.setLastPreset(null);
  await refreshNames();
  setOpen(false);
  showAlert('success', `Preset "${name}" deleted`);
}

export async function setupPresets() {
  el.trigger = document.getElementById('presetTrigger');
  el.triggerName = document.getElementById('presetTriggerName');
  el.menu = document.getElementById('presetMenu');
  el.list = document.getElementById('presetList');
  el.footer = document.getElementById('presetFooter');
  if (Object.values(el).some((node) => !node)) return;

  el.trigger.addEventListener('click', () => setOpen(!isOpen()));
  // Close on a click outside the selector, or Escape
  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !el.menu.contains(e.target) && !el.trigger.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      el.trigger.focus();
    }
  });

  // Restore last used preset
  const lastPreset = await window.api.getLastPreset();
  await refreshNames();
  if (lastPreset && names.includes(lastPreset)) {
    selected = lastPreset;
    const mappings = await window.api.loadPreset(lastPreset);
    if (mappings) {
      state.config.Mappings = cloneConfig(mappings);
      await saveConfigAndSync();
      await renderAllKnobsAndApps();
    }
  }
  render();

  // A hardware button action (switch preset / knob mode) changed config.yaml in
  // the main process — adopt it, or the next renderer save would write the old
  // Mappings straight back over it.
  window.api.onConfigChanged(async ({ config, loadedPreset }) => {
    if (!config) return;
    state.config = cloneConfig(config);
    await refreshNames();
    selected = config.lastPreset && names.includes(config.lastPreset) ? config.lastPreset : null;
    render();
    await renderAllKnobsAndApps();
    renderPluginActionList();
    if (loadedPreset) showAlert('success', `Preset "${loadedPreset}" loaded`);
  });

  // Auto-save current mappings into the selected preset (called by mappings.js on changes)
  window._autoSaveActivePreset = async () => {
    if (!selected) return;
    await window.api.savePreset(selected, state.config.Mappings);
  };
}
