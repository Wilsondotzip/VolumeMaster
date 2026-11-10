import { state } from './state.js';

export const PLUGIN_PREFIX = 'plugin:';

export function isPluginItem(name) {
  return typeof name === 'string' && name.startsWith(PLUGIN_PREFIX);
}

/** Split "plugin:obs-controller:switch-scene" into { pluginId, actionId }. */
export function pluginItemParts(dragName) {
  const inner = dragName.slice(PLUGIN_PREFIX.length);
  const colonIdx = inner.indexOf(':');
  if (colonIdx === -1) return { pluginId: inner, actionId: '' };
  return { pluginId: inner.slice(0, colonIdx), actionId: inner.slice(colonIdx + 1) };
}

/** Config storage form: "obs-controller:switch-scene" (no prefix). */
export function pluginActionKey(pluginId, actionId) {
  return `${pluginId}:${actionId}`;
}

/** Full drag name: "plugin:obs-controller:switch-scene". */
export function pluginDragName(pluginId, actionId) {
  return `${PLUGIN_PREFIX}${pluginId}:${actionId}`;
}

export function getPluginAction(pluginId, actionId) {
  const plugin = state.pluginActions.find((p) => p.pluginId === pluginId);
  return plugin?.actions.find((a) => a.id === actionId) || null;
}

/**
 * True unless the action declared a 'knob'/'button' kind that excludes this context.
 * An action whose plugin is offline (not found) is allowed, deferring to whatever
 * was already saved rather than blocking on a lookup that can't succeed.
 */
export function pluginActionAllowsKind(pluginId, actionId, context) {
  const action = getPluginAction(pluginId, actionId);
  if (!action) return true;
  return !action.kind || action.kind === context;
}

/** Whether the plugin action currently mid-drag (if any) may be dropped in this context. */
export function isPluginDragAllowedFor(context) {
  const name = state.mappingDragPayload?.name;
  if (!isPluginItem(name)) return false;
  const { pluginId, actionId } = pluginItemParts(name);
  return pluginActionAllowsKind(pluginId, actionId, context);
}

// ── Plugin browser ───────────────────────────────────────────────────────────
//
// Three levels, each a list of cards:
//   plugins  →  one plugin's actions (and its group cards)  →  one group's actions
// Kept for the session so a re-render (plugin re-registers, a mapping changes)
// leaves you where you were.
const nav = { pluginId: null, group: null };

function svgIcon(d, size = 14) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('shrink-0');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

const CHEVRON_RIGHT = 'M9 6l6 6-6 6';
const CHEVRON_LEFT = 'M15 6l-6 6 6 6';

function knobName(knobId) {
  const name = state.config.Mappings?.[knobId]?.Name;
  return name && name.trim() ? name.trim() : `Knob ${knobId}`;
}

/** Map<'pluginId:actionId', [{ knobId, button }]> — where each plugin action is mapped. */
function pluginActionUsage() {
  const usage = new Map();
  const add = (key, knobId, button) => {
    if (typeof key !== 'string') return;
    if (!usage.has(key)) usage.set(key, []);
    usage.get(key).push({ knobId, button });
  };
  for (const [knobId, mapping] of Object.entries(state.config.Mappings || {})) {
    for (const key of mapping?.PluginActions || []) add(key, knobId, false);
    for (const entry of mapping?.ButtonActions || []) {
      if (typeof entry === 'string') add(entry, knobId, true);
      else if (entry?.kind === 'plugin') add(entry.key, knobId, true);
    }
  }
  return usage;
}

function usageText(use) {
  return `${knobName(use.knobId)}${use.button ? ' · press' : ''}`;
}

/** Number of a plugin's actions (optionally only those passing `filter`) mapped somewhere. */
function countInUse(usage, pluginId, actionIds) {
  return actionIds.filter((id) => usage.has(pluginActionKey(pluginId, id))).length;
}

function describe(actionCount, inUse, offline = false) {
  const parts = [];
  if (offline) parts.push('Offline');
  else parts.push(`${actionCount} action${actionCount === 1 ? '' : 's'}`);
  if (inUse > 0) parts.push(`${inUse} in use`);
  return parts.join(' · ');
}

/** A card that opens a page (a plugin or a group): not draggable, chevron on the right. */
function createNavCard({ icon, title, subtitle, offline = false, onOpen }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className =
    'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-pointer hover:bg-slate-600 hover:border-cyan-500 transition group text-left w-full';
  if (offline) card.classList.add('opacity-60');

  const iconEl = document.createElement('div');
  iconEl.className =
    'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-cyan-700 flex items-center justify-center text-lg shrink-0 transition';
  iconEl.textContent = icon;

  const textWrap = document.createElement('div');
  textWrap.className = 'flex flex-col min-w-0 flex-1';
  const titleEl = document.createElement('div');
  titleEl.className = 'text-sm text-indigo-200 group-hover:text-white truncate transition font-medium';
  titleEl.textContent = title;
  const subEl = document.createElement('div');
  subEl.className = 'text-xs text-slate-400 truncate';
  subEl.textContent = subtitle;
  textWrap.append(titleEl, subEl);

  const chevron = svgIcon(CHEVRON_RIGHT);
  chevron.classList.add('text-slate-500', 'group-hover:text-white', 'transition');

  card.append(iconEl, textWrap, chevron);
  card.onclick = onOpen;
  return card;
}

function createBadge(text, classes) {
  const badge = document.createElement('span');
  badge.className = `shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 border ${classes}`;
  badge.textContent = text;
  return badge;
}

/** Draggable action card, with where it's already mapped. */
function createPluginActionCard(pluginId, action, uses) {
  const dragName = pluginDragName(pluginId, action.id);

  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-move hover:bg-cyan-700 hover:border-cyan-500 transition group';
  card.setAttribute('draggable', 'true');

  const iconEl = document.createElement('div');
  iconEl.className =
    'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-cyan-600 flex items-center justify-center text-lg shrink-0 transition';
  iconEl.textContent = '🔌';

  const textWrap = document.createElement('div');
  textWrap.className = 'flex flex-col min-w-0 flex-1';
  const labelEl = document.createElement('div');
  labelEl.className = 'text-sm text-indigo-200 group-hover:text-white truncate transition font-medium';
  labelEl.textContent = action.label;
  textWrap.appendChild(labelEl);

  if (uses.length > 0) {
    const usedEl = document.createElement('div');
    usedEl.className = 'text-xs text-cyan-300 truncate';
    usedEl.textContent = `On ${uses.map(usageText).join(', ')}`;
    usedEl.title = usedEl.textContent;
    textWrap.appendChild(usedEl);
  }

  card.append(iconEl, textWrap);

  if (action.kind === 'knob' || action.kind === 'button') {
    card.appendChild(createBadge(
      action.kind === 'knob' ? 'Knob only' : 'Button only',
      'text-amber-300 bg-amber-900 bg-opacity-40 border-amber-700',
    ));
  }

  card.addEventListener('dragstart', (e) => {
    state.mappingDragActive = true;
    state.mappingDragPayload = { name: dragName };
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/plain', dragName);
    e.dataTransfer.effectAllowed = 'copy';
    card.style.opacity = '0.5';
  });
  card.addEventListener('dragend', () => {
    state.mappingDragActive = false;
    card.style.opacity = '1';
  });

  return card;
}

/** Back button + title for a plugin or group page. */
function createPageHeader({ title, crumb, onBack }) {
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 pb-2 mb-1 border-b border-slate-700';

  const back = document.createElement('button');
  back.type = 'button';
  back.title = 'Back';
  back.className =
    'w-7 h-7 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 transition shrink-0';
  back.appendChild(svgIcon(CHEVRON_LEFT, 16));
  back.onclick = onBack;

  const textWrap = document.createElement('div');
  textWrap.className = 'flex flex-col min-w-0';
  if (crumb) {
    const crumbEl = document.createElement('div');
    crumbEl.className = 'text-[10px] uppercase tracking-wide text-slate-500 truncate';
    crumbEl.textContent = crumb;
    textWrap.appendChild(crumbEl);
  }
  const titleEl = document.createElement('div');
  titleEl.className = 'text-sm font-semibold text-slate-200 truncate';
  titleEl.textContent = title;
  textWrap.appendChild(titleEl);

  header.append(back, textWrap);
  return header;
}

function createNote(text) {
  const msg = document.createElement('p');
  msg.className = 'text-xs text-slate-500 italic px-1 pt-1';
  msg.textContent = text;
  return msg;
}

/** Plugins that aren't connected but still have actions mapped: { pluginId: [actionId] }. */
function offlinePlugins(usage) {
  const connected = new Set(state.pluginActions.map((p) => p.pluginId));
  const offline = new Map();
  for (const key of usage.keys()) {
    const colonIdx = key.indexOf(':');
    if (colonIdx === -1) continue;
    const pluginId = key.slice(0, colonIdx);
    if (connected.has(pluginId)) continue;
    if (!offline.has(pluginId)) offline.set(pluginId, []);
    offline.get(pluginId).push(key.slice(colonIdx + 1));
  }
  return offline;
}

function openPage(pluginId, group = null) {
  nav.pluginId = pluginId;
  nav.group = group;
  renderPluginActionList({ resetScroll: true });
}

function goBack() {
  if (nav.group) openPage(nav.pluginId, null);
  else openPage(null, null);
}

function renderPluginCards(list, usage) {
  const offline = offlinePlugins(usage);
  if (!state.pluginActions.length && !offline.size) {
    list.appendChild(createNote('No plugins connected. Connect a plugin via WebSocket on port 59284.'));
    return;
  }

  for (const plugin of state.pluginActions) {
    const inUse = countInUse(usage, plugin.pluginId, plugin.actions.map((a) => a.id));
    list.appendChild(createNavCard({
      icon: '🔌',
      title: plugin.name,
      subtitle: describe(plugin.actions.length, inUse),
      onOpen: () => openPage(plugin.pluginId),
    }));
  }
  for (const [pluginId, actionIds] of offline) {
    list.appendChild(createNavCard({
      icon: '🔌',
      title: pluginId,
      subtitle: describe(actionIds.length, actionIds.length, true),
      offline: true,
      onOpen: () => openPage(pluginId),
    }));
  }
}

function renderPluginPage(list, plugin, usage) {
  list.appendChild(createPageHeader({ title: plugin.name, onBack: goBack }));

  // Ungrouped actions first, then a card per group (in first-seen order).
  const ungrouped = [];
  const groups = new Map();
  for (const action of plugin.actions) {
    if (action.group) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    } else {
      ungrouped.push(action);
    }
  }

  if (!plugin.actions.length) {
    list.appendChild(createNote('This plugin has no actions right now.'));
  }
  for (const action of ungrouped) {
    list.appendChild(createPluginActionCard(plugin.pluginId, action, usage.get(pluginActionKey(plugin.pluginId, action.id)) || []));
  }
  for (const [groupName, actions] of groups) {
    const inUse = countInUse(usage, plugin.pluginId, actions.map((a) => a.id));
    list.appendChild(createNavCard({
      icon: '📁',
      title: groupName,
      subtitle: describe(actions.length, inUse),
      onOpen: () => openPage(plugin.pluginId, groupName),
    }));
  }
}

function renderGroupPage(list, plugin, groupName, usage) {
  list.appendChild(createPageHeader({ title: groupName, crumb: plugin.name, onBack: goBack }));
  for (const action of plugin.actions.filter((a) => a.group === groupName)) {
    list.appendChild(createPluginActionCard(plugin.pluginId, action, usage.get(pluginActionKey(plugin.pluginId, action.id)) || []));
  }
}

function renderOfflinePage(list, pluginId, actionIds, usage) {
  list.appendChild(createPageHeader({ title: pluginId, onBack: goBack }));
  list.appendChild(createNote("This plugin isn't connected. Showing only the actions that are mapped."));
  for (const actionId of actionIds) {
    list.appendChild(createPluginActionCard(pluginId, { id: actionId, label: actionId }, usage.get(pluginActionKey(pluginId, actionId)) || []));
  }
}

let backButtonBound = false;

export function renderPluginActionList({ resetScroll = false } = {}) {
  const list = document.getElementById('pluginActionList');
  if (!list) return;

  // The mouse's back button goes up a level, like a browser.
  if (!backButtonBound) {
    backButtonBound = true;
    list.addEventListener('mouseup', (e) => {
      if (e.button === 3 && nav.pluginId) {
        e.preventDefault();
        goBack();
      }
    });
  }

  const scrollTop = list.scrollTop;
  while (list.firstChild) list.removeChild(list.firstChild);

  const usage = pluginActionUsage();
  const plugin = nav.pluginId && state.pluginActions.find((p) => p.pluginId === nav.pluginId);
  const offlineActions = nav.pluginId && !plugin ? offlinePlugins(usage).get(nav.pluginId) : null;

  // Fall back a level when what was open has gone (plugin quit, group removed).
  if (plugin && nav.group && !plugin.actions.some((a) => a.group === nav.group)) nav.group = null;
  if (nav.pluginId && !plugin && !offlineActions) {
    nav.pluginId = null;
    nav.group = null;
  }

  if (plugin && nav.group) renderGroupPage(list, plugin, nav.group, usage);
  else if (plugin) renderPluginPage(list, plugin, usage);
  else if (offlineActions) renderOfflinePage(list, nav.pluginId, offlineActions, usage);
  else renderPluginCards(list, usage);

  list.scrollTop = resetScroll ? 0 : scrollTop;
}
