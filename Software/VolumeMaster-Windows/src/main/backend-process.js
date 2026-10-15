const { spawn } = require('child_process');
const treeKill = require('tree-kill');

const platform = require('./platform');
const { setTrayImageNormal, setTrayImageCrashed } = require('./tray');
const deviceManager = require('./device-manager');
const { handleVolumeChange } = require('./notification-window');
const { dispatchKnobEvent, dispatchKnobButtonEvent } = require('./plugin-server');
const { loadConfig } = require('./config-store');
const { executeSettingsButtonActions } = require('./button-settings-actions');
const { handleSelectorEvent, clearDeviceSelectors } = require('./selector-service');

// Map<deviceId, { process, retryTimeout }>
const backends = new Map();

// Pending LIST_SESSIONS responses: Map<deviceId, resolve>
const sessionRequests = new Map();

// Pending LIST_OUTPUTS responses: Map<deviceId, resolve>
const outputRequests = new Map();

// PIDs killed on purpose (Stop button, a restart) — the process's own 'close'
// handler checks this so it doesn't auto-relaunch what we just told it to stop.
const intentionalKills = new Set();

function sendStatusToDevice(deviceId, type, message) {
  const win = deviceManager.getWindowForDevice(deviceId);
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('backend-status', { type, message });
  } catch {
    // Renderer may be reloading or in a crashed state (e.g. GPU reset on wake from sleep)
  }
}

function updateTrayImage() {
  const anyRunning = [...backends.values()].some((b) => b.process != null);
  if (anyRunning) setTrayImageNormal();
  else setTrayImageCrashed();
}

function scheduleRetry(deviceId, deviceDir) {
  const backend = backends.get(deviceId);
  if (backend?.retryTimeout) return;

  console.log(`[${deviceId}] Retrying backend in 5 seconds...`);
  const timeout = setTimeout(() => {
    const b = backends.get(deviceId);
    if (b) b.retryTimeout = null;
    startBackend(deviceId, deviceDir);
  }, 5000);

  if (backend) {
    backend.retryTimeout = timeout;
  } else {
    backends.set(deviceId, { process: null, retryTimeout: timeout });
  }

  updateTrayImage();
}

function startBackend(deviceId, deviceDir) {
  if (backends.get(deviceId)?.process) {
    console.log(`[${deviceId}] Backend already running`);
    return;
  }

  console.log(`[${deviceId}] Starting backend...`);
  const deviceModel = loadConfig(deviceDir).deviceModel;
  const proc = spawn(platform.getBackendBinaryPath(deviceModel), [], {
    detached: false,
    stdio: 'pipe',
    shell: false,
    cwd: deviceDir,
  });

  const existing = backends.get(deviceId);
  backends.set(deviceId, { process: proc, retryTimeout: existing?.retryTimeout || null });
  updateTrayImage();
  sendStatusToDevice(deviceId, 'success', 'Backend started successfully.');

  proc.stdout.on('error', (err) => console.error(`[${deviceId}] stdout error:`, err));
  proc.stderr.on('error', (err) => console.error(`[${deviceId}] stderr error:`, err));

  // A 'data' chunk is an arbitrary slice of the pipe, not a whole number of
  // lines: carry any trailing partial line over to the next chunk, or a line
  // straddling the boundary (e.g. a long SELECTOR_OPEN JSON) is lost as two
  // unparseable halves. setEncoding likewise keeps multi-byte chars intact.
  proc.stdout.setEncoding('utf8');
  let stdoutRemainder = '';
  proc.stdout.on('data', (data) => {
    const lines = (stdoutRemainder + data).split(/\r?\n/);
    stdoutRemainder = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('ERROR:VM_NOT_RUNNING:')) {
        sendStatusToDevice(deviceId, 'vm-error', trimmed.slice('ERROR:VM_NOT_RUNNING:'.length));
      } else if (trimmed.startsWith('ERROR:AUDIO_UNAVAILABLE:')) {
        sendStatusToDevice(deviceId, 'audio-error', trimmed.slice('ERROR:AUDIO_UNAVAILABLE:'.length));
      } else if (trimmed === 'STATUS:AUDIO_OK') {
        sendStatusToDevice(deviceId, 'audio-ok', '');
      } else if (trimmed.startsWith('ERROR:COM_PORT:')) {
        sendStatusToDevice(deviceId, 'com-port-error', trimmed.slice('ERROR:COM_PORT:'.length));
      } else if (trimmed === 'STATUS:SERIAL_OK') {
        sendStatusToDevice(deviceId, 'serial-ok', '');
      } else if (trimmed.startsWith('SESSIONS:')) {
        const resolve = sessionRequests.get(deviceId);
        if (resolve) {
          sessionRequests.delete(deviceId);
          const names = trimmed.slice('SESSIONS:'.length).split(',').filter(Boolean);
          resolve(names);
        }
      } else if (trimmed.startsWith('OUTPUTS:')) {
        const resolve = outputRequests.get(deviceId);
        if (resolve) {
          outputRequests.delete(deviceId);
          let payload = { devices: [], default: null };
          try {
            payload = JSON.parse(trimmed.slice('OUTPUTS:'.length));
          } catch {
            // Malformed line — resolve with the empty default
          }
          resolve(payload);
        }
      } else if (trimmed.startsWith('SELECTOR_')) {
        const colon = trimmed.indexOf(':');
        if (colon !== -1) {
          let payload = null;
          try {
            payload = JSON.parse(trimmed.slice(colon + 1));
          } catch {
            // Malformed line — ignore
          }
          handleSelectorEvent(deviceId, trimmed.slice('SELECTOR_'.length, colon), payload);
        }
      } else if (trimmed.startsWith('OUTPUT_CHANGED:')) {
        sendStatusToDevice(deviceId, 'info', `Output switched to ${trimmed.slice('OUTPUT_CHANGED:'.length)}`);
      } else if (trimmed.startsWith('VOLUME:')) {
        const parts = trimmed.split(':');
        if (parts.length === 3) {
          const index = parseInt(parts[1], 10);
          const value = parseInt(parts[2], 10);
          const win = deviceManager.getWindowForDevice(deviceId);
          if (win) win.webContents.send('volume-update', { index, value });
          handleVolumeChange(deviceId, deviceDir, index, value);
          dispatchKnobEvent(deviceId, index, value, loadConfig(deviceDir));
        }
      } else if (trimmed.startsWith('BUTTON_UP:')) {
        const parts = trimmed.split(':');
        if (parts.length === 3) {
          const index = parseInt(parts[1], 10);
          const holdMs = parseInt(parts[2], 10);
          const win = deviceManager.getWindowForDevice(deviceId);
          if (win) win.webContents.send('button-press', { index, pressed: false, holdMs });
        }
      } else if (trimmed.startsWith('BUTTON:')) {
        const index = parseInt(trimmed.slice('BUTTON:'.length), 10);
        if (!Number.isNaN(index)) {
          const win = deviceManager.getWindowForDevice(deviceId);
          if (win) win.webContents.send('button-press', { index, pressed: true });
          dispatchKnobButtonEvent(deviceId, index, loadConfig(deviceDir));
          executeSettingsButtonActions(deviceId, deviceDir, index);
        }
      } else {
        sendStatusToDevice(deviceId, 'info', `[Backend] ${trimmed}`);
      }
    }
  });

  function isStillTracked() {
    const current = backends.get(deviceId);
    return !current || current.process === proc;
  }

  proc.stderr.on('data', (data) => {
    console.error(`[${deviceId}] stderr: ${data}`);
    if (!isStillTracked()) return;
    sendStatusToDevice(deviceId, 'error', `[Backend stderr] ${data}`);

  });

  proc.on('error', (err) => {
    console.error(`[${deviceId}] error:`, err);
    if (!isStillTracked()) return;
    let message = `Backend error: ${err.message}`;
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      message = 'Access denied launching backend — antivirus or permissions may be blocking VolumeMaster-Headless.exe.';
    } else if (err.code === 'ENOENT') {
      message = 'Backend executable not found. Try reinstalling VolumeMaster.';
    }
    sendStatusToDevice(deviceId, 'error', message);
    const b = backends.get(deviceId);
    if (b) b.process = null;
    updateTrayImage();
    scheduleRetry(deviceId, deviceDir);
  });

  proc.on('close', (code) => {
    console.log(`[${deviceId}] Backend exited with code ${code}`);
    const wasIntentional = intentionalKills.delete(proc.pid);
    clearDeviceSelectors(deviceId);
    if (!isStillTracked()) return;
    const message = wasIntentional
      ? 'Backend stopped.'
      : code === 1
        ? 'Backend stopped. Check banners above for details.'
        : `Backend exited unexpectedly (code ${code}). Antivirus may have intervened.`;
    sendStatusToDevice(deviceId, 'warning', message);
    const b = backends.get(deviceId);
    if (b) b.process = null;
    updateTrayImage();
    // Don't auto-relaunch something we killed on purpose (Stop button, or a
    // restart like switching device model) — only unexpected exits retry.
    if (!wasIntentional) scheduleRetry(deviceId, deviceDir);
  });
}

function killBackend(deviceId) {
  return new Promise((resolve) => {
    const backend = backends.get(deviceId);
    if (backend?.retryTimeout) {
      clearTimeout(backend.retryTimeout);
    }
    const proc = backend?.process;
    backends.delete(deviceId);
    updateTrayImage();
    if (!proc?.pid) { resolve(); return; }
    intentionalKills.add(proc.pid);
    treeKill(proc.pid, () => resolve());
  });
}

async function killAllBackends() {
  const ids = [...backends.keys()];
  await Promise.all(ids.map((id) => killBackend(id)));
  // Synchronous fallback: force-kill any instances that slipped through
  platform.forceKillAllBackends();
}

function getBackendProcess(deviceId) {
  return backends.get(deviceId)?.process || null;
}

/** Writes `command` to the backend's stdin and waits (max 2s) for the stdout handler to resolve it via `pending`. */
function requestFromBackend(deviceId, command, pending, fallback) {
  return new Promise((resolve) => {
    pending.set(deviceId, resolve);
    if (!sendBackendCommand(deviceId, command)) {
      pending.delete(deviceId);
      resolve(fallback);
      return;
    }
    setTimeout(() => {
      if (pending.get(deviceId) === resolve) {
        pending.delete(deviceId);
        resolve(fallback);
      }
    }, 2000);
  });
}

function requestAudioSessions(deviceId) {
  return requestFromBackend(deviceId, 'LIST_SESSIONS', sessionRequests, []);
}

/** Resolves { devices: [{ id, name }], default: id|null } — empty if the backend isn't running (Pro only). */
function requestOutputDevices(deviceId) {
  return requestFromBackend(deviceId, 'LIST_OUTPUTS', outputRequests, { devices: [], default: null });
}

/** Writes one stdin command line to the device's backend. Returns false if it isn't running. */
function sendBackendCommand(deviceId, line) {
  const proc = backends.get(deviceId)?.process;
  if (!proc || typeof line !== 'string' || /[\r\n]/.test(line)) return false;
  try {
    proc.stdin.write(`${line}\n`);
    return true;
  } catch {
    return false;
  }
}

function setOutputDevice(deviceId, outputId) {
  if (typeof outputId !== 'string' || !outputId) return false;
  return sendBackendCommand(deviceId, `SET_OUTPUT:${outputId}`);
}

module.exports = {
  startBackend,
  killBackend,
  killAllBackends,
  getBackendProcess,
  requestAudioSessions,
  requestOutputDevices,
  setOutputDevice,
  sendBackendCommand,
};
