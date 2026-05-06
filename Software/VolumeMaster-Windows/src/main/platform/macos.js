'use strict';

const path = require('path');

/**
 * macOS platform implementation.
 * Audio input devices and process icon extraction are stubs
 */

/**
 * Returns a list of running processes using `ps`.
 * @returns {Promise<Array<{name: string, title: string, path: string|null, isGUI: boolean}>>}
 */
async function getProcessList() {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync('ps', ['-eo', 'comm']);
  const seen = new Set();

  stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1) // skip header
    .forEach((name) => {
      const base = path.basename(name);
      if (base) seen.add(base);
    });

  // macOS processes don't have a reliable "isGUI" flag from ps — default false (will need some way around this...)
  return [...seen].map((name) => ({ name, title: name, path: null, isGUI: false }));
}

/**
 * Returns audio input device names.
 * Stub — returns empty 
 * @returns {Promise<string[]>}
 */
async function getAudioInputDevices() {
  return [];
}

/**
 * Resolves a process name to its executable path.
 * Uses `which` for PATH-based lookups; returns null for unknown processes.
 * Not sure if this is needed for MacOS, but it was part of the Windows implementation so included for parity. depends how the backend is implemented
 * @returns {Promise<string|null>}
 */
async function findProcessExePath(exeName) {
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('which', [exeName]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Returns the path to the macOS backend binary.
 * Stub — returns null until a macOS backend is built.
 * @returns {string|null}
 */
function getBackendBinaryPath() {
  return null;
}

/**
 * Force-kills all backend processes.
 * Stub — no-op until the macOS backend binary name is known.
 */
function forceKillAllBackends() {
  // no-op for now
}

module.exports = {
  getProcessList,
  getAudioInputDevices,
  findProcessExePath,
  getBackendBinaryPath,
  forceKillAllBackends,
};
