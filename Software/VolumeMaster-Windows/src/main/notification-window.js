const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadConfig } = require('./config-store');

// Per-knob session: { anchor, active, activityTimer }
// anchor = resting value used for threshold comparison
// active = true while the knob is being turned (bypass threshold)
// activityTimer = resets to inactive after knob stops
const sessions = new Map(); // Map<deviceId, Map<index, session>>

let notifWin = null;
let dismissTimer = null;
let hideTimer = null; // separate from dismissTimer so it can be cancelled on re-show

function getSession(deviceId, index) {
  if (!sessions.has(deviceId)) sessions.set(deviceId, new Map());
  const deviceMap = sessions.get(deviceId);
  if (!deviceMap.has(index)) deviceMap.set(index, { anchor: undefined, active: false, activityTimer: null, lastShown: undefined });
  return deviceMap.get(index);
}

function getOrCreateWindow(cb) {
  if (notifWin && !notifWin.isDestroyed()) {
    cb(notifWin);
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const winWidth = 288;
  const winHeight = 80;
  const margin = 16;

  notifWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: workArea.x + workArea.width - winWidth - margin,
    y: workArea.y + workArea.height - winHeight - margin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    type: 'toolbar',
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-notification.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notifWin.setAlwaysOnTop(true, 'screen-saver');
  notifWin.setVisibleOnAllWorkspaces(true);
  notifWin.loadFile(path.join(__dirname, '..', 'notification.html'));
  notifWin.on('closed', () => { notifWin = null; });
  notifWin.webContents.once('did-finish-load', () => cb(notifWin));
}

function getLabel(config, index) {
  const mapping = config.Mappings?.[index] ?? config.Mappings?.[String(index)];
  if (!mapping) return null;

  const names = [
    ...(mapping.ProcessNames || []),
    ...(mapping.MicNames || []),
  ].map((n) => (n === 'master' ? 'Master Volume' : n.replace(/\.exe$/i, '')));

  if (names.length === 0) return null;
  const joined = names.join(', ');
  return joined.length > 34 ? joined.slice(0, 31) + '…' : joined;
}

function handleVolumeChange(deviceId, deviceDir, index, value) {
  let config;
  try {
    config = loadConfig(deviceDir);
  } catch {
    return;
  }

  if (config.volumeNotifications === false) return;

  const session = getSession(deviceId, index);

  // First ever reading — just establish the anchor, no notification
  if (session.anchor === undefined) {
    session.anchor = value;
    return;
  }

  // Not yet active: only trigger if knob moved meaningfully from its rest position
  if (!session.active && Math.abs(value - session.anchor) <= 3) return;

  // Crossed the threshold (or already active) — enter/stay in active mode
  session.active = true;

  // Reset inactivity timer; when it fires the knob has stopped so update the anchor
  if (session.activityTimer) clearTimeout(session.activityTimer);
  session.activityTimer = setTimeout(() => {
    session.active = false;
    session.anchor = value;
  }, 800);

  // While active, only update the popup and extend its lifetime when the value
  // has actually moved — ignores noise fluctuations of ±1
  if (session.lastShown !== undefined && Math.abs(value - session.lastShown) < 1) return;
  session.lastShown = value;

  const label = getLabel(config, index);

  getOrCreateWindow((win) => {
    // Cancel any pending hide so a re-show isn't immediately undone
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    win.webContents.send('show-notification', { index, value, label });
    win.showInactive();

    // Extend dismiss window while knob is actively moving
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (notifWin && !notifWin.isDestroyed()) {
        notifWin.webContents.send('hide-notification');
        hideTimer = setTimeout(() => {
          hideTimer = null;
          if (notifWin && !notifWin.isDestroyed()) notifWin.hide();
        }, 220);
      }
    }, 2200);
  });
}

module.exports = { handleVolumeChange };
