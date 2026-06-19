'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

function pluginsFilePath() {
  return path.join(app.getPath('userData'), 'plugins.json');
}

function loadPluginList() {
  try {
    const raw = fs.readFileSync(pluginsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePluginList(list) {
  fs.writeFileSync(pluginsFilePath(), JSON.stringify(list, null, 2), 'utf8');
}

// Map<id, { process: ChildProcess | null, path: string }>
const processes = new Map();

function spawnPlugin(id, exePath) {
  if (processes.get(id)?.process != null) return;

  let proc;
  try {
    proc = spawn(exePath, [], { detached: false, stdio: 'ignore', shell: false });
  } catch (err) {
    console.error(`[plugin-process] Failed to spawn "${exePath}":`, err.message);
    processes.set(id, { process: null, path: exePath });
    return;
  }

  processes.set(id, { process: proc, path: exePath });

  proc.on('error', (err) => {
    console.error(`[plugin-process] Error from "${exePath}":`, err.message);
    const entry = processes.get(id);
    if (entry) entry.process = null;
  });

  proc.on('close', (code) => {
    console.log(`[plugin-process] "${exePath}" exited (code ${code})`);
    const entry = processes.get(id);
    if (entry) entry.process = null;
  });
}

function startManagedPlugins() {
  for (const { id, path: exePath } of loadPluginList()) {
    spawnPlugin(id, exePath);
  }
}

function killManagedPlugins() {
  const kills = [];
  for (const [, entry] of processes) {
    const proc = entry.process;
    if (!proc) continue;
    kills.push(new Promise((resolve) => {
      proc.once('close', resolve);
      try { proc.kill(); } catch { resolve(); }
    }));
    entry.process = null;
  }
  return Promise.all(kills);
}

function addManagedPlugin(exePath) {
  const id = crypto.randomBytes(8).toString('hex');
  const list = loadPluginList();
  list.push({ id, path: exePath });
  savePluginList(list);
  spawnPlugin(id, exePath);
  return { id, path: exePath, running: processes.get(id)?.process != null };
}

function removeManagedPlugin(id) {
  const entry = processes.get(id);
  if (entry?.process) {
    try { entry.process.kill(); } catch {}
    entry.process = null;
  }
  processes.delete(id);
  savePluginList(loadPluginList().filter((p) => p.id !== id));
}

function getManagedPlugins() {
  return loadPluginList().map(({ id, path: exePath }) => ({
    id,
    path: exePath,
    running: processes.get(id)?.process != null,
  }));
}

module.exports = {
  startManagedPlugins,
  killManagedPlugins,
  addManagedPlugin,
  removeManagedPlugin,
  getManagedPlugins,
};
