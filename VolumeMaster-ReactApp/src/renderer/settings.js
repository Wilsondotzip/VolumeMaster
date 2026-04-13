import { showAlert } from './alerts.js';

export function setupSettingsListeners() {
  document.getElementById('saveAndRunBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveAndRunBtn');
    if (btn.textContent.trim() === 'Stop') {
      await window.api.stopBackend();
    } else {
      await window.api.saveAndRun();
    }
  });

  document.getElementById('vmEnableButton')?.addEventListener('click', async () => {
    const button = document.getElementById('vmEnableButton');
    const isOn = button.textContent.trim().toLowerCase() === 'enabled';
    const newState = !isOn;
    button.dataset.enabled = newState;
    button.textContent = newState ? 'Enabled' : 'Disabled';

    if (newState) {
      button.classList.remove('bg-red-500', 'hover:bg-red-600');
      button.classList.add('bg-green-500', 'hover:bg-green-600');
      await window.api.enableVM();
    } else {
      button.classList.remove('bg-green-500', 'hover:bg-green-600');
      button.classList.add('bg-red-500', 'hover:bg-red-600');
      await window.api.disableVM();
    }
    document.getElementById('subTabVoiceMeeter')?.classList.toggle('hidden', !newState);
  });

  document.getElementById('vmVersionSelect')?.addEventListener('change', async (e) => {
    await window.api.setVMVersion(e.target.value);
  });

  document.getElementById('volumeNotifsCheckbox')?.addEventListener('change', async (e) => {
    await window.api.setVolumeNotifications(e.target.checked);
  });

  window.api.onBackendStatus(({ type, message }) => {
    const vmBanner = document.getElementById('vmErrorBanner');
    const audioBanner = document.getElementById('audioErrorBanner');
    const comPortBanner = document.getElementById('comPortErrorBanner');

    if (type === 'success') {
      document.getElementById('saveAndRunBtn').textContent = 'Stop';
      vmBanner?.classList.add('hidden');
      audioBanner?.classList.add('hidden');
      comPortBanner?.classList.add('hidden');
    } else if (type === 'warning') {
      document.getElementById('saveAndRunBtn').textContent = 'Run';
      vmBanner?.classList.add('hidden');
    } else if (type === 'vm-error') {
      vmBanner?.classList.remove('hidden');
      return;
    } else if (type === 'audio-error') {
      audioBanner?.classList.remove('hidden');
      return;
    } else if (type === 'audio-ok') {
      audioBanner?.classList.add('hidden');
      return;
    } else if (type === 'com-port-error') {
      comPortBanner?.classList.remove('hidden');
      return;
    }
    if (type !== 'info') showAlert(type, message);
  });
}

export async function applyInitialBackendStatus() {
  const running = await window.api.getBackendStatus();
  const btn = document.getElementById('saveAndRunBtn');
  if (btn) btn.textContent = running ? 'Stop' : 'Run';
}

export async function applyNotificationSettings() {
  const enabled = await window.api.getVolumeNotifications();
  const cb = document.getElementById('volumeNotifsCheckbox');
  if (cb) cb.checked = enabled;
}

export async function applyVoiceMeeterUiFromMain() {
  const vmEnabled = await window.api.getVMEnabled();
  const vmBtn = document.getElementById('vmEnableButton');
  if (vmBtn) {
    vmBtn.textContent = vmEnabled ? 'Enabled' : 'Disabled';
  }
  document.getElementById('subTabVoiceMeeter')?.classList.toggle('hidden', !vmEnabled);

  const version = await window.api.getVMVersion();
  const vmVersionSelect = document.getElementById('vmVersionSelect');
  if (vmVersionSelect) {
    vmVersionSelect.value = version || 'banana';
  }
}
