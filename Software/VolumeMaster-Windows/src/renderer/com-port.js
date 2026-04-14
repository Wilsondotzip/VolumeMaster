import { state } from './state.js';

export async function refreshComPortListPreservingSelection() {
  const select = document.getElementById('comPortSelect');
  if (!select) return;

  const selectedValue = select.value;
  const [ports, savedPort] = await Promise.all([
    window.api.listSerialPorts(),
    window.api.getComPort(),
  ]);

  select.innerHTML = '';

  if (!ports || ports.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No ports found';
    opt.disabled = true;
    select.appendChild(opt);
    return;
  }

  let effectivePort = null;

  if (ports.some((p) => p.path === savedPort)) {
    effectivePort = savedPort;
  } else if (ports.some((p) => p.path === selectedValue)) {
    effectivePort = selectedValue;
  } else {
    effectivePort = ports[0].path;
    await window.api.setComPort(effectivePort);
    console.log('[COM port fallback]', effectivePort);
  }

  if (effectivePort && state.config && typeof state.config === 'object') {
    state.config.comport = effectivePort;
  }

  ports.forEach((port) => {
    const opt = document.createElement('option');
    opt.value = port.path;
    opt.textContent = `${port.path}${port.manufacturer ? ` (${port.manufacturer})` : ''}`;
    if (port.path === effectivePort) opt.selected = true;
    select.appendChild(opt);
  });
}

export function setupComPortListeners() {
  document.getElementById('comPortSelect')?.addEventListener('change', async (e) => {
    const newPort = e.target.value;
    await window.api.setComPort(newPort);
    if (state.config && typeof state.config === 'object') {
      state.config.comport = newPort;
    }
    console.log('[Renderer] COM port updated to:', newPort);
  });

  document.getElementById('comPortSelect')?.addEventListener('focus', () => {
    refreshComPortListPreservingSelection();
  });
}
