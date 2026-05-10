'use strict';

const path = require('path');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

// In-memory cache: exe name → resolved full path, survives across calls
const exePathCache = new Map();

function normalizeProcessTitle(windowTitle, processName) {
  const fallback = processName.endsWith('.exe') ? processName : `${processName}.exe`;
  if (!windowTitle) return fallback;

  const separators = [' - ', ' — ', ' | '];
  for (const separator of separators) {
    const parts = windowTitle
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
  }

  return windowTitle;
}

/**
 * Returns a list of running processes and their friendly titles by invoking PowerShell to query the system.
 * Each entry includes:
 *   - name: the executable name (e.g. "chrome.exe")
 *   - title: a user-friendly title derived from the window title or process name
 * @returns {Promise<Array<{name: string, title: string, path: string|null, isGUI: boolean}>>}
 */
async function getProcessList() {
  const { stdout } = await exec(
    `powershell -NoProfile -Command "Get-Process | Select-Object ProcessName, MainWindowTitle, Path | ConvertTo-Json -Depth 2"`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 } // maxBuffer increased to handle large process lists with long titles/paths without truncation
  );

  const raw = stdout.trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Map();

  rows.forEach((row) => {
    const processName = typeof row?.ProcessName === 'string' ? row.ProcessName.trim() : '';
    if (!processName) return;

    const exeName = processName.endsWith('.exe') ? processName : `${processName}.exe`;
    const windowTitle = typeof row?.MainWindowTitle === 'string' ? row.MainWindowTitle.trim() : '';
    const resolvedPath = typeof row?.Path === 'string' && row.Path.trim() ? row.Path.trim() : null;
    const nextEntry = {
      name: exeName,
      title: normalizeProcessTitle(windowTitle, processName),
      path: resolvedPath,
      isGUI: windowTitle !== '',
    };

    const existing = seen.get(exeName);
    if (!existing || (!existing.isGUI && nextEntry.isGUI)) {
      seen.set(exeName, nextEntry);
    }
  });

  return [...seen.values()];
}

/**
 * Returns a list of audio input device names via Windows WASAPI.
 * Uses PowerShell + PnP device enumeration to avoid loading PortAudio native
 * modules (naudiodon/segfault-handler), which crash on wake from sleep.
 * Capture endpoints have InstanceId starting with SWD\MMDEVAPI\{0.0.1 (eCapture flow).
 * @returns {Promise<string[]>}
 */
async function getAudioInputDevices() {
  try {
    const { stdout } = await exec(
      `powershell -NoProfile -Command "Get-PnpDevice -Class AudioEndpoint -Status OK | Where-Object {$_.InstanceId -like 'SWD\\MMDEVAPI\\{0.0.1*'} | Select-Object -ExpandProperty FriendlyName | ConvertTo-Json"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const names = Array.isArray(parsed) ? parsed : [parsed];
    return [...new Set(names.filter(Boolean))];
  } catch {
    return [];
  }
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
