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
      if (comPortBanner) {
        comPortBanner.textContent = message || 'Device disconnected. Check your device is connected and the correct port is selected in Settings — reconnecting automatically.';
        comPortBanner.classList.remove('hidden');
      }
      return;
    } else if (type === 'serial-ok') {
      comPortBanner?.classList.add('hidden');
      return;
    }
    if (type !== 'info') showAlert(type, message);
  });
}

function renderManagedPlugin({ id, path, running }) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 p-2 bg-slate-700 rounded border border-slate-600';
  row.dataset.pluginId = id;

  const dot = document.createElement('div');
  dot.className = `w-2 h-2 rounded-full shrink-0 ${running ? 'bg-green-400' : 'bg-slate-500'}`;
  dot.title = running ? 'Running' : 'Stopped';

  const label = document.createElement('span');
  label.className = 'text-xs text-gray-300 truncate flex-1 font-mono';
  label.textContent = path.split(/[\\/]/).pop();
  label.title = path;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Delete';
  removeBtn.className = 'text-xs text-slate-400 hover:text-red-400 transition shrink-0';
  removeBtn.onclick = async () => {
    await window.api.removeManagedPlugin(id);
    row.remove();
  };

  row.append(dot, label, removeBtn);
  return row;
}

export async function applyManagedPluginsInfo() {
  const list = document.getElementById('managedPluginList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  const plugins = await window.api.listManagedPlugins();
  for (const plugin of plugins) {
    list.appendChild(renderManagedPlugin(plugin));
  }
}

export function setupManagedPluginsListeners() {
  document.getElementById('addManagedPluginBtn')?.addEventListener('click', async () => {
    const plugin = await window.api.addManagedPlugin();
    if (!plugin) return;
    const list = document.getElementById('managedPluginList');
    if (list) list.appendChild(renderManagedPlugin(plugin));
  });
}

export async function applyPluginSettingsInfo() {
  const status = await window.api.getPluginServerStatus();
  const errorEl = document.getElementById('pluginServerError');
  const statsEl = document.getElementById('pluginServerStats');
  const countEl = document.getElementById('pluginConnectedCount');

  if (status?.error) {
    if (errorEl) {
      errorEl.textContent = status.error;
      errorEl.classList.remove('hidden');
    }
    if (statsEl) statsEl.classList.add('hidden');
  } else {
    if (errorEl) errorEl.classList.add('hidden');
    if (statsEl) statsEl.classList.remove('hidden');
    const plugins = await window.api.getConnectedPlugins();
    if (countEl) countEl.textContent = String(plugins?.length ?? 0);
  }
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
