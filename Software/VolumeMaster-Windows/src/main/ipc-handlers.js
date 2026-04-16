const { SerialPort } = require('serialport');

const platform = require('./platform');
const { loadConfig, saveConfig, cloneConfigSnapshot } = require('./config-store');
const { getAppIcon } = require('./icon-service');
const { startBackend, killBackend, getBackendProcess } = require('./backend-process');
const deviceManager = require('./device-manager');

/** Resolves the deviceId and deviceDir for the window that sent an IPC event. */
function getDeviceContext(event) {
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  const deviceId = deviceManager.getDeviceForWindow(win);
  const deviceDir = deviceManager.getDeviceDir(deviceId);
  return { win, deviceId, deviceDir };
}

function registerIpcHandlers() {
  const { ipcMain, dialog, app } = require('electron');

  ipcMain.handle('load-config', (event) => {
    const { deviceDir } = getDeviceContext(event);
    return cloneConfigSnapshot(loadConfig(deviceDir));
  });

  ipcMain.handle('save-config', (event, data) => {
    const { deviceDir } = getDeviceContext(event);
    const existing = loadConfig(deviceDir);
    const incoming = data && typeof data === 'object' ? data : {};
    const merged = { ...existing };
    for (const [key, val] of Object.entries(incoming)) {
      if (val !== undefined) merged[key] = val;
    }
    merged.vm = existing.vm;
    merged.vmversion = existing.vmversion;
    merged.presets = existing.presets;
    saveConfig(deviceDir, merged);
    return cloneConfigSnapshot(loadConfig(deviceDir));
  });

  ipcMain.handle('open-exe-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Executable',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('get-app-icon', async (_, exeName) => getAppIcon(exeName));

  ipcMain.handle('list-processes', async () => {
    try {
      return await platform.getProcessList();
    } catch (err) {
      console.error('Failed to list processes:', err);
      return [];
    }
  });

  ipcMain.handle('list-serial-ports', async () => {
    try {
      const ports = await SerialPort.list();
      return ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer || 'Unknown',
      }));
    } catch (err) {
      console.error('Failed to list serial ports:', err);
      return [];
    }
  });

  ipcMain.handle('get-com-port', (event) => {
    const { deviceDir } = getDeviceContext(event);
    return loadConfig(deviceDir).comport || null;
  });

  ipcMain.handle('set-com-port', (event, port) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.comport = port;
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('save-and-run', async (event) => {
    const { deviceId, deviceDir } = getDeviceContext(event);
    console.log(`[IPC] save-and-run for device ${deviceId}`);
    try {
      await killBackend(deviceId);
      startBackend(deviceId, deviceDir);
    } catch (err) {
      console.error('Error during save-and-run:', err);
    }
  });

  ipcMain.handle('stop-backend', async (event) => {
    const { deviceId } = getDeviceContext(event);
    console.log(`[IPC] stop-backend for device ${deviceId}`);
    try {
      await killBackend(deviceId);
    } catch (err) {
      console.error('Error during stop-backend:', err);
    }
  });

  ipcMain.handle('enable-vm', (event) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.vm = true;
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('disable-vm', (event) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.vm = false;
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('get-vm-enabled', (event) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    return config.vm === true || (typeof config.vm === 'string' && config.vm.toLowerCase() === 'true');
  });

  ipcMain.handle('set-vm-version', (event, version) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.vmversion = version;
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('get-vm-version', (event) => {
    const { deviceDir } = getDeviceContext(event);
    return loadConfig(deviceDir).vmversion || 'banana';
  });

  ipcMain.handle('get-auto-start', () => {
    return app.getLoginItemSettings({
      path: app.getPath('exe'),
      args: ['--hidden'],
    }).openAtLogin;
  });

  ipcMain.handle('set-auto-start', (_, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe'),
      args: ['--hidden'],
    });
    return true;
  });

  ipcMain.handle('list-input-devices', async () => {
    try {
      return await platform.getAudioInputDevices();
    } catch (err) {
      console.error('Failed to list input devices:', err);
      return [];
    }
  });

  ipcMain.handle('get-volume-notifications', (event) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    return config.volumeNotifications !== false;
  });

  ipcMain.handle('set-volume-notifications', (event, enabled) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.volumeNotifications = !!enabled;
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('get-backend-status', (event) => {
    const { deviceId } = getDeviceContext(event);
    return !!getBackendProcess(deviceId);
  });

  ipcMain.handle('get-last-preset', (event) => {
    const { deviceDir } = getDeviceContext(event);
    return loadConfig(deviceDir).lastPreset || null;
  });

  ipcMain.handle('set-last-preset', (event, name) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    config.lastPreset = name || null;
    saveConfig(deviceDir, config);
  });

  // --- Presets ---

  ipcMain.handle('list-presets', (event) => {
    const { deviceDir } = getDeviceContext(event);
    return Object.keys(loadConfig(deviceDir).presets || {});
  });

  ipcMain.handle('save-preset', (event, name, mappings) => {
    if (!name || typeof name !== 'string') return;
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    if (!config.presets || typeof config.presets !== 'object') config.presets = {};
    config.presets[name] = JSON.parse(JSON.stringify(mappings));
    saveConfig(deviceDir, config);
  });

  ipcMain.handle('load-preset', (event, name) => {
    const { deviceDir } = getDeviceContext(event);
    const preset = loadConfig(deviceDir).presets?.[name];
    if (!preset) return null;
    return JSON.parse(JSON.stringify(preset));
  });

  ipcMain.handle('delete-preset', (event, name) => {
    const { deviceDir } = getDeviceContext(event);
    const config = loadConfig(deviceDir);
    if (config.presets?.[name] !== undefined) {
      delete config.presets[name];
      saveConfig(deviceDir, config);
    }
  });

  // --- Device management ---

  ipcMain.handle('get-device-info', (event) => {
    const { deviceId } = getDeviceContext(event);
    return deviceManager.getDeviceById(deviceId);
  });

  ipcMain.handle('rename-device', (event, name) => {
    const { deviceId, win } = getDeviceContext(event);
    deviceManager.renameDevice(deviceId, name);
    win.setTitle(`VolumeMaster — ${name}`);
    const { updateTrayMenu } = require('./tray');
    updateTrayMenu();
    return true;
  });

  ipcMain.handle('remove-device', async (event) => {
    const { deviceId, win } = getDeviceContext(event);
    if (deviceManager.getAllDevices().length <= 1) return false;
    await killBackend(deviceId);
    deviceManager.removeDevice(deviceId);
    const { updateTrayMenu } = require('./tray');
    updateTrayMenu();
    win.destroy();
    return true;
  });

  ipcMain.handle('create-device', (_, name) => {
    const { createWindow } = require('./window');
    const { updateTrayMenu } = require('./tray');
    const device = deviceManager.createDevice(name);
    const deviceDir = deviceManager.getDeviceDir(device.id);
    createWindow(device.id);
    startBackend(device.id, deviceDir);
    updateTrayMenu();
    return device;
  });
}

module.exports = { registerIpcHandlers };
