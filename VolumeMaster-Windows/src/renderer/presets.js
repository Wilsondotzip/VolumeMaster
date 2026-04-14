import { state } from './state.js';
import { saveConfigAndSync, cloneConfig } from './config-sync.js';
import { renderAllKnobsAndApps } from './mappings.js';
import { showAlert } from './alerts.js';

async function refreshPresetDropdown(selectEl, selectedName = null) {
  const names = await window.api.listPresets();
  selectEl.innerHTML = '<option value="">— No Preset —</option>';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === selectedName) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function showNameRow(presetsBar, nameRow, nameInput) {
  presetsBar.classList.add('hidden');
  nameRow.classList.remove('hidden');
  nameInput.value = '';
  nameInput.focus();
}

function hideNameRow(presetsBar, nameRow) {
  nameRow.classList.add('hidden');
  presetsBar.classList.remove('hidden');
}

export async function setupPresets() {
  const presetsBar = document.getElementById('presetsBar');
  const selectEl = document.getElementById('presetSelect');
  const newBtn = document.getElementById('newPresetBtn');
  const saveBtn = document.getElementById('savePresetBtn');
  const deleteBtn = document.getElementById('deletePresetBtn');
  const nameRow = document.getElementById('presetNameRow');
  const nameInput = document.getElementById('presetNameInput');
  const confirmBtn = document.getElementById('confirmPresetBtn');
  const cancelBtn = document.getElementById('cancelPresetBtn');

  if (!presetsBar || !selectEl || !newBtn || !saveBtn || !deleteBtn || !nameRow || !nameInput || !confirmBtn || !cancelBtn) return;

  // Restore last used preset
  const lastPreset = await window.api.getLastPreset();
  await refreshPresetDropdown(selectEl, lastPreset);
  if (lastPreset && selectEl.value === lastPreset) {
    const mappings = await window.api.loadPreset(lastPreset);
    if (mappings) {
      state.config.Mappings = cloneConfig(mappings);
      await saveConfigAndSync();
      await renderAllKnobsAndApps();
    }
  }

  async function loadAndApplyPreset(name) {
    const mappings = await window.api.loadPreset(name);
    if (!mappings) return;
    state.config.Mappings = cloneConfig(mappings);
    await saveConfigAndSync();
    await renderAllKnobsAndApps();
    await window.api.setLastPreset(name);
    showAlert('success', `Preset "${name}" loaded`);
  }

  // Load preset on selection change
  selectEl.addEventListener('change', async () => {
    const name = selectEl.value;
    if (!name) {
      await window.api.setLastPreset(null);
      return;
    }
    await loadAndApplyPreset(name);
  });

  // Show name input row for creating a new preset
  newBtn.addEventListener('click', () => {
    showNameRow(presetsBar, nameRow, nameInput);
  });

  // Confirm create
  async function confirmCreate() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    await window.api.savePreset(name, state.config.Mappings);
    await refreshPresetDropdown(selectEl, name);
    await window.api.setLastPreset(name);
    hideNameRow(presetsBar, nameRow);
    showAlert('success', `Preset "${name}" created`);
  }

  confirmBtn.addEventListener('click', confirmCreate);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreate();
    if (e.key === 'Escape') hideNameRow(presetsBar, nameRow);
  });

  cancelBtn.addEventListener('click', () => hideNameRow(presetsBar, nameRow));

  // Auto-save current mappings into the active preset (called by mappings.js on changes)
  window._autoSaveActivePreset = async () => {
    const name = selectEl.value;
    if (!name) return;
    await window.api.savePreset(name, state.config.Mappings);
  };

  // Overwrite selected preset
  saveBtn.addEventListener('click', async () => {
    const name = selectEl.value;
    if (!name) {
      showAlert('warning', 'Select a preset to overwrite, or use "+ New" to create one');
      return;
    }
    await window.api.savePreset(name, state.config.Mappings);
    showAlert('success', `Preset "${name}" saved`);
  });

  // Delete selected preset
  deleteBtn.addEventListener('click', async () => {
    const name = selectEl.value;
    if (!name) {
      showAlert('warning', 'No preset selected to delete');
      return;
    }
    await window.api.deletePreset(name);
    await refreshPresetDropdown(selectEl);
    showAlert('success', `Preset "${name}" deleted`);
  });
}
