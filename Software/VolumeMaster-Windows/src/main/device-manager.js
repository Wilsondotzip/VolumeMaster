const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Maps BrowserWindow.id → deviceId
const windowDeviceMap = new Map();

let _userData = null;
function userData() {
  if (!_userData) _userData = require('electron').app.getPath('userData');
  return _userData;
}

function devicesDir() {
  return path.join(userData(), 'devices');
}

function registryPath() {
  return path.join(userData(), 'devices.json');
}

let registry = null;

function loadRegistry() {
  if (registry) return registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
  } catch {
    registry = [];
  }
  return registry;
}

function saveRegistry() {
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * On first launch after adding multi-device support, migrate the existing
 * single config.yaml to devices/default/config.yaml.
 */
function migrateIfNeeded() {
  if (fs.existsSync(registryPath())) {
    loadRegistry();
    return;
  }

  const oldConfig = path.join(userData(), 'config.yaml');
  const defaultId = 'default';
  const deviceDir = path.join(devicesDir(), defaultId);
  fs.mkdirSync(deviceDir, { recursive: true });

  if (fs.existsSync(oldConfig)) {
    fs.copyFileSync(oldConfig, path.join(deviceDir, 'config.yaml'));
  }

  registry = [{ id: defaultId, name: 'Device 1' }];
  saveRegistry();
}

function createDevice(name) {
  loadRegistry();
  const id = crypto.randomUUID().slice(0, 8);
  const deviceDir = path.join(devicesDir(), id);
  fs.mkdirSync(deviceDir, { recursive: true });

  const defaultConfigSrc = path.join(__dirname, '..', 'assets', 'config.yaml');
  fs.copyFileSync(defaultConfigSrc, path.join(deviceDir, 'config.yaml'));

  const device = { id, name };
  registry.push(device);
  saveRegistry();
  return device;
}

function renameDevice(id, name) {
  loadRegistry();
  const device = registry.find((d) => d.id === id);
  if (device) {
    device.name = name;
    saveRegistry();
    return true;
  }
  return false;
}

function removeDevice(id) {
  loadRegistry();
  const idx = registry.findIndex((d) => d.id === id);
  if (idx !== -1) {
    registry.splice(idx, 1);
    saveRegistry();
    const deviceDir = path.join(devicesDir(), id);
    try {
      fs.rmSync(deviceDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[device-manager] Failed to delete device dir for ${id}:`, err);
    }
  }
}

function getDeviceDir(id) {
  return path.join(devicesDir(), id);
}

function getDeviceById(id) {
  return loadRegistry().find((d) => d.id === id) || null;
}

function getAllDevices() {
  return [...loadRegistry()];
}

function getDeviceForWindow(win) {
  return windowDeviceMap.get(win.id) || null;
}

function registerWindowDevice(win, deviceId) {
  windowDeviceMap.set(win.id, deviceId);
  win.on('closed', () => windowDeviceMap.delete(win.id));
}

function getWindowForDevice(deviceId) {
  const { BrowserWindow } = require('electron');
  for (const [winId, dId] of windowDeviceMap) {
    if (dId === deviceId) {
      return BrowserWindow.fromId(winId);
    }
  }
  return null;
}

module.exports = {
  migrateIfNeeded,
  createDevice,
  renameDevice,
  removeDevice,
  getDeviceDir,
  getDeviceById,
  getAllDevices,
  getDeviceForWindow,
  registerWindowDevice,
  getWindowForDevice,
};
