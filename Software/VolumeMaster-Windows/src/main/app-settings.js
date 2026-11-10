'use strict';

const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// App-wide settings (not per device): <userData>/app-settings.json.
//
// popupDisplay: where knob popups (Action Ring, list selectors) appear.
//   { mode: 'mouse' }                         the display the cursor is on (default)
//   { mode: 'primary' }                       Windows' main display
//   { mode: 'display', id, label, bounds }    a specific monitor; label and bounds
//     are kept because display ids can change after a reboot or reconnect

const DEFAULTS = { popupDisplay: { mode: 'mouse' } };

let cache = null;

function filePath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    cache = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

function displayLabel(display) {
  return display.label || `Display ${display.id}`;
}

/** Connected displays for the Settings dropdown. */
function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: displayLabel(d),
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primaryId,
    bounds: d.bounds,
  }));
}

function getPopupDisplaySetting() {
  return load().popupDisplay || DEFAULTS.popupDisplay;
}

function setPopupDisplaySetting(value) {
  let next = DEFAULTS.popupDisplay;
  if (value?.mode === 'primary') {
    next = { mode: 'primary' };
  } else if (value?.mode === 'display') {
    const display = screen.getAllDisplays().find((d) => d.id === value.id);
    if (display) next = { mode: 'display', id: display.id, label: displayLabel(display), bounds: display.bounds };
  }
  return save({ popupDisplay: next }).popupDisplay;
}

function sameBounds(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The saved monitor if it's connected (by id, then name, then position), else null. */
function findSavedDisplay(setting, displays = screen.getAllDisplays()) {
  return displays.find((d) => d.id === setting.id)
    || (setting.label && displays.find((d) => displayLabel(d) === setting.label))
    || displays.find((d) => sameBounds(d.bounds, setting.bounds))
    || null;
}

/** The display a knob popup should open on right now. */
function resolvePopupDisplay() {
  const setting = getPopupDisplaySetting();
  if (setting.mode === 'primary') return screen.getPrimaryDisplay();
  if (setting.mode === 'display') {
    const saved = findSavedDisplay(setting);
    if (saved) return saved;
    // Unplugged: follow the mouse until it's back (the setting itself is kept)
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** For Settings: the saved choice, and whether a chosen monitor is connected. */
function describePopupDisplay() {
  const setting = getPopupDisplaySetting();
  if (setting.mode !== 'display') return { ...setting, connected: true };
  const saved = findSavedDisplay(setting);
  return { ...setting, id: saved ? saved.id : setting.id, connected: !!saved };
}

module.exports = { listDisplays, getPopupDisplaySetting: describePopupDisplay, setPopupDisplaySetting, resolvePopupDisplay };
