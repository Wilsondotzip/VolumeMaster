'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const crypto = require('crypto');
const platform = require('./platform');

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

// Set once quitting starts, so a startup that's still running its orphan
// cleanup can't spawn plugins after they've already been killed.
let shuttingDown = false;

function spawnPlugin(id, exePath) {
  if (shuttingDown || processes.get(id)?.process != null) return;

  let proc;
  try {
    // Executables are spawned directly so the tracked process (and its PID for
    // tree-kill) is the plugin itself, not a cmd.exe wrapper. Batch files need
    // cmd — quote the path so one containing spaces (e.g. a Windows username
    // like "John Smith") isn't split into a different command.
    const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(exePath);
    proc = isBatch
      ? spawn(`"${exePath}"`, [], { detached: false, stdio: 'ignore', shell: true, windowsHide: true })
      : spawn(exePath, [], { detached: false, stdio: 'ignore', windowsHide: true });
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

async function startManagedPlugins() {
  const plugins = loadPluginList();
  // Clear out copies left running by a previous session that ended without
  // its quit handler (crash, Task Manager, installer upgrade, dev reload) —
  // otherwise every such exit leaves another duplicate running alongside the
  // fresh one. Must finish before spawning, or it would kill the new ones.
  await platform.forceKillProcessesByPath(plugins.map((p) => p.path));
  for (const { id, path: exePath } of plugins) {
    spawnPlugin(id, exePath);
  }
}

async function killManagedPlugins() {
  shuttingDown = true;
  await killTrackedPlugins();
  // Fallback for anything that escaped the tree-kill (e.g. a process the
  // plugin re-parented or that outlived its parent mid-kill).
  await platform.forceKillProcessesByPath(loadPluginList().map((p) => p.path));
}

function killTrackedPlugins() {
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
