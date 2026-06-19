'use strict';

const { WebSocketServer } = require('ws');
const { BrowserWindow } = require('electron');

const PLUGIN_PORT = 59284;
const appVersion = require('../../package.json').version;

// Map<ws, { pluginId, name, actions: [{id, label}] }>
const clients = new Map();
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

function startPluginServer() {
  if (wss) return;

  wss = new WebSocketServer({ host: '127.0.0.1', port: PLUGIN_PORT });

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
        return;
      }

      if (msg.type === 'register') {
        const { pluginId, name, actions } = msg;
        if (!pluginId || typeof pluginId !== 'string') return;
        clients.set(socket, {
          pluginId: String(pluginId),
          name: String(name || pluginId),
          actions: Array.isArray(actions) ? actions.filter(a => a?.id && a?.label) : [],
        });
        broadcastPluginUpdate();
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

function dispatchKnobEvent(deviceId, index, value, config) {
  if (!clients.size) return;
  const pluginActions = config?.Mappings?.[String(index)]?.PluginActions;
  if (!Array.isArray(pluginActions) || pluginActions.length === 0) return;

  for (const actionKey of pluginActions) {
    const colonIdx = actionKey.indexOf(':');
    if (colonIdx === -1) continue;
    const pluginId = actionKey.slice(0, colonIdx);
    const actionId = actionKey.slice(colonIdx + 1);

    for (const [socket, record] of clients) {
      if (record.pluginId === pluginId) {
        safeSend(socket, { type: 'knob', deviceId, index, value, actionId });
      }
    }
  }
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

function getPluginLabel(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return actionKey;
  const colonIdx = actionKey.indexOf(':');
  if (colonIdx === -1) return actionKey;
  const pluginId = actionKey.slice(0, colonIdx);
  const actionId = actionKey.slice(colonIdx + 1);

  for (const record of clients.values()) {
    if (record.pluginId === pluginId) {
      const action = record.actions.find((a) => a.id === actionId);
      if (action) return action.label;
    }
  }
  return null;
}

module.exports = {
  startPluginServer,
  stopPluginServer,
  dispatchKnobEvent,
  getConnectedPlugins,
  getPluginLabel,
  getPluginServerStatus,
  PLUGIN_PORT,
};
