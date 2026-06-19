const path = require('path');
const { Tray, Menu, app, nativeImage } = require('electron');
const deviceManager = require('./device-manager');

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');

// Windows menu/taskbar uses the multi-resolution .ico; macOS menu bar needs a
// small PNG (with an @2x companion auto-loaded by nativeImage for Retina).
const isMac = process.platform === 'darwin';
const iconPathNormal = isMac
  ? path.join(iconsDir, 'tray-green.png')
  : path.join(iconsDir, 'icongreen.ico');
const iconPathCrashed = isMac
  ? path.join(iconsDir, 'tray-red.png')
  : path.join(iconsDir, 'iconred.ico');

function trayImage(iconPath) {
  const image = nativeImage.createFromPath(iconPath);
  // The colored status ring must survive: don't render as a template image.
  if (isMac) image.setTemplateImage(false);
  return image;
}

let tray = null;

function buildContextMenu() {
  const devices = deviceManager.getAllDevices();
  const deviceItems = devices.map((device) => ({
    label: device.name,
    click: () => {
      const win = deviceManager.getWindowForDevice(device.id);
      if (win) { win.show(); win.focus(); }
    },
  }));

  return Menu.buildFromTemplate([
    ...deviceItems,
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(trayImage(iconPathNormal));
  tray.setToolTip('VolumeMaster');
  tray.setContextMenu(buildContextMenu());

  // On macOS a left-click opens the context menu by default; only wire the
  // click-to-show-windows behavior on platforms where click is separate.
  if (!isMac) {
    tray.on('click', () => {
      for (const device of deviceManager.getAllDevices()) {
        const win = deviceManager.getWindowForDevice(device.id);
        if (win) { win.show(); win.focus(); }
      }
    });
  }

  return tray;
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildContextMenu());
}

function setTrayImageNormal() {
  if (tray) tray.setImage(trayImage(iconPathNormal));
}

function setTrayImageCrashed() {
  if (tray) tray.setImage(trayImage(iconPathCrashed));
}

module.exports = {
  createTray,
  updateTrayMenu,
  getTray: () => tray,
  setTrayImageNormal,
  setTrayImageCrashed,
  iconPathNormal,
};
