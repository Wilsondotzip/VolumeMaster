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

function filenameStem(filePath) {
  const base = filePath.split(/[\\/]/).pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

function renderManagedPlugin({ id, path, running }, configPlugin) {
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

  if (configPlugin) {
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.textContent = 'Configure';
    configBtn.className = 'text-xs text-slate-400 hover:text-indigo-400 transition shrink-0';
    configBtn.onclick = () => openPluginConfigModal(
      configPlugin.pluginId, configPlugin.name, configPlugin.schema, configPlugin.values
    );
    row.append(dot, label, configBtn);
  } else {
    row.append(dot, label);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Delete';
  removeBtn.className = 'text-xs text-red-500 hover:text-red-400 transition shrink-0';
  removeBtn.onclick = async () => {
    await window.api.removeManagedPlugin(id);
    row.remove();
  };

  row.appendChild(removeBtn);
  return row;
}

export async function applyManagedPluginsInfo() {
  const list = document.getElementById('managedPluginList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  const [plugins, configurablePlugins] = await Promise.all([
    window.api.listManagedPlugins(),
    window.api.getConfigurablePlugins(),
  ]);
  for (const plugin of plugins) {
    const stem = filenameStem(plugin.path);
    const configPlugin = configurablePlugins.find(
      (c) => c.pluginId === stem || c.pluginId.startsWith(stem)
    ) || null;
    list.appendChild(renderManagedPlugin(plugin, configPlugin));
  }
}

export function setupManagedPluginsListeners() {
  document.getElementById('addManagedPluginBtn')?.addEventListener('click', async () => {
    const plugin = await window.api.addManagedPlugin();
    if (!plugin) return;
    const list = document.getElementById('managedPluginList');
    if (list) list.appendChild(renderManagedPlugin(plugin, null));
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

function buildConfigField(field, savedValues) {
  const value = savedValues[field.key] !== undefined ? savedValues[field.key] : (field.default ?? '');
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-1';

  const label = document.createElement('label');
  label.className = 'text-xs text-gray-400';
  label.textContent = field.label;
  label.htmlFor = `cfg_${field.key}`;

  let input;
  if (field.type === 'boolean') {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.id = `cfg_${field.key}`;
    input.dataset.configKey = field.key;
    input.dataset.configType = 'boolean';
    input.className = 'w-4 h-4 rounded accent-indigo-500';
    row.append(input, label);
    wrapper.appendChild(row);
    return wrapper;
  } else if (field.type === 'select') {
    input = document.createElement('select');
    input.id = `cfg_${field.key}`;
    input.dataset.configKey = field.key;
    input.className = 'w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 focus:outline-none focus:border-indigo-500';
    for (const opt of (Array.isArray(field.options) ? field.options : [])) {
      const o = document.createElement('option');
      if (typeof opt === 'string') { o.value = opt; o.textContent = opt; }
      else { o.value = opt.value; o.textContent = opt.label || opt.value; }
      if (o.value === String(value)) o.selected = true;
      input.appendChild(o);
    }
  } else {
    input = document.createElement('input');
    input.type = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
    input.value = value;
    input.id = `cfg_${field.key}`;
    input.dataset.configKey = field.key;
    input.className = 'w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500';
    if (field.placeholder) input.placeholder = field.placeholder;
  }

  wrapper.append(label, input);
  return wrapper;
}

function openPluginConfigModal(pluginId, name, schema, values) {
  const modal = document.getElementById('pluginConfigModal');
  if (!modal) return;
  document.getElementById('pluginConfigModalTitle').textContent = `Configure: ${name}`;
  const fields = document.getElementById('pluginConfigFields');
  while (fields.firstChild) fields.removeChild(fields.firstChild);
  for (const field of schema) fields.appendChild(buildConfigField(field, values));

  document.getElementById('pluginConfigSaveBtn').onclick = async () => {
    const newValues = {};
    for (const el of fields.querySelectorAll('[data-config-key]')) {
      const key = el.dataset.configKey;
      if (el.dataset.configType === 'boolean') newValues[key] = el.checked;
      else if (el.type === 'number') newValues[key] = Number(el.value);
      else newValues[key] = el.value;
    }
    await window.api.savePluginConfig(pluginId, newValues);
    modal.close();
  };
  document.getElementById('pluginConfigCancelBtn').onclick = () => modal.close();
  document.getElementById('pluginConfigCloseBtn').onclick = () => modal.close();
  modal.showModal();
}

function renderConfigurablePlugin({ pluginId, name, schema, values }) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 p-2 bg-slate-700 rounded border border-slate-600';

  const label = document.createElement('span');
  label.className = 'text-sm text-gray-300 flex-1';
  label.textContent = name;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Configure';
  btn.className = 'text-xs px-2 py-1 bg-slate-600 hover:bg-indigo-600 text-gray-300 hover:text-white rounded transition shrink-0';
  btn.onclick = () => openPluginConfigModal(pluginId, name, schema, values);

  row.append(label, btn);
  return row;
}

export async function applyConfigurablePluginsInfo() {
  const list = document.getElementById('configurablePluginList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  const plugins = await window.api.getConfigurablePlugins();
  if (!plugins || plugins.length === 0) {
    const empty = document.getElementById('noConfigurablePlugins');
    if (empty) list.appendChild(empty);
    return;
  }
  for (const plugin of plugins) list.appendChild(renderConfigurablePlugin(plugin));
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
