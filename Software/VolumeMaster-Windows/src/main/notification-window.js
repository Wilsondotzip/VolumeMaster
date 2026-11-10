const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadConfig } = require('./config-store');
const { getAppIcon } = require('./icon-service');

// The window is larger than the visible card (notification.html insets it 12px)
// so the card's shadow has room instead of being clipped at the window edge.
const WIN_WIDTH = 344;
const WIN_HEIGHT = 108;
const MARGIN = 6; // from the work area's corner, on top of the 12px inset

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

  notifWin = new BrowserWindow({
    ...cornerBounds(),
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
      // The popup never has focus; don't let Chromium pause its animation frames
      // (the value's count-up) as if it were a background window.
      backgroundThrottling: false,
    },
  });

  notifWin.setAlwaysOnTop(true, 'screen-saver');
  notifWin.setVisibleOnAllWorkspaces(true);
  notifWin.loadFile(path.join(__dirname, '..', 'notification.html'));
  notifWin.on('closed', () => { notifWin = null; });
  notifWin.webContents.once('did-finish-load', () => cb(notifWin));
}

/** Bottom-right of the main display, worked out per show so resolution or main-display changes are followed. */
function cornerBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIN_WIDTH - MARGIN,
    y: workArea.y + workArea.height - WIN_HEIGHT - MARGIN,
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
  };
}

const CATEGORY_ICONS = { Games: '🎮', Browser: '🌐', Chat: '💬', Media: '🎵', Focused: '🎯' };

// exe name -> Promise<data URL | null>. The promise is cached, not the result,
// so a burst of knob events shares one lookup instead of starting several.
const iconMemo = new Map();
function iconFor(exeName) {
  if (!iconMemo.has(exeName)) {
    // No icon: the popup shows the app's first letter instead
    iconMemo.set(exeName, getAppIcon(exeName).catch(() => null));
  }
  return iconMemo.get(exeName);
}

// Popups are shown after an async icon lookup; only the newest may reach the
// screen, or a slow first lookup could land after (and overwrite) later values.
let showSeq = 0;

/**
 * What the knob controls, for the popup's icon: [{ kind, name, icon? }].
 * Only the first target's icon is shown (plus a "+N"), so only it gets looked up.
 */
async function getTargets(config, index) {
  const mapping = config.Mappings?.[index] ?? config.Mappings?.[String(index)];
  if (!mapping) return [];
  const targets = [];
  for (const name of mapping.ProcessNames || []) {
    if (name === 'master') targets.push({ kind: 'master', name: 'Master Volume' });
    else targets.push({ kind: 'app', name: name.replace(/\.exe$/i, ''), exe: name });
  }
  for (const name of mapping.MicNames || []) targets.push({ kind: 'mic', name });
  for (const catId of mapping.Categories || []) {
    targets.push({ kind: 'category', name: catId, icon: CATEGORY_ICONS[catId] ?? '📦' });
  }
  const first = targets[0];
  if (first?.kind === 'app') first.icon = await iconFor(first.exe);
  return targets.map(({ exe, ...t }) => t);
}

function getKnobName(config, index) {
  const mapping = config.Mappings?.[index] ?? config.Mappings?.[String(index)];
  return mapping?.Name || null;
}

function getLabel(config, index) {
  const mapping = config.Mappings?.[index] ?? config.Mappings?.[String(index)];
  if (!mapping) return null;

  const names = [
    ...(mapping.ProcessNames || []),
    ...(mapping.MicNames || []),
  ].map((n) => (n === 'master' ? 'Master Volume' : n.replace(/\.exe$/i, '')));

  // Plain names: the popup's icon already shows the first target's emoji / app icon
  names.push(...(mapping.Categories || []));

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
  const knobName = getKnobName(config, index);

  const seq = ++showSeq;
  getTargets(config, index).then((targets) => seq === showSeq && getOrCreateWindow((win) => {
    // Cancel any pending hide so a re-show isn't immediately undone
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    if (!win.isVisible()) win.setBounds(cornerBounds());
    win.webContents.send('show-notification', { index, value, label, knobName, targets });
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
  }));
}

module.exports = { handleVolumeChange };
