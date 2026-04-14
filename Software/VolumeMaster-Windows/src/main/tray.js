const path = require('path');
const { Tray, Menu, app } = require('electron');
const deviceManager = require('./device-manager');

const iconPathNormal = path.join(__dirname, '..', 'assets', 'icons', 'icongreen.ico');
const iconPathCrashed = path.join(__dirname, '..', 'assets', 'icons', 'iconred.ico');

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
  tray = new Tray(iconPathNormal);
  tray.setToolTip('VolumeMaster');
  tray.setContextMenu(buildContextMenu());

  tray.on('click', () => {
    for (const device of deviceManager.getAllDevices()) {
      const win = deviceManager.getWindowForDevice(device.id);
      if (win) { win.show(); win.focus(); }
    }
  });

  return tray;
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildContextMenu());
}

function setTrayImageNormal() {
  if (tray) tray.setImage(iconPathNormal);
}

function setTrayImageCrashed() {
  if (tray) tray.setImage(iconPathCrashed);
}

module.exports = {
  createTray,
  updateTrayMenu,
  getTray: () => tray,
  setTrayImageNormal,
  setTrayImageCrashed,
  iconPathNormal,
};
