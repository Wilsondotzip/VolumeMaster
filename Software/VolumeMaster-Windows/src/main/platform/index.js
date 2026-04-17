'use strict';

/**
 * Platform abstraction layer.
 * Loads the correct OS-specific implementation based on process.platform.
 *
 * Each platform module must implement:
 *   getProcessList()         → Promise<Array<{name: string, isGUI: boolean}>>
 *   getAudioInputDevices()   → Promise<string[]>
 *   findProcessExePath(exe)  → Promise<string|null>
 *   getBackendBinaryPath()   → string
 *   forceKillAllBackends()   → void
 */

const platformMap = {
  win32: './windows',
  darwin: './macos',
  // linux: './linux',   // future
};

const impl = platformMap[process.platform];
if (!impl) {
  throw new Error(`Unsupported platform: ${process.platform}`);
}

module.exports = require(impl);
