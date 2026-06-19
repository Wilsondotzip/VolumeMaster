const path = require('path');
const { app, BrowserWindow } = require('electron');
const deviceManager = require('./device-manager');

// Toggle the macOS dock icon, but only when its state actually needs to change.
// Calling app.dock.show() when the dock is already visible leaves it in a state
// where a subsequent app.dock.hide() is silently ignored, so guard both calls.
function setDockVisible(visible) {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (visible && !app.dock.isVisible()) app.dock.show();
  else if (!visible && app.dock.isVisible()) app.dock.hide();
}

// On macOS the app behaves like a menu bar app: the dock icon is only shown
// while a window is visible. When every window is hidden (minimized or closed
// to the tray) the dock icon is hidden too, leaving just the tray icon.
function syncDockVisibility() {
  const anyVisible = BrowserWindow.getAllWindows().some((win) => win.isVisible());
  setDockVisible(anyVisible);
}

// Show a window, restoring the dock icon first so the window activates and
// takes focus correctly when the app was in accessory mode (dock hidden).
function showWindow(win) {
  if (!win) return;
  setDockVisible(true);
  win.show();
  win.focus();
}

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
    syncDockVisibility();
    win.webContents.send('window-hidden');
    win.webContents.session.clearCache().catch(() => {});
    win.webContents.executeJavaScript('gc()').catch(() => {});
    if (global.gc) global.gc();
  });

  win.on('close', (event) => {
    // On macOS the app lives in the menu bar: closing a window hides it to the
    // tray rather than quitting, so the tray icon stays available. Quitting
    // happens only via the tray's Quit item (which sets app.isQuiting first).
    if (process.platform === 'darwin' && !app.isQuiting) {
      event.preventDefault();
      win.hide();
      syncDockVisibility();
      win.webContents.send('window-hidden');
      return;
    }
    app.isQuiting = true;
    app.quit();
  });

  return win;
}

module.exports = { createWindow, syncDockVisibility, showWindow };
