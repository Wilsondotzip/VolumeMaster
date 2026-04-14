import { state } from './state.js';
import { saveConfigAndSync } from './config-sync.js';
import { sanitizeAppName } from './utils.js';
import { getVMLabel, isVMItem, vmItemId } from './voicemeeter.js';

// Live volume levels keyed by knobId string
const knobVolumes = {};

function getKnobArcPath(value) {
  if (value <= 0) return '';
  const cx = 16, cy = 16, r = 11;
  const toRad = (d) => (d * Math.PI) / 180;
  const startAngle = 225; // 7 o'clock, degrees clockwise from top
  const sweep = 270 * (value / 100);
  const endAngle = startAngle + sweep;
  const sx = cx + r * Math.sin(toRad(startAngle));
  const sy = cy - r * Math.cos(toRad(startAngle));
  const ex = cx + r * Math.sin(toRad(endAngle));
  const ey = cy - r * Math.cos(toRad(endAngle));
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export function updateKnobVolume(index, value) {
  const knobId = String(index);
  knobVolumes[knobId] = value;
  const section = document.getElementById(`knob-section-${knobId}`);
  if (!section) return;
  const arcEl = section.querySelector('[data-knob-arc]');
  const pctEl = section.querySelector('[data-knob-pct]');
  if (arcEl) arcEl.setAttribute('d', getKnobArcPath(value));
  if (pctEl) pctEl.textContent = `${value}%`;
}

/** Knob section given a highlight during drag; cleared on drop / dragend / leaving knobs area. */
let dragHighlightSection = null;

function clearDragHighlight() {
  if (dragHighlightSection) {
    dragHighlightSection.style.backgroundColor = '';
    dragHighlightSection = null;
  }
}

function knobDragTypesOk(dt) {
  if (!dt?.types) return false;
  return [...dt.types].includes('text/plain');
}

function isKnobMappingDrag(dt) {
  return state.mappingDragActive || knobDragTypesOk(dt);
}

function onKnobsDragOverCapture(e) {
  const container = document.getElementById('knobsAppsContainer');
  if (!container?.contains(e.target)) {
    clearDragHighlight();
    return;
  }
  if (!isKnobMappingDrag(e.dataTransfer)) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';

  const section = e.target.closest?.('section[id^="knob-section-"]');
  if (section && container.contains(section)) {
    if (dragHighlightSection !== section) {
      clearDragHighlight();
      dragHighlightSection = section;
      section.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
    }
  } else {
    clearDragHighlight();
  }
}

function onKnobsDropCapture(e) {
  const container = document.getElementById('knobsAppsContainer');
  if (!container?.contains(e.target)) return;
  if (!isKnobMappingDrag(e.dataTransfer)) return;

  const section = e.target.closest?.('section[id^="knob-section-"]');
  e.preventDefault();
  e.stopPropagation();
  clearDragHighlight();

  if (!section || !container.contains(section)) return;

  const knobId = section.id.replace('knob-section-', '');
  handleDrop(e, knobId);
}

let knobsDelegationInstalled = false;

function ensureKnobsDropDelegation() {
  if (knobsDelegationInstalled) return;
  const container = document.getElementById('knobsAppsContainer');
  if (!container) return;
  knobsDelegationInstalled = true;

  container.addEventListener('dragover', onKnobsDragOverCapture, true);
  container.addEventListener('drop', onKnobsDropCapture, true);

  document.addEventListener(
    'dragend',
    () => {
      state.mappingDragActive = false;
      state.mappingDragPayload = null;
      clearDragHighlight();
    },
    true
  );
}

/** Cards and empty state live here; scrolls independently per knob. */
function getKnobCardHost(sectionEl) {
  return sectionEl?.querySelector?.('[data-knob-card-host]');
}

/**
 * Scrollable regions need their own capturing dragover + preventDefault or Chromium
 * may stop treating the column as a drop target.
 */
function installKnobCardHostDnDBridge(host) {
  if (!host || host.dataset.knobDndBridge) return;
  host.dataset.knobDndBridge = '1';
  host.addEventListener(
    'dragover',
    (e) => {
      if (!isKnobMappingDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    true
  );
}

export async function renderAllKnobsAndApps() {
  const container = document.getElementById('knobsAppsContainer');
  container.innerHTML = '';

  const knobIds = Object.keys(state.config.Mappings);
  if (knobIds.length === 0) {
    container.textContent = 'No knobs configured.';
    container.className = 'text-gray-400';
    return;
  }

  ensureKnobsDropDelegation();

  container.className =
    'custom-scroll flex min-h-0 w-full flex-row flex-nowrap gap-3 overflow-x-auto overflow-y-hidden pb-2 mt-3 mb-3 grow items-stretch';

  for (const knobId of knobIds) {
    const section = createKnobSection(knobId);
    container.appendChild(section);
  }
}

function createKnobSection(knobId) {
  const section = document.createElement('section');
  section.id = `knob-section-${knobId}`;
  // One row of equal columns (all knobs visible); vertical scroll only inside the card host.
  section.className =
    'bg-slate-800 rounded-lg shadow p-3 flex min-h-0 min-w-0 flex-1 flex-col border border-slate-700';

  section.appendChild(createKnobHeader(knobId));
  section.appendChild(createMasterVolumeButton(knobId));

  const cardHost = document.createElement('div');
  cardHost.setAttribute('data-knob-card-host', '');
  cardHost.className = 'custom-scroll flex min-h-0 flex-1 flex-col overflow-y-auto';
  cardHost.style.overscrollBehavior = 'contain';
  installKnobCardHostDnDBridge(cardHost);

  const processNames = state.config.Mappings[knobId]?.ProcessNames || [];
  const micNames = state.config.Mappings[knobId]?.MicNames || [];
  const vmTargets = state.config.Mappings[knobId]?.VoiceMeeter || [];
  const apps = [...processNames, ...micNames];

  const version = state.config.vmversion || 'banana';
  const hasAny = apps.length > 0 || vmTargets.length > 0;

  if (!hasAny) {
    cardHost.appendChild(createEmptyMessage());
  } else {
    apps.forEach((app) => {
      if (app === 'master') {
        cardHost.appendChild(createVolumeCard(knobId, '🔊', 'Master Volume'));
      } else if (state.inputDevices.includes(app)) {
        cardHost.appendChild(createInputDeviceCard(app, knobId));
      } else {
        cardHost.appendChild(createAppCard(app, knobId));
      }
    });
    vmTargets.forEach((vmId) => {
      cardHost.appendChild(createVMCard(vmId, getVMLabel(vmId, version), knobId));
    });
  }

  section.appendChild(cardHost);
  return section;
}

function createMasterVolumeButton(knobId) {
  const button = document.createElement('button');
  const apps = state.config.Mappings[knobId]?.ProcessNames || [];
  const hasMasterVolume = apps.includes('master');

  button.textContent = 'Add Master Volume';
  button.setAttribute('data-action', 'add-master');
  button.type = 'button';
  button.className =
    'w-full mb-3 py-2 px-3 text-sm font-medium rounded transition bg-indigo-600 hover:bg-indigo-700 text-white';

  if (hasMasterVolume) {
    button.style.display = 'none';
  }

  button.onclick = async () => {
    await addMasterVolume(knobId);
  };

  return button;
}

function createVolumeCard(knobId, iconText, labelTest) {
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-4 mb-3 p-3 rounded border border-indigo-400 bg-indigo-900 bg-opacity-30 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-appname', 'master');

  const icon = document.createElement('div');
  icon.className =
    'w-10 h-10 rounded bg-indigo-500 flex items-center justify-center text-white font-bold text-lg';
  icon.textContent = iconText;

  const label = document.createElement('div');
  label.textContent = labelTest;
  label.className = 'text-lg font-medium text-indigo-300';

  card.append(icon, label);

  card.onclick = async () => {
    await removeAppFromKnob(knobId, 'master');
    card.remove();
  };

  return card;
}

async function addMasterVolume(knobId) {
  try {
    if (!state.config.Mappings[knobId]) {
      state.config.Mappings[knobId] = { ProcessNames: [] };
    }

    const mapping = state.config.Mappings[knobId];

    if (!Array.isArray(mapping.ProcessNames)) {
      mapping.ProcessNames = [];
    }

    if (mapping.ProcessNames.includes('master')) {
      console.warn(`[addMasterVolume] Master volume already exists for knob ${knobId}`);
      return;
    }

    mapping.ProcessNames.push('master');
    window._autoSaveActivePreset?.();

    const knobSection = document.getElementById(`knob-section-${knobId}`);
    if (!knobSection) {
      console.warn(`[addMasterVolume] No section found for knob ${knobId}`);
      return;
    }

    const button = knobSection.querySelector('[data-action="add-master"]');
    if (button) {
      button.style.display = 'none';
    }

    const cardHost = getKnobCardHost(knobSection);
    const emptyMsg = cardHost?.querySelector('p');
    if (emptyMsg?.textContent === 'No apps mapped.') {
      emptyMsg.remove();
    }

    const masterVolumeCard = createVolumeCard(knobId, '🔊', 'Master Volume');
    if (cardHost) {
      cardHost.appendChild(masterVolumeCard);
    } else {
      knobSection.appendChild(masterVolumeCard);
    }

    await saveConfigAndSync();
  } catch (err) {
    console.error('[addMasterVolume] Error:', err);
  }
}

function createKnobHeader(knobId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-center gap-2 mb-3';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '38');
  svg.setAttribute('height', '38');
  svg.style.flexShrink = '0';

  // Background track arc (270°, from 7 o'clock to 5 o'clock clockwise)
  const bgArc = document.createElementNS(svgNS, 'path');
  bgArc.setAttribute('d', 'M 8.22 23.78 A 11 11 0 1 1 23.78 23.78');
  bgArc.setAttribute('fill', 'none');
  bgArc.setAttribute('stroke', '#334155');
  bgArc.setAttribute('stroke-width', '3');
  bgArc.setAttribute('stroke-linecap', 'round');

  // Value arc (filled portion)
  const valArc = document.createElementNS(svgNS, 'path');
  const initValue = knobVolumes[knobId] ?? 0;
  valArc.setAttribute('d', getKnobArcPath(initValue));
  valArc.setAttribute('fill', 'none');
  valArc.setAttribute('stroke', '#818cf8');
  valArc.setAttribute('stroke-width', '3');
  valArc.setAttribute('stroke-linecap', 'round');
  valArc.setAttribute('data-knob-arc', '');

  svg.append(bgArc, valArc);

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const header = document.createElement('h2');
  header.textContent = `Knob ${knobId}`;
  header.className = 'text-indigo-400 text-base font-bold leading-tight';

  const pct = document.createElement('span');
  pct.textContent = `${initValue}%`;
  pct.className = 'text-slate-500 text-xs';
  pct.setAttribute('data-knob-pct', '');

  textCol.append(header, pct);
  wrapper.append(svg, textCol);
  return wrapper;
}

function createEmptyMessage() {
  const msg = document.createElement('p');
  msg.textContent = 'No apps mapped.';
  msg.className = 'text-slate-400 italic';
  return msg;
}

function createAppCard(app, knobId) {
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-4 mb-3 p-3 rounded border border-gray-300 hover:bg-red-100 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-appname', app);

  const icon = document.createElement('img');
  icon.alt = app;
  icon.className = 'w-10 h-10 rounded sm:hidden md:block';
  icon.draggable = false;
  card.classList.add('app-card');

  const label = document.createElement('div');
  label.textContent = sanitizeAppName(app);
  label.className = 'text-lg font-medium shrink capitalize text-wrap';

  card.append(icon, label);

  card.onclick = async () => {
    await removeAppFromKnob(knobId, app);
    card.remove();
  };

  if (state.iconCache.has(app)) {
    icon.src = state.iconCache.get(app);
  } else {
    getAppIconForApp(app)
      .then((src) => {
        const finalSrc = src || 'assets/icons/default.png';
        state.iconCache.set(app, finalSrc);
        icon.src = finalSrc;
      })
      .catch(() => {
        icon.src = 'assets/icons/default.png';
      });
  }

  return card;
}

function readDroppedMappingName(dataTransfer) {
  let name = '';
  try {
    name = dataTransfer?.getData('text/plain') || '';
  } catch (err) {
    console.error('[handleDrop] Failed to read dropped data:', err);
  }
  if (!name && state.mappingDragPayload?.name) {
    name = state.mappingDragPayload.name;
  }
  return name.trim();
}

async function handleDrop(event, knobId) {
  event.preventDefault();
  event.stopPropagation();

  if (!knobId) {
    console.warn('[handleDrop] knobId is undefined or invalid');
    return;
  }

  const droppedApp = readDroppedMappingName(event.dataTransfer);
  state.mappingDragPayload = null;

  if (!droppedApp) {
    console.warn('[handleDrop] No app data found in drop');
    return;
  }

  // --- Update config ---------------------------------------------------------
  let configUpdated = false;
  try {
    if (!state.config.Mappings[knobId]) {
      state.config.Mappings[knobId] = { ProcessNames: [], MicNames: [] };
    }

    const mapping = state.config.Mappings[knobId];
    const isInputDevice = state.inputDevices.includes(droppedApp);
    const isVM = isVMItem(droppedApp);

    if (droppedApp === 'master') {
      console.warn(`[handleDrop] Cannot drop 'master' - use Add Master Volume button`);
      return;
    }

    if (isVM) {
      const vmId = vmItemId(droppedApp);
      if (!Array.isArray(mapping.VoiceMeeter)) mapping.VoiceMeeter = [];
      if (mapping.VoiceMeeter.includes(vmId)) {
        console.warn(`[handleDrop] "${vmId}" already mapped to knob ${knobId}`);
        return;
      }
      mapping.VoiceMeeter.push(vmId);
      configUpdated = true;
    } else if (isInputDevice) {
      if (!Array.isArray(mapping.MicNames)) mapping.MicNames = [];
      if (mapping.MicNames.includes(droppedApp)) {
        console.warn(`[handleDrop] "${droppedApp}" already mapped to knob ${knobId}`);
        return;
      }
      mapping.MicNames.push(droppedApp);
      configUpdated = true;
    } else {
      if (!Array.isArray(mapping.ProcessNames)) mapping.ProcessNames = [];
      if (mapping.ProcessNames.includes(droppedApp)) {
        console.warn(`[handleDrop] "${droppedApp}" already mapped to knob ${knobId}`);
        return;
      }
      mapping.ProcessNames.push(droppedApp);
      configUpdated = true;
    }
  } catch (err) {
    console.error('[handleDrop] Error updating config:', err);
    return;
  }

  // Save immediately after mutating config, before any DOM work that might
  // return early.  This ensures the file is never left behind the in-memory
  // state regardless of what happens in the DOM update block below.
  if (configUpdated) {
    saveConfigAndSync().catch((err) => {
      console.error('[handleDrop] Failed to save config:', err);
    });
    window._autoSaveActivePreset?.();
  }

  // --- Update DOM ------------------------------------------------------------
  try {
    const knobSection = document.getElementById(`knob-section-${knobId}`);
    if (!knobSection) {
      console.warn(`[handleDrop] No section found for knob ${knobId}`);
      return;
    }

    const cardHost = getKnobCardHost(knobSection);
    if (!cardHost) {
      console.warn(`[handleDrop] No card host for knob ${knobId}`);
      return;
    }

    const existingCard = cardHost.querySelector(`[data-appname="${CSS.escape(droppedApp)}"]`);
    if (existingCard) {
      // Config was already saved above; DOM is already showing the card.
      return;
    }

    const emptyMsg = cardHost.querySelector('p');
    if (emptyMsg?.textContent === 'No apps mapped.') {
      emptyMsg.remove();
    }

    const isVM = isVMItem(droppedApp);
    let card;
    if (isVM) {
      const vmId = vmItemId(droppedApp);
      const version = state.config.vmversion || 'banana';
      card = createVMCard(vmId, getVMLabel(vmId, version), knobId);
    } else if (state.inputDevices.includes(droppedApp)) {
      card = createInputDeviceCard(droppedApp, knobId);
    } else {
      card = createAppCard(droppedApp, knobId);
    }
    cardHost.appendChild(card);
  } catch (err) {
    console.error('[handleDrop] Error updating UI:', err);
  }
}

async function getAppIconForApp(app) {
  if (!app) return 'assets/icons/default.png';

  const userPath = state.config.exePaths?.[app.toLowerCase()];
  if (userPath) {
    const icon = await window.api.getAppIcon(userPath);
    if (icon) return icon;
  }

  const fallback = await window.api.getAppIcon(app);
  return fallback || 'assets/icons/default.png';
}

function mappingHasAnyTargets(mapping) {
  const pn = mapping.ProcessNames?.length ?? 0;
  const mn = mapping.MicNames?.length ?? 0;
  const vm = mapping.VoiceMeeter?.length ?? 0;
  return pn > 0 || mn > 0 || vm > 0;
}

async function removeAppFromKnob(knobId, appName) {
  const mapping = state.config.Mappings[knobId];
  if (!mapping) return;

  let list;
  if (isVMItem(appName)) {
    const vmId = vmItemId(appName);
    if (!Array.isArray(mapping.VoiceMeeter)) return;
    const idx = mapping.VoiceMeeter.indexOf(vmId);
    if (idx === -1) return;
    mapping.VoiceMeeter.splice(idx, 1);
    await saveConfigAndSync();
    window._autoSaveActivePreset?.();
    const knobSection = document.getElementById(`knob-section-${knobId}`);
    const cardHost = getKnobCardHost(knobSection);
    const searchRoot = cardHost || knobSection;
    if (!mappingHasAnyTargets(mapping)) {
      const hasEmptyMsg = [...searchRoot.querySelectorAll('p')].some(p => p.textContent === 'No apps mapped.');
      if (!hasEmptyMsg && cardHost) cardHost.appendChild(createEmptyMessage());
    }
    return;
  }

  const isInputDevice = state.inputDevices.includes(appName);
  list = isInputDevice ? mapping.MicNames : mapping.ProcessNames;

  if (!Array.isArray(list)) return;
  const idx = list.indexOf(appName);
  if (idx === -1) return;

  list.splice(idx, 1);
  await saveConfigAndSync();
  window._autoSaveActivePreset?.();

  try {
    const knobSection = document.getElementById(`knob-section-${knobId}`);
    if (!knobSection) {
      console.warn(`[removeAppFromKnob] No section for knob ${knobId}`);
      return;
    }

    const cardHost = getKnobCardHost(knobSection);
    const searchRoot = cardHost || knobSection;
    const card = searchRoot.querySelector(`[data-appname="${CSS.escape(appName)}"]`);
    if (card) {
      card.remove();
    }

    if (appName === 'master') {
      const button = knobSection.querySelector('[data-action="add-master"]');
      if (button) {
        button.style.display = 'block';
      }
    }

    if (!mappingHasAnyTargets(mapping)) {
      const hasEmptyMsg = [...searchRoot.querySelectorAll('p')].some(
        (p) => p.textContent === 'No apps mapped.'
      );
      if (!hasEmptyMsg && cardHost) {
        cardHost.appendChild(createEmptyMessage());
      }
    }
  } catch (err) {
    console.error('[removeAppFromKnob] UI update failed:', err);
  }
}

function createInputDeviceCard(name, knobId) {
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-4 mb-3 p-3 rounded border border-gray-300 hover:bg-red-100 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-appname', name);

  const icon = document.createElement('div');
  icon.className = 'w-10 h-10 rounded bg-slate-600 flex items-center justify-center text-xl';
  icon.textContent = '🎤';

  const label = document.createElement('div');
  label.textContent = name;
  label.className = 'text-lg font-medium shrink capitalize text-wrap';

  card.append(icon, label);

  card.onclick = async () => {
    await removeAppFromKnob(knobId, name);
    card.remove();
  };

  return card;
}

function createVMCard(vmId, label, knobId) {
  const dragName = `vm:${vmId}`;
  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 mb-3 p-3 rounded border border-purple-600 bg-purple-900 bg-opacity-30 hover:bg-red-900 hover:bg-opacity-30 hover:border-red-500 cursor-pointer transition overflow-hidden';
  card.setAttribute('data-appname', dragName);

  const icon = document.createElement('div');
  icon.className = 'w-10 h-10 rounded bg-purple-700 flex items-center justify-center text-white font-bold text-sm shrink-0';
  icon.textContent = vmId.startsWith('Input') ? 'IN' : 'OUT';

  const textCol = document.createElement('div');
  textCol.className = 'flex flex-col min-w-0';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.className = 'text-sm font-semibold text-purple-300';

  const sub = document.createElement('div');
  sub.textContent = 'VoiceMeeter';
  sub.className = 'text-xs text-slate-500';

  textCol.append(labelEl, sub);
  card.append(icon, textCol);

  card.onclick = async () => {
    await removeAppFromKnob(knobId, dragName);
    card.remove();
  };

  return card;
}
