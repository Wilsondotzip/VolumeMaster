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

// Plugin sections collapsed by the user this session (not persisted — resets on restart).
const collapsedPlugins = new Set();

function createChevronIcon(collapsed) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('shrink-0');
  svg.style.transition = 'transform 120ms ease';
  svg.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  svg.appendChild(path);
  return svg;
}

function createPluginActionCard(plugin, action) {
  const dragName = pluginDragName(plugin.pluginId, action.id);

  const card = document.createElement('div');
  card.className =
    'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-move hover:bg-cyan-700 hover:border-cyan-500 transition group';
  card.setAttribute('draggable', 'true');

  const iconEl = document.createElement('div');
  iconEl.className =
    'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-cyan-600 flex items-center justify-center text-lg shrink-0 transition';
  iconEl.textContent = '🔌';

  const labelEl = document.createElement('div');
  labelEl.className =
    'text-sm text-indigo-200 group-hover:text-white truncate transition font-medium min-w-0 flex-1';
  labelEl.textContent = action.label;

  card.append(iconEl, labelEl);

  if (action.kind === 'knob' || action.kind === 'button') {
    const badge = document.createElement('span');
    badge.className =
      'shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-300 bg-amber-900 bg-opacity-40 border border-amber-700 rounded px-1.5 py-0.5';
    badge.textContent = action.kind === 'knob' ? 'Knob only' : 'Button only';
    card.appendChild(badge);
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

function createGroupHeader(label) {
  const header = document.createElement('div');
  header.className = 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 pl-1 mt-1';
  header.textContent = label;
  return header;
}

/** One plugin's cards, collapsible, with its own actions clustered by their optional `group`. */
function createPluginSection(plugin) {
  const section = document.createElement('div');
  section.className = 'flex flex-col gap-1';

  const collapsed = collapsedPlugins.has(plugin.pluginId);

  const header = document.createElement('button');
  header.type = 'button';
  header.className =
    'flex items-center gap-2 px-1 py-1 text-xs font-semibold text-slate-300 hover:text-white transition text-left';

  const chevron = createChevronIcon(collapsed);
  const nameEl = document.createElement('span');
  nameEl.className = 'truncate';
  nameEl.textContent = plugin.name;
  const countEl = document.createElement('span');
  countEl.className = 'text-slate-500 font-normal shrink-0';
  countEl.textContent = `(${plugin.actions.length})`;
  header.append(chevron, nameEl, countEl);

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-1 pl-2';
  body.classList.toggle('hidden', collapsed);

  header.onclick = () => {
    const nowCollapsed = !body.classList.contains('hidden');
    body.classList.toggle('hidden', nowCollapsed);
    chevron.style.transform = nowCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    if (nowCollapsed) collapsedPlugins.add(plugin.pluginId);
    else collapsedPlugins.delete(plugin.pluginId);
  };

  // Ungrouped actions render flat first, in their original order; named groups
  // (in first-seen order) get a small header of their own beneath those.
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

  for (const action of ungrouped) {
    body.appendChild(createPluginActionCard(plugin, action));
  }
  for (const [groupName, actions] of groups) {
    body.appendChild(createGroupHeader(groupName));
    for (const action of actions) {
      body.appendChild(createPluginActionCard(plugin, action));
    }
  }

  section.append(header, body);
  return section;
}

export function renderPluginActionList() {
  const list = document.getElementById('pluginActionList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);

  if (!state.pluginActions.length) {
    const msg = document.createElement('p');
    msg.className = 'text-xs text-slate-500 italic px-1 pt-1';
    msg.textContent = 'No plugins connected. Connect a plugin via WebSocket on port 59284.';
    list.appendChild(msg);
    return;
  }

  for (const plugin of state.pluginActions) {
    list.appendChild(createPluginSection(plugin));
  }
}
