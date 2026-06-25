'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const crypto = require('crypto');

function pluginsFilePath() {
  return path.join(app.getPath('userData'), 'plugins.json');
}

function pluginDir(id) {
  return path.join(app.getPath('userData'), 'plugins', id);
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
    proc = spawn(exePath, [], { detached: false, stdio: 'ignore', shell: true });
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
      const timer = setTimeout(resolve, 3000);
      proc.once('close', () => { clearTimeout(timer); resolve(); });
      if (proc.pid) {
        treeKill(proc.pid, () => {});
      } else {
        try { proc.kill(); } catch { clearTimeout(timer); resolve(); }
      }
    }));
    entry.process = null;
  }
  return Promise.all(kills);
}

function addManagedPlugin(exePath) {
  const id = crypto.randomBytes(8).toString('hex');

  // Copy into the central plugins folder so moving/deleting the original doesn't break it
  const destDir = pluginDir(id);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(exePath));
  fs.copyFileSync(exePath, destPath);

  const list = loadPluginList();
  list.push({ id, path: destPath });
  savePluginList(list);
  spawnPlugin(id, destPath);
  return { id, path: destPath, running: processes.get(id)?.process != null };
}

function removeManagedPlugin(id) {
  const entry = processes.get(id);
  if (entry?.process?.pid) {
    treeKill(entry.process.pid, () => {});
    entry.process = null;
  }
  processes.delete(id);
  savePluginList(loadPluginList().filter((p) => p.id !== id));

  // Delete the plugin's folder from disk
  try {
    fs.rmSync(pluginDir(id), { recursive: true, force: true });
  } catch (err) {
    console.error(`[plugin-process] Failed to delete plugin folder for ${id}:`, err.message);
  }
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
