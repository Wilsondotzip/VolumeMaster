'use strict';

// Electron must be required before any project module so `require('electron')` resolves to the API, not the npm path stub.
const { app, BrowserWindow } = require('electron');

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'AllowNativeOleApiForDragDrop');
}

app.commandLine.appendSwitch('js-flags', '--expose-gc');

const platform = require('./main/platform');
const { createWindow, showWindow, syncDockVisibility } = require('./main/window');
const { createTray } = require('./main/tray');
const { registerIpcHandlers } = require('./main/ipc-handlers');
const { startBackend, killAllBackends } = require('./main/backend-process');
const { startPluginServer, stopPluginServer } = require('./main/plugin-server');
const { startManagedPlugins, killManagedPlugins } = require('./main/plugin-process-manager');
const deviceManager = require('./main/device-manager');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance — focus the existing windows instead
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore();
      showWindow(win);
    }
  });

  app.whenReady().then(() => {
    // Kill any headless processes left over from a previous crash (will-quit never fired)
    platform.forceKillAllBackends();

    deviceManager.migrateIfNeeded();
    registerIpcHandlers();
    startPluginServer();
    startManagedPlugins();

    const devices = deviceManager.getAllDevices();
    for (const device of devices) {
      createWindow(device.id);
      startBackend(device.id, deviceManager.getDeviceDir(device.id));
    }

    createTray();

    if (process.argv.includes('--hidden')) {
      for (const win of BrowserWindow.getAllWindows()) win.hide();
    }
    // Start with the dock icon matching window visibility (hidden when launched
    // with --hidden, shown otherwise).
    syncDockVisibility();

    app.on('activate', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isVisible()) showWindow(win);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuiting = true;
  });

  app.on('will-quit', (event) => {
    event.preventDefault();
    const safetyNet = setTimeout(() => app.exit(0), 5000);
    Promise.all([killAllBackends(), stopPluginServer(), killManagedPlugins()])
      .finally(() => { clearTimeout(safetyNet); app.exit(0); });
  });
}

try {
  require('electron-reloader')(module);
} catch {}
