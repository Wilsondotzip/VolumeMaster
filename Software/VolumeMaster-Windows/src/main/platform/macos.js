'use strict';

const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const BACKEND_NAME = 'VolumeMaster-Headless';

/**
 * macOS platform implementation.
 * The backend binary is the Swift package at src/backend/macos, built with
 * `npm run prebuild:mac` (or `swift build -c release` in that directory).
 */

/**
 * Returns a friendly title for a process: the name of the .app bundle it
 * belongs to, or the executable name for non-bundle processes.
 */
function bundleTitle(fullPath, base) {
  const appSegment = fullPath.split('/').find((s) => s.endsWith('.app'));
  return appSegment ? appSegment.slice(0, -4) : base;
}

/**
 * Returns a list of running processes using `ps`.
 * On macOS `ps -eo comm` reports full executable paths, so GUI apps are the
 * ones living inside an .app bundle.
 * @returns {Promise<Array<{name: string, title: string, path: string|null, isGUI: boolean}>>}
 */
async function getProcessList() {
  const { stdout } = await execFileAsync('ps', ['-eo', 'comm']);
  const seen = new Map();

  stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1) // skip header
    .forEach((fullPath) => {
      const base = path.basename(fullPath);
      if (!base) return;
      const isGUI = fullPath.includes('.app/Contents/MacOS/');
      const existing = seen.get(base);
      if (!existing || (!existing.isGUI && isGUI)) {
        seen.set(base, { name: base, title: bundleTitle(fullPath, base), path: fullPath, isGUI });
      }
    });

  return [...seen.values()];
}

/**
 * Returns audio input device names via the backend binary, which enumerates
 * CoreAudio input devices. Using the same enumeration as the backend keeps
 * the names in Settings identical to what the backend matches against.
 * @returns {Promise<string[]>}
 */
async function getAudioInputDevices() {
  try {
    const { stdout } = await execFileAsync(getBackendBinaryPath(), ['--list-inputs'], { timeout: 5000 });
    return [...new Set(stdout.split('\n').map((l) => l.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * Resolves a process name to its full executable path using `ps`.
 * @returns {Promise<string|null>}
 */
async function findProcessExePath(exeName) {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'comm']);
    const match = stdout
      .split('\n')
      .map((l) => l.trim())
      .find((p) => path.basename(p) === exeName);
    return match || null;
  } catch {
    return null;
  }
}

/**
 * Returns the absolute path to the backend binary.
 * Packaged builds ship it in Resources; in development it is used straight
 * from the Swift build directory.
 * @returns {string}
 */
function getBackendBinaryPath() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, BACKEND_NAME);
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, '..', '..', 'backend', 'macos', '.build', 'release', BACKEND_NAME);
}

/**
 * Force-kills all backend processes. Used on startup and as a fallback on quit.
 * Safe to call even if no processes are running.
 */
function forceKillAllBackends() {
  try {
    execSync(`pkill -x ${BACKEND_NAME}`, { stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched — that's fine
  }
}

module.exports = {
  getProcessList,
  getAudioInputDevices,
  findProcessExePath,
  getBackendBinaryPath,
  forceKillAllBackends,
};
