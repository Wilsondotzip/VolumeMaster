'use strict';

const path = require('path');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

// In-memory cache: exe name → resolved full path, survives across calls
const exePathCache = new Map();

/**
 * Returns a list of running processes.
 * @returns {Promise<Array<{name: string, isGUI: boolean}>>}
 */
async function getProcessList() {
  const { stdout } = await exec(
    `powershell -NoProfile -Command "Get-Process | Select-Object ProcessName, MainWindowTitle"`,
    { encoding: 'utf8' }
  );

  const seen = new Map();
  stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(2)
    .forEach((line) => {
      const parts = line.split(/\s{2,}/);
      const name = parts[0];
      const windowTitle = parts[1] || '';
      const exeName = name.endsWith('.exe') ? name : `${name}.exe`;

      const existing = seen.get(exeName);
      if (!existing || (!existing.isGUI && windowTitle !== '')) {
        seen.set(exeName, { name: exeName, isGUI: windowTitle !== '' });
      }
    });

  return [...seen.values()];
}

/**
 * Returns a list of audio input device names via Windows WASAPI.
 * @returns {Promise<string[]>}
 */
async function getAudioInputDevices() {
  const portAudio = require('naudiodon');
  const devices = portAudio.getDevices();
  const cleanDevices = devices
    .filter((d) => d.maxInputChannels > 0 && d.hostAPIName === 'Windows WASAPI')
    .map((d) => d.name);
  return [...new Set(cleanDevices)];
}

/**
 * Resolves a running process exe name to its full disk path via PowerShell.
 * Returns null if the process is not found or not running.
 * @param {string} exeName
 * @returns {Promise<string|null>}
 */
async function findProcessExePath(exeName) {
  if (exePathCache.has(exeName)) {
    return exePathCache.get(exeName);
  }

  try {
    const baseName = path.basename(exeName, '.exe');
    const cmd = `powershell -NoProfile -NonInteractive -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1"`;
    const { stdout } = await exec(cmd, { encoding: 'utf8', timeout: 5000 });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) {
      exePathCache.set(exeName, resolved);
      return resolved;
    }
  } catch {
    // Process not found or PowerShell timed out
  }

  return null;
}

/**
 * Returns the absolute path to the platform-specific backend binary.
 * @returns {string}
 */
function getBackendBinaryPath() {
  return path.join(process.resourcesPath, 'VolumeMaster-Headless.exe');
}

/**
 * Force-kills all backend processes. Used on startup and as a fallback on quit.
 * Safe to call even if no processes are running.
 */
function forceKillAllBackends() {
  try {
    require('child_process').execSync('taskkill /F /IM VolumeMaster-Headless.exe', { stdio: 'ignore' });
  } catch {
    // Throws if no matching processes — that's fine
  }
}

module.exports = {
  getProcessList,
  getAudioInputDevices,
  findProcessExePath,
  getBackendBinaryPath,
  forceKillAllBackends,
};
