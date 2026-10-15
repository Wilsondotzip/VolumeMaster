const path = require('path');
const { BrowserWindow, screen } = require('electron');

// Generic knob-selector popup (see backend/selector.py for the state machine).
// Purely a view: it renders whatever list the backend opened and follows its
// MOVE/CLOSE events — it never takes focus or input itself.

const WIDTH = 340;
// Must match selector.html: card top padding (12) + #header (38) + border (2).
const HEADER_HEIGHT = 52;
const ROW_HEIGHT = 40;
const MAX_VISIBLE_ROWS = 7;
const PADDING_BOTTOM = 8;
const MARGIN_BOTTOM = 72;

const CLOSE_DELAY_MS = { selected: 420, default: 200 }; // lets the confirm flash / fade-out play

let win = null;
let ready = null; // Promise resolved once the page has loaded
let currentSession = null;
let hideTimer = null;

function getWindow() {
  if (win && !win.isDestroyed()) return ready;

  win = new BrowserWindow({
    width: WIDTH,
    height: HEADER_HEIGHT + ROW_HEIGHT + PADDING_BOTTOM,
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
  win.on('closed', () => {
    win = null;
    ready = null;
  });

  ready = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(path.join(__dirname, '..', 'selector.html'));
  return ready;
}

/** Bottom-centre of the display the cursor is on — where the user is looking. */
function positionFor(itemCount) {
  const rows = Math.max(1, Math.min(itemCount, MAX_VISIBLE_ROWS));
  const height = HEADER_HEIGHT + rows * ROW_HEIGHT + PADDING_BOTTOM;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - height - MARGIN_BOTTOM),
    width: WIDTH,
    height,
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** state: { session, title, items: [{ id, label, detail?, icon? }], index } */
async function showSelector(state) {
  currentSession = state.session;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  await getWindow();
  if (currentSession !== state.session || !win) return; // superseded while loading

  win.setBounds(positionFor(state.items.length));
  send('selector-open', { ...state, rowHeight: ROW_HEIGHT, maxVisibleRows: MAX_VISIBLE_ROWS });
  win.showInactive();
}

function moveSelector(session, index) {
  if (session !== currentSession) return;
  send('selector-move', { index });
}

function closeSelector(session, reason) {
  if (session !== currentSession) return;
  currentSession = null;
  send('selector-close', { reason });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (win && !win.isDestroyed() && currentSession === null) win.hide();
  }, CLOSE_DELAY_MS[reason] ?? CLOSE_DELAY_MS.default);
}

function getCurrentSession() {
  return currentSession;
}

module.exports = { showSelector, moveSelector, closeSelector, getCurrentSession };
