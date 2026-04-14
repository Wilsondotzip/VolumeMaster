const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notif', {
  onShow: (cb) => ipcRenderer.on('show-notification', (_, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on('hide-notification', () => cb()),
});
