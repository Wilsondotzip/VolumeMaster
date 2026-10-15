const { loadConfig, saveConfig, cloneConfigSnapshot } = require('./config-store');
const deviceManager = require('./device-manager');

// Built-in button actions that change app settings (switch preset, knob encoder
// mode). Unlike keyboard shortcut / mute / open program, these run here rather
// than in the Python backend: the main process owns config.yaml and presets, and
// the backend picks up the resulting config change through its file watcher.
const SETTINGS_ACTION_TYPES = new Set(['switch_preset', 'encoder_mode']);

function getSettingsActions(config, index) {
  const list = config?.Mappings?.[String(index)]?.ButtonActions;
  if (!Array.isArray(list)) return [];
  return list.filter((a) => a?.kind === 'builtin' && SETTINGS_ACTION_TYPES.has(a.type));
}

/** Returns the preset name to load, or null if there's nothing to switch to. */
function resolvePresetTarget(config, params) {
  const names = Object.keys(config.presets || {});
  if (!names.length) return null;

  const mode = params?.mode || 'next';
  if (mode === 'specific') {
    return names.includes(params?.name) ? params.name : null;
  }

  const current = names.indexOf(config.lastPreset);
  if (current === -1) return mode === 'previous' ? names[names.length - 1] : names[0];
  const step = mode === 'previous' ? -1 : 1;
  return names[(current + step + names.length) % names.length];
}

function applySwitchPreset(config, params) {
  const name = resolvePresetTarget(config, params);
  if (!name) return null;
  config.Mappings = JSON.parse(JSON.stringify(config.presets[name]));
  config.lastPreset = name;
  return name;
}

function applyEncoderMode(config, index, params) {
  const knobId = params?.knob ? String(params.knob) : String(index);
  const mapping = config.Mappings?.[knobId];
  if (!mapping) return false;

  const current = mapping.EncoderMode === 'increment' ? 'increment' : 'absolute';
  const mode = params?.mode || 'toggle';
  const next = mode === 'toggle' ? (current === 'increment' ? 'absolute' : 'increment') : mode;
  if (next !== 'absolute' && next !== 'increment') return false;
  if (next === current) return false;

  mapping.EncoderMode = next;
  // Mirror the renderer's auto-save so the change survives switching presets away and back.
  const preset = config.lastPreset && config.presets?.[config.lastPreset];
  if (preset?.[knobId]) preset[knobId].EncoderMode = next;
  return true;
}

function executeSettingsButtonActions(deviceId, deviceDir, index) {
  let config;
  try {
    config = loadConfig(deviceDir);
  } catch {
    return;
  }

  // Snapshot the list up front: a preset switch replaces config.Mappings, but
  // every action configured on the knob that was pressed should still run.
  const actions = getSettingsActions(config, index);
  if (!actions.length) return;

  let changed = false;
  let loadedPreset = null;
  for (const action of actions) {
    try {
      if (action.type === 'switch_preset') {
        const name = applySwitchPreset(config, action.params);
        if (name) {
          loadedPreset = name;
          changed = true;
        }
      } else if (action.type === 'encoder_mode') {
        if (applyEncoderMode(config, index, action.params)) changed = true;
      }
    } catch (err) {
      console.error(`[${deviceId}] Failed to execute button action`, action, err);
    }
  }
  if (!changed) return;

  saveConfig(deviceDir, config);

  const win = deviceManager.getWindowForDevice(deviceId);
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send('config-changed', { config: cloneConfigSnapshot(config), loadedPreset });
    } catch {
      // Renderer may be reloading
    }
  }
}

module.exports = { executeSettingsButtonActions };
