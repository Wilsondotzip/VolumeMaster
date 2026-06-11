const path = require('path');
const { BrowserWindow } = require('electron');
const deviceManager = require('./device-manager');

function createWindow(deviceId) {
  const device = deviceManager.getDeviceById(deviceId);
  const title = device ? `VolumeMaster — ${device.name}` : 'VolumeMaster';

  const existingWindows = BrowserWindow.getAllWindows();
  const positionOpts = existingWindows.length === 0
    ? {}
    : (() => {
        const [x, y] = existingWindows[existingWindows.length - 1].getPosition();
        return { x: x + 30, y: y + 30 };
      })();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 700,
    ...positionOpts,
    title,
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  deviceManager.registerWindowDevice(win, deviceId);
  win.loadFile('src/renderer.html');

  win.on('minimize', (event) => {
    event.preventDefault();
    win.hide();
    win.webContents.send('window-hidden');
    win.webContents.session.clearCache().catch(() => {});
    win.webContents.executeJavaScript('gc()').catch(() => {});
    if (global.gc) global.gc();
  });

  win.on('close', () => {
    const { app } = require('electron');
    app.isQuiting = true;
    app.quit();
  });

  return win;
}

module.exports = { createWindow };
