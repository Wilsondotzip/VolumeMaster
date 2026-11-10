'use strict';

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// Values of 'password' fields are stored encrypted by the OS (DPAPI on Windows,
// Keychain on macOS) as { $encrypted: '<base64>' }, so a copied, synced or
// shared plugin-configs.json doesn't expose them. They only decrypt for the
// same OS user on the same machine; elsewhere they read as unset.
const ENCRYPTED = '$encrypted';

let warnedNoEncryption = false;

function canEncrypt() {
  try {
    if (safeStorage.isEncryptionAvailable()) return true;
  } catch {
    // Not available on this platform/session
  }
  if (!warnedNoEncryption) {
    warnedNoEncryption = true;
    console.warn('[plugin-config] OS encryption unavailable; plugin passwords are stored as plain text.');
  }
  return false;
}

function isEncrypted(value) {
  return value !== null && typeof value === 'object' && typeof value[ENCRYPTED] === 'string';
}

function passwordKeys(schema) {
  return Array.isArray(schema) ? schema.filter((f) => f?.type === 'password').map((f) => f.key) : [];
}

/** Encrypts any plain-text password values in place. Returns true if anything changed. */
function encryptPasswordFields(entry) {
  if (!entry.values) return false;
  let changed = false;
  for (const key of passwordKeys(entry.schema)) {
    const value = entry.values[key];
    if (typeof value !== 'string' || value === '' || !canEncrypt()) continue;
    entry.values[key] = { [ENCRYPTED]: safeStorage.encryptString(value).toString('base64') };
    changed = true;
  }
  return changed;
}

function decryptValues(values) {
  const out = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (!isEncrypted(value)) {
      out[key] = value;
      continue;
    }
    try {
      out[key] = safeStorage.decryptString(Buffer.from(value[ENCRYPTED], 'base64'));
    } catch {
      // Encrypted by another user or machine (e.g. a copied file) — treat as unset
    }
  }
  return out;
}

function configFilePath() {
  return path.join(app.getPath('userData'), 'plugin-configs.json');
}

function loadAll() {
  let all;
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    all = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }

  // Passwords saved before encryption was added are encrypted on first load
  let migrated = false;
  for (const entry of Object.values(all)) {
    if (entry && typeof entry === 'object' && encryptPasswordFields(entry)) migrated = true;
  }
  if (migrated) saveAll(all);
  return all;
}

function saveAll(data) {
  fs.writeFileSync(configFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getPluginConfig(pluginId) {
  const entry = loadAll()[pluginId];
  if (!entry) return { name: pluginId, schema: [], values: {} };
  return { ...entry, values: decryptValues(entry.values) };
}

function savePluginRegistration(pluginId, name, schema) {
  const all = loadAll();
  if (!all[pluginId]) all[pluginId] = { name, schema, values: {} };
  else { all[pluginId].name = name; all[pluginId].schema = schema; }
  // A field that just became a password field gets encrypted
  encryptPasswordFields(all[pluginId]);
  saveAll(all);
}

function savePluginValues(pluginId, values) {
  const all = loadAll();
  if (!all[pluginId]) all[pluginId] = { name: pluginId, schema: [], values: {} };
  all[pluginId].values = { ...all[pluginId].values, ...values };
  encryptPasswordFields(all[pluginId]);
  saveAll(all);
}

function getConfigurablePlugins() {
  const all = loadAll();
  return Object.entries(all)
    .filter(([, entry]) => Array.isArray(entry.schema) && entry.schema.length > 0)
    .map(([pluginId, entry]) => ({
      pluginId,
      name: entry.name || pluginId,
      schema: entry.schema,
      values: decryptValues(entry.values),
    }));
}

module.exports = { getPluginConfig, savePluginRegistration, savePluginValues, getConfigurablePlugins };
