const path = require('path');
const { BrowserWindow } = require('electron');
const { resolvePopupDisplay } = require('./app-settings');

// Knob-selector popups (see backend/volumemaster/pro/selector.py for the state machine).
// Purely views: they render whatever the backend opened and follow its
// MOVE/CLOSE events — they never take focus or input themselves.
//
// Two styles, each its own window so each can be sized for its layout:
//   list — selector.html, a vertical list at the bottom-centre of the screen
//   ring — ring.html, a radial wheel in the middle of the screen (Action Ring)

const LIST_WIDTH = 340;
// Must match selector.html: card top padding (12) + #header (38) + border (2).
const LIST_HEADER_HEIGHT = 52;
const LIST_ROW_HEIGHT = 40;
const LIST_MAX_VISIBLE_ROWS = 7;
const LIST_PADDING_BOTTOM = 8;
const LIST_MARGIN_BOTTOM = 72;

// Must match ring.html's SIZE.
const RING_SIZE = 520;

const CLOSE_DELAY_MS = { selected: 420, default: 200 }; // lets the confirm flash / fade-out play

const STYLES = {
  list: {
    file: 'selector.html',
    bounds(itemCount, workArea) {
      const rows = Math.max(1, Math.min(itemCount, LIST_MAX_VISIBLE_ROWS));
      const height = LIST_HEADER_HEIGHT + rows * LIST_ROW_HEIGHT + LIST_PADDING_BOTTOM;
      return {
        x: Math.round(workArea.x + (workArea.width - LIST_WIDTH) / 2),
        y: Math.round(workArea.y + workArea.height - height - LIST_MARGIN_BOTTOM),
        width: LIST_WIDTH,
        height,
      };
    },
    extra: { rowHeight: LIST_ROW_HEIGHT, maxVisibleRows: LIST_MAX_VISIBLE_ROWS },
  },
  ring: {
    file: 'ring.html',
    bounds(_itemCount, workArea) {
      return {
        x: Math.round(workArea.x + (workArea.width - RING_SIZE) / 2),
        y: Math.round(workArea.y + (workArea.height - RING_SIZE) / 2),
        width: RING_SIZE,
        height: RING_SIZE,
      };
    },
    extra: {},
  },
};

// style -> { win, ready }
const windows = new Map();
let currentSession = null;
let currentStyle = null;
let hideTimer = null;

function getWindow(style) {
  const existing = windows.get(style);
  if (existing && !existing.win.isDestroyed()) return existing;

  const win = new BrowserWindow({
    width: 100,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    type: 'toolbar',
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-selector.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true);
  win.on('closed', () => windows.delete(style));

  const entry = {
    win,
    ready: new Promise((resolve) => win.webContents.once('did-finish-load', resolve)),
  };
  windows.set(style, entry);
  win.loadFile(path.join(__dirname, '..', STYLES[style].file));
  return entry;
}

function send(style, channel, payload) {
  const entry = windows.get(style);
  if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, payload);
}

function hideStyle(style) {
  const entry = windows.get(style);
  if (entry && !entry.win.isDestroyed()) entry.win.hide();
}

/** state: { session, title, items: [{ id, label, detail?, icon? }], index, style? } */
async function showSelector(state) {
  const style = STYLES[state.style] ? state.style : 'list';
  // A different-style popup still on screen (e.g. mid fade-out) goes straight away.
  if (currentStyle && currentStyle !== style) hideStyle(currentStyle);
  currentSession = state.session;
  currentStyle = style;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const { win, ready } = getWindow(style);
  await ready;
  if (currentSession !== state.session || win.isDestroyed()) return; // superseded while loading

  // Follow the mouse, the main display or a chosen monitor (Settings → Knob Popups)
  const { workArea } = resolvePopupDisplay();
  win.setBounds(STYLES[style].bounds(state.items.length, workArea));
  send(style, 'selector-open', { ...state, style, ...STYLES[style].extra });
  win.showInactive();
}

function moveSelector(session, index) {
  if (session !== currentSession) return;
  send(currentStyle, 'selector-move', { index });
}

function closeSelector(session, reason) {
  if (session !== currentSession) return;
  const style = currentStyle;
  currentSession = null;
  send(style, 'selector-close', { reason });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (currentSession === null) hideStyle(style);
  }, CLOSE_DELAY_MS[reason] ?? CLOSE_DELAY_MS.default);
}

function getCurrentSession() {
  return currentSession;
}

module.exports = { showSelector, moveSelector, closeSelector, getCurrentSession };
