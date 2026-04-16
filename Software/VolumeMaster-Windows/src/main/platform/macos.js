'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Returns a list of running processes using `ps`.
 * @returns {Promise<Array<{name: string, isGUI: boolean}>>}
 */
async function getProcessList() {
  const { stdout } = await execFileAsync('ps', ['-eo', 'comm']);
  const seen = new Set();

  stdout
    .split('\n')
    .map((l) => path.basename(l.trim()))
    .filter(Boolean)
    .slice(1) // skip header
    .forEach((name) => seen.add(name));

  // macOS processes don't have a reliable "isGUI" flag from ps — default false
  return [...seen].map((name) => ({ name, isGUI: false }));
}

/**
 * Returns audio input device names via CoreAudio (naudiodon/PortAudio).
 * @returns {Promise<string[]>}
 */
async function getAudioInputDevices() {
  const portAudio = require('naudiodon');
  const devices = portAudio.getDevices();
  const cleanDevices = devices
    .filter((d) => d.maxInputChannels > 0 && d.hostAPIName === 'Core Audio')
    .map((d) => d.name);
  return [...new Set(cleanDevices)];
}

/**
 * Resolves a process name to its .app bundle path (for icon extraction).
 * Tries Spotlight (mdfind) first, then falls back to common app directories.
 * @param {string} exeName
 * @returns {Promise<string|null>}
 */
async function findProcessExePath(exeName) {
  // Strip .exe suffix if present (Windows process names copied from config)
  const baseName = path.basename(exeName, '.exe');

  // Spotlight lookup — finds installed .app bundles by their executable name
  try {
    const { stdout } = await execFileAsync(
      'mdfind',
      [`kMDItemCFBundleExecutable == "${baseName}"`],
      { timeout: 3000 }
    );
    const appPath = stdout.split('\n').find((l) => l.trim().endsWith('.app'));
    if (appPath && fs.existsSync(appPath.trim())) return appPath.trim();
  } catch {
    // Spotlight unavailable
  }

  // Fall back to common install locations
  const searchDirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  for (const dir of searchDirs) {
    const appBundle = path.join(dir, `${baseName}.app`);
    if (fs.existsSync(appBundle)) return appBundle;
  }

  return null;
}

/**
 * Returns the path to the macOS backend binary.
 * Stub — returns null until the Swift backend is built.
 * @returns {string|null}
 */
function getBackendBinaryPath() {
  return null;
}

/**
 * Force-kills all backend processes.
 * Stub — no-op until the Swift backend binary name is known.
 */
function forceKillAllBackends() {
  // no-op until Swift backend exists
}

module.exports = {
  getProcessList,
  getAudioInputDevices,
  findProcessExePath,
  getBackendBinaryPath,
  forceKillAllBackends,
};
