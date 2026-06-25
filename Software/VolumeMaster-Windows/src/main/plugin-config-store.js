'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function configFilePath() {
  return path.join(app.getPath('userData'), 'plugin-configs.json');
}

function loadAll() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(configFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getPluginConfig(pluginId) {
  const all = loadAll();
  return all[pluginId] || { name: pluginId, schema: [], values: {} };
}

function savePluginRegistration(pluginId, name, schema) {
  const all = loadAll();
  if (!all[pluginId]) all[pluginId] = { name, schema, values: {} };
  else { all[pluginId].name = name; all[pluginId].schema = schema; }
  saveAll(all);
}

function savePluginValues(pluginId, values) {
  const all = loadAll();
  if (!all[pluginId]) all[pluginId] = { name: pluginId, schema: [], values: {} };
  all[pluginId].values = { ...all[pluginId].values, ...values };
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
      values: entry.values || {},
    }));
}

module.exports = { getPluginConfig, savePluginRegistration, savePluginValues, getConfigurablePlugins };
