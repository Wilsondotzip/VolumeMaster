import { showAlert } from './alerts.js';

export async function setupDeviceHeader() {
  const info = await window.api.getDeviceInfo();
  if (!info) return;

  const nameEl = document.getElementById('deviceName');
  const editBtn = document.getElementById('editDeviceNameBtn');
  const nameInput = document.getElementById('deviceNameInput');
  const confirmBtn = document.getElementById('confirmDeviceNameBtn');
  const cancelBtn = document.getElementById('cancelDeviceNameBtn');

  if (nameEl) nameEl.textContent = info.name;

  function enterEditMode() {
    if (nameInput) nameInput.value = info.name;
    nameEl?.classList.add('hidden');
    editBtn?.classList.add('hidden');
    nameInput?.classList.remove('hidden');
    confirmBtn?.classList.remove('hidden');
    cancelBtn?.classList.remove('hidden');
    nameInput?.focus();
    nameInput?.select();
  }

  function exitEditMode() {
    nameEl?.classList.remove('hidden');
    editBtn?.classList.remove('hidden');
    nameInput?.classList.add('hidden');
    confirmBtn?.classList.add('hidden');
    cancelBtn?.classList.add('hidden');
  }

  async function confirmRename() {
    const newName = nameInput?.value.trim();
    if (!newName) { nameInput?.focus(); return; }
    await window.api.renameDevice(newName);
    info.name = newName;
    if (nameEl) nameEl.textContent = newName;
    exitEditMode();
    showAlert('success', `Device renamed to "${newName}"`);
  }

  editBtn?.addEventListener('click', enterEditMode);
  confirmBtn?.addEventListener('click', confirmRename);
  cancelBtn?.addEventListener('click', exitEditMode);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') exitEditMode();
  });
}

export function setupRemoveDeviceButton() {
  const removeBtn = document.getElementById('removeDeviceBtn');
  const confirmBtn = document.getElementById('confirmRemoveBtn');
  const cancelBtn = document.getElementById('cancelRemoveBtn');

  removeBtn?.addEventListener('click', () => {
    removeBtn.classList.add('hidden');
    confirmBtn?.classList.remove('hidden');
    cancelBtn?.classList.remove('hidden');
  });

  cancelBtn?.addEventListener('click', () => {
    confirmBtn?.classList.add('hidden');
    cancelBtn?.classList.add('hidden');
    removeBtn?.classList.remove('hidden');
  });

  confirmBtn?.addEventListener('click', async () => {
    const removed = await window.api.removeDevice();
    if (!removed) {
      showAlert('warning', 'Cannot remove the last device');
      confirmBtn?.classList.add('hidden');
      cancelBtn?.classList.add('hidden');
      removeBtn?.classList.remove('hidden');
    }
    // If removed === true the window is destroyed by main process — no further action needed
  });
}

export function setupNewDeviceButton() {
  const input = document.getElementById('newDeviceNameInput');
  const btn = document.getElementById('newDeviceBtn');

  async function createDevice() {
    const name = input?.value.trim();
    if (!name) { input?.focus(); return; }
    await window.api.createDevice(name);
    if (input) input.value = '';
    showAlert('success', `Device "${name}" created`);
  }

  btn?.addEventListener('click', createDevice);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createDevice();
  });
}
