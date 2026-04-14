const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'assets', 'config.yaml');

const STRINGIFY_OPTIONS = {
  lineWidth: 0,
  aliasDuplicateObjects: false,
};

// Per-device config cache: Map<deviceDir, config>
const configCaches = new Map();

/**
 * YAML may parse merge keys / aliases so multiple knobs share one ProcessNames or MicNames array.
 * That breaks drag/drop (includes()/DOM get out of sync). Force independent arrays per knob.
 */
function coerceNameList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean);
}

function detachMappingArrays(cfg) {
  if (!cfg || typeof cfg !== 'object' || !cfg.Mappings || typeof cfg.Mappings !== 'object') {
    return cfg;
  }
  for (const key of Object.keys(cfg.Mappings)) {
    const m = cfg.Mappings[key];
    if (!m || typeof m !== 'object') {
      cfg.Mappings[key] = { ProcessNames: [], MicNames: [] };
      continue;
    }
    m.ProcessNames = coerceNameList(m.ProcessNames);
    m.MicNames = coerceNameList(m.MicNames);
  }
  return cfg;
}

function configFilePath(deviceDir) {
  return path.join(deviceDir, 'config.yaml');
}

function loadConfig(deviceDir) {
  if (configCaches.has(deviceDir)) return configCaches.get(deviceDir);

  let config;
  try {
    config = yaml.parse(fs.readFileSync(configFilePath(deviceDir), 'utf8'));
  } catch {
    config = yaml.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  }

  detachMappingArrays(config);

  let dirty = false;
  if (config.vm === undefined) { config.vm = false; dirty = true; }
  if (config.vmversion === undefined) { config.vmversion = 'banana'; dirty = true; }
  if (config.volumeNotifications === undefined) { config.volumeNotifications = true; dirty = true; }
  if (config.lastPreset === undefined) { config.lastPreset = null; dirty = true; }
  if (dirty) saveConfig(deviceDir, config);

  configCaches.set(deviceDir, config);
  return config;
}

function saveConfig(deviceDir, data) {
  if (!data || typeof data !== 'object') return;
  detachMappingArrays(data);
  configCaches.set(deviceDir, data);
  fs.writeFileSync(configFilePath(deviceDir), yaml.stringify(data, STRINGIFY_OPTIONS), 'utf8');
}

function cloneConfigSnapshot(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(cfg));
  } catch {
    return null;
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  cloneConfigSnapshot,
  DEFAULT_CONFIG_PATH,
};
