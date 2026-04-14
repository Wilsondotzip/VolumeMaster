const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  openExeDialog: () => ipcRenderer.invoke('open-exe-dialog'),
  getAppIcon: (nameOrPath) => ipcRenderer.invoke('get-app-icon', nameOrPath),
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
  getComPort: () => ipcRenderer.invoke('get-com-port'),
  setComPort: (port) => ipcRenderer.invoke('set-com-port', port),
  saveAndRun: () => ipcRenderer.invoke('save-and-run'),
  stopBackend: () => ipcRenderer.invoke('stop-backend'),
  onBackendStatus: (callback) => ipcRenderer.on('backend-status', (_, data) => callback(data)),
  onVolumeUpdate: (callback) => ipcRenderer.on('volume-update', (_, data) => callback(data)),
  enableVM: () => ipcRenderer.invoke('enable-vm'),
  disableVM: () => ipcRenderer.invoke('disable-vm'),
  getVMEnabled: () => ipcRenderer.invoke('get-vm-enabled'),
  setVMVersion: (version) => ipcRenderer.invoke('set-vm-version', version),
  getVMVersion: () => ipcRenderer.invoke('get-vm-version'),

  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  getInputDevices: () => ipcRenderer.invoke('list-input-devices'),

  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),

  getVolumeNotifications: () => ipcRenderer.invoke('get-volume-notifications'),
  setVolumeNotifications: (enabled) => ipcRenderer.invoke('set-volume-notifications', enabled),

  getLastPreset: () => ipcRenderer.invoke('get-last-preset'),
  setLastPreset: (name) => ipcRenderer.invoke('set-last-preset', name),

  listPresets: () => ipcRenderer.invoke('list-presets'),
  savePreset: (name, mappings) => ipcRenderer.invoke('save-preset', name, mappings),
  loadPreset: (name) => ipcRenderer.invoke('load-preset', name),
  deletePreset: (name) => ipcRenderer.invoke('delete-preset', name),

  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
  renameDevice: (name) => ipcRenderer.invoke('rename-device', name),
  createDevice: (name) => ipcRenderer.invoke('create-device', name),
  removeDevice: () => ipcRenderer.invoke('remove-device'),
});



