const path = require('path');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');

const { setTrayImageNormal, setTrayImageCrashed } = require('./tray');
const deviceManager = require('./device-manager');
const { handleVolumeChange } = require('./notification-window');

const headlessExePath = path.join(process.resourcesPath, 'VolumeMaster-Headless.exe');

// Map<deviceId, { process, retryTimeout }>
const backends = new Map();

function sendStatusToDevice(deviceId, type, message) {
  const win = deviceManager.getWindowForDevice(deviceId);
  if (win) win.webContents.send('backend-status', { type, message });
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
  const proc = spawn(headlessExePath, [], {
    detached: false,
    stdio: 'pipe',
    shell: false,
    cwd: deviceDir,
  });

  const existing = backends.get(deviceId);
  backends.set(deviceId, { process: proc, retryTimeout: existing?.retryTimeout || null });
  updateTrayImage();
  sendStatusToDevice(deviceId, 'success', 'Backend started successfully.');

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
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
      } else if (trimmed.startsWith('VOLUME:')) {
        const parts = trimmed.split(':');
        if (parts.length === 3) {
          const index = parseInt(parts[1], 10);
          const value = parseInt(parts[2], 10);
          const win = deviceManager.getWindowForDevice(deviceId);
          if (win) win.webContents.send('volume-update', { index, value });
          handleVolumeChange(deviceId, deviceDir, index, value);
        }
      } else {
        sendStatusToDevice(deviceId, 'info', `[Backend] ${trimmed}`);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`[${deviceId}] stderr: ${data}`);
    sendStatusToDevice(deviceId, 'error', `[Backend stderr] ${data}`);
    const b = backends.get(deviceId);
    if (b) b.process = null;
    updateTrayImage();
    scheduleRetry(deviceId, deviceDir);
  });

  proc.on('error', (err) => {
    console.error(`[${deviceId}] error:`, err);
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
    const message = code === 1
      ? 'Backend stopped. Check banners above for details.'
      : `Backend exited unexpectedly (code ${code}). Antivirus may have intervened.`;
    sendStatusToDevice(deviceId, 'warning', message);
    const b = backends.get(deviceId);
    if (b) b.process = null;
    updateTrayImage();
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
    treeKill(proc.pid, () => resolve());
  });
}

async function killAllBackends() {
  const ids = [...backends.keys()];
  await Promise.all(ids.map((id) => killBackend(id)));
  // Synchronous fallback: force-kill any instances that slipped through
  try {
    require('child_process').execSync('taskkill /F /IM VolumeMaster-Headless.exe', { stdio: 'ignore' });
  } catch {
    // Throws if no processes found — that's fine
  }
}

function getBackendProcess(deviceId) {
  return backends.get(deviceId)?.process || null;
}

module.exports = {
  startBackend,
  killBackend,
  killAllBackends,
  getBackendProcess,
};
