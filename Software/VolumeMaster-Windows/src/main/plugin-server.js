'use strict';

const { WebSocketServer } = require('ws');
const { BrowserWindow } = require('electron');
const { getPluginConfig, savePluginRegistration } = require('./plugin-config-store');
const { loadConfig, onConfigSaved } = require('./config-store');

const PLUGIN_PORT = 59284;
const appVersion = require('../../package.json').version;

// Map<ws, { pluginId, name, actions: [{id, label}] }>
const clients = new Map();

// Last value seen per knob, so a plugin can be told the current level when it
// registers or one of its actions is assigned, instead of waiting for the knob
// to move. Map<deviceId, { deviceDir, values: Map<index, value> }>
const lastKnobValues = new Map();

// PluginActions per knob as of the last config save, to spot new assignments.
// Map<deviceId, Map<index, Set<actionKey>>>
const knownAssignments = new Map();
let wss = null;
let serverStatus = { running: false, error: null };

function broadcastPluginUpdate() {
  const plugins = getConnectedPlugins();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('plugin-actions-updated', plugins);
      } catch {
        // renderer may be reloading
      }
    }
  }
}

function safeSend(socket, data) {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  } catch (err) {
    console.error('[plugin-server] send error:', err.message);
  }
}

function splitActionKey(actionKey) {
  const colonIdx = actionKey.indexOf(':');
  if (colonIdx === -1) return null;
  return { pluginId: actionKey.slice(0, colonIdx), actionId: actionKey.slice(colonIdx + 1) };
}

function knobPluginActions(config, index) {
  const keys = config?.Mappings?.[String(index)]?.PluginActions;
  return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
}

function sendCurrentValues(socket, record) {
  for (const [deviceId, { deviceDir, values }] of lastKnobValues) {
    let config;
    try {
      config = loadConfig(deviceDir);
    } catch {
      continue;
    }
    for (const [index, value] of values) {
      for (const key of knobPluginActions(config, index)) {
        const parts = splitActionKey(key);
        if (parts?.pluginId === record.pluginId) {
          safeSend(socket, { type: 'knob', deviceId, index, value, actionId: parts.actionId, sync: true });
        }
      }
    }
  }
}

// A newly assigned plugin action gets the knob's current value straight away.
onConfigSaved((deviceDir, config) => {
  for (const [deviceId, entry] of lastKnobValues) {
    if (entry.deviceDir !== deviceDir) continue;

    const previous = knownAssignments.get(deviceId) || new Map();
    const current = new Map();
    for (const index of Object.keys(config?.Mappings || {})) {
      current.set(Number(index), new Set(knobPluginActions(config, index)));
    }
    knownAssignments.set(deviceId, current);

    for (const [index, keys] of current) {
      if (!entry.values.has(index)) continue;
      const added = [...keys].filter((k) => !previous.get(index)?.has(k));
      sendToPluginActions(added, (actionId) => ({
        type: 'knob', deviceId, index, value: entry.values.get(index), actionId, sync: true,
      }));
    }
  }
});

function handleRegister(socket, msg) {
  const { pluginId, name, actions, config: configSchema } = msg;
  if (typeof pluginId !== 'string' || !pluginId) {
    safeSend(socket, { type: 'error', message: 'register: pluginId must be a non-empty string.' });
    return;
  }
  // Assignments are stored as 'pluginId:actionId' and split on the first colon.
  if (pluginId.includes(':')) {
    safeSend(socket, { type: 'error', message: "register: pluginId can't contain ':'." });
    return;
  }

  const rawActions = Array.isArray(actions) ? actions : [];
  const record = {
    pluginId,
    name: String(name || pluginId),
    // kind: 'knob' | 'button' restricts where the action can be mapped; omitted/anything else means both.
    // group: optional free-text label to cluster this plugin's own actions in the UI.
    actions: rawActions.filter(a => a?.id && a?.label).map(a => ({
      id: String(a.id),
      label: String(a.label),
      kind: a.kind === 'knob' || a.kind === 'button' ? a.kind : undefined,
      group: typeof a.group === 'string' && a.group.trim() ? a.group.trim() : undefined,
    })),
  };
  clients.set(socket, record);

  const skipped = rawActions.length - record.actions.length;
  safeSend(socket, {
    type: 'registered',
    pluginId,
    actions: record.actions.map((a) => a.id),
    ...(skipped > 0 && { skipped, message: `${skipped} action(s) skipped: each needs an id and a label.` }),
  });

  const schema = Array.isArray(configSchema) ? configSchema.filter(f => f?.key && f?.type) : [];
  if (schema.length > 0) {
    savePluginRegistration(pluginId, record.name, schema);
    const { values } = getPluginConfig(pluginId);
    safeSend(socket, { type: 'config', values: values || {} });
  }

  sendCurrentValues(socket, record);
  broadcastPluginUpdate();
}

function startPluginServer() {
  if (wss) return;

  wss = new WebSocketServer({
    host: '127.0.0.1',
    port: PLUGIN_PORT,
    // Browsers always send an Origin header on WebSocket connections; native
    // plugins don't. Without this, any web page open in the user's browser
    // could connect, register as an installed plugin, and be sent its saved
    // config (passwords included).
    verifyClient: (info) => !info.origin,
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      serverStatus = { running: false, error: `Port ${PLUGIN_PORT} is already in use by another app. The plugin API is unavailable.` };
      console.error(`[plugin-server] ${serverStatus.error}`);
    } else {
      serverStatus = { running: false, error: err.message };
      console.error('[plugin-server] Server error:', err.message);
    }
    wss = null;
    broadcastPluginUpdate();
  });

  wss.on('listening', () => {
    serverStatus = { running: true, error: null };
  });

  wss.on('connection', (socket) => {
    safeSend(socket, { type: 'connected', version: appVersion });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        safeSend(socket, { type: 'error', message: 'Message is not valid JSON.' });
        return;
      }

      if (msg?.type === 'register') {
        handleRegister(socket, msg);
      } else {
        safeSend(socket, { type: 'error', message: `Unknown message type: ${msg?.type}` });
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      broadcastPluginUpdate();
    });

    socket.on('error', () => {
      clients.delete(socket);
      broadcastPluginUpdate();
    });
  });

  console.log(`[plugin-server] Listening on ws://127.0.0.1:${PLUGIN_PORT}`);
}

function stopPluginServer() {
  return new Promise((resolve) => {
    if (!wss) { resolve(); return; }
    // Forcibly terminate all open connections so wss.close() doesn't wait for graceful handshakes
    for (const socket of wss.clients) {
      try { socket.terminate(); } catch {}
    }
    wss.close(() => {
      wss = null;
      resolve();
    });
  });
}

function sendToPluginActions(actionKeys, buildMessage) {
  if (!clients.size || !Array.isArray(actionKeys) || actionKeys.length === 0) return;

  for (const actionKey of actionKeys) {
    const parts = splitActionKey(actionKey);
    if (!parts) continue;

    for (const [socket, record] of clients) {
      if (record.pluginId === parts.pluginId) {
        safeSend(socket, buildMessage(parts.actionId));
      }
    }
  }
}

function dispatchKnobEvent(deviceId, deviceDir, index, value, config) {
  if (!lastKnobValues.has(deviceId)) {
    lastKnobValues.set(deviceId, { deviceDir, values: new Map() });
    // Baseline, so the first config save only syncs actions assigned after it.
    const assignments = new Map();
    for (const i of Object.keys(config?.Mappings || {})) {
      assignments.set(Number(i), new Set(knobPluginActions(config, i)));
    }
    knownAssignments.set(deviceId, assignments);
  }
  lastKnobValues.get(deviceId).values.set(index, value);

  sendToPluginActions(knobPluginActions(config, index), (actionId) => ({ type: 'knob', deviceId, index, value, actionId }));
}

function buttonPluginKeys(config, index) {
  const buttonActions = config?.Mappings?.[String(index)]?.ButtonActions;
  if (!Array.isArray(buttonActions)) return [];
  // Built-in actions (keyboard shortcut, mute, open program) aren't plugin-mediated —
  // only 'plugin' entries go out over the WebSocket API. Bare strings are the older
  // pre-migration format (plugin key with no wrapper object); treated the same way.
  return buttonActions
    .filter((a) => typeof a === 'string' || a?.kind === 'plugin')
    .map((a) => (typeof a === 'string' ? a : a.key));
}

function dispatchKnobButtonEvent(deviceId, index, config) {
  sendToPluginActions(buttonPluginKeys(config, index), (actionId) => ({ type: 'knob-button', deviceId, index, actionId }));
}

function dispatchKnobButtonUpEvent(deviceId, index, holdMs, config) {
  sendToPluginActions(buttonPluginKeys(config, index), (actionId) => ({ type: 'knob-button-up', deviceId, index, holdMs, actionId }));
}

function getConnectedPlugins() {
  const seen = new Map();
  for (const record of clients.values()) {
    if (!seen.has(record.pluginId)) {
      seen.set(record.pluginId, { pluginId: record.pluginId, name: record.name, actions: record.actions });
    }
  }
  return [...seen.values()];
}

function getPluginServerStatus() {
  return { ...serverStatus, port: PLUGIN_PORT };
}

function sendConfigToPlugin(pluginId, values) {
  for (const [socket, record] of clients) {
    if (record.pluginId === pluginId) {
      safeSend(socket, { type: 'config', values });
    }
  }
}

function getPluginLabel(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return actionKey;
  const parts = splitActionKey(actionKey);
  if (!parts) return actionKey;

  for (const record of clients.values()) {
    if (record.pluginId === parts.pluginId) {
      const action = record.actions.find((a) => a.id === parts.actionId);
      if (action) return action.label;
    }
  }
  return null;
}

module.exports = {
  startPluginServer,
  stopPluginServer,
  dispatchKnobEvent,
  dispatchKnobButtonEvent,
  dispatchKnobButtonUpEvent,
  getConnectedPlugins,
  getPluginLabel,
  getPluginServerStatus,
  sendConfigToPlugin,
  PLUGIN_PORT,
};
