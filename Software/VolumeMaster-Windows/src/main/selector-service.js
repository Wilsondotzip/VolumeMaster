const { showSelector, moveSelector, closeSelector, getCurrentSession } = require('./selector-window');

// Electron side of the generic knob selector (backend/selector.py).
//
// Any main-process feature can ask the user to pick one item with the knob:
//
//   openSelector(deviceId, { knob, title, items: [{ id, label, detail?, icon? }], index? },
//                (item) => { ...apply the choice... });
//
// The backend runs the selector (ticks / presses never leave Python while it's
// open) and reports SELECTOR_* lines, which backend-process.js hands to
// handleSelectorEvent() below to drive the popup and resolve the callback.
// Python-side actions use SelectorManager.open() directly instead and never
// touch this module apart from the popup rendering.

// key -> onSelect, for selectors Electron asked the backend to open
const pending = new Map();
let nextKey = 1;

function openSelector(deviceId, { knob, title, items, index = 0, timeoutMs }, onSelect) {
  if (!Array.isArray(items) || !items.length) return false;
  // Lazy require: backend-process.js requires this module for its stdout handler.
  const { sendBackendCommand } = require('./backend-process');

  const key = `${deviceId}#${nextKey++}`;
  const spec = { key, knob, title, items, index };
  if (typeof timeoutMs === 'number') spec.timeoutMs = timeoutMs;

  pending.set(key, onSelect);
  if (!sendBackendCommand(deviceId, `OPEN_SELECTOR:${JSON.stringify(spec)}`)) {
    pending.delete(key);
    return false;
  }
  return true;
}

/** event: 'OPEN' | 'MOVE' | 'CLOSE', payload: parsed JSON from the SELECTOR_<event>: line. */
function handleSelectorEvent(deviceId, event, payload) {
  if (!payload || typeof payload !== 'object') return;

  if (event === 'OPEN') {
    showSelector({
      session: `${deviceId}:${payload.session}`,
      title: payload.title,
      items: Array.isArray(payload.items) ? payload.items : [],
      index: payload.index || 0,
    });
  } else if (event === 'MOVE') {
    moveSelector(`${deviceId}:${payload.session}`, payload.index);
  } else if (event === 'CLOSE') {
    if (payload.session != null) closeSelector(`${deviceId}:${payload.session}`, payload.reason);

    if (payload.source === 'electron' && payload.key) {
      const onSelect = pending.get(payload.key);
      pending.delete(payload.key);
      if (onSelect && payload.reason === 'selected' && payload.item) {
        try {
          onSelect(payload.item);
        } catch (err) {
          console.error(`[${deviceId}] Selector callback failed:`, err);
        }
      }
    }
  }
}

/** For a device whose backend went away: its selector can never resolve, so hide it and drop callbacks. */
function clearDeviceSelectors(deviceId) {
  for (const key of pending.keys()) {
    if (key.startsWith(`${deviceId}#`)) pending.delete(key);
  }
  const session = getCurrentSession();
  if (session?.startsWith(`${deviceId}:`)) closeSelector(session, 'cancelled');
}

module.exports = { openSelector, handleSelectorEvent, clearDeviceSelectors };
