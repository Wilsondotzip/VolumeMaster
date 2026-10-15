const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('selector', {
  onOpen: (cb) => ipcRenderer.on('selector-open', (_, data) => cb(data)),
  onMove: (cb) => ipcRenderer.on('selector-move', (_, data) => cb(data)),
  onClose: (cb) => ipcRenderer.on('selector-close', (_, data) => cb(data)),
});
