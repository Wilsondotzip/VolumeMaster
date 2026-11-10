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

// Square tiles in a grid: the panel is wide and short, so a list shows only a
// couple of rows while a grid fits a whole group at a glance.
const TILE =
  'relative size-[6.25rem] p-1.5 flex flex-col items-center justify-center gap-1 rounded-lg border bg-slate-700 transition group text-center';
const TILE_ICON = 'text-[1.6rem] leading-none mb-0.5';
const TILE_TITLE = 'text-xs font-medium leading-tight text-indigo-200 group-hover:text-white w-full break-words line-clamp-2';
const TILE_SUB = 'text-[10px] truncate w-full';

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Corner badge: how many of a plugin's or group's actions are mapped. */
function createInUseBadge(count) {
  const badge = document.createElement('span');
  badge.className =
    'absolute top-1 right-1 px-1.5 leading-4 rounded-full bg-cyan-700 text-white text-[10px] font-semibold';
  badge.textContent = String(count);
  badge.title = `${count} in use`;
  return badge;
}

/** A tile that opens a page (a plugin or a group). Groups get a stacked edge, like a folder of cards. */
function createNavCard({ icon, title, subtitle, inUse = 0, offline = false, stacked = false, onOpen }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `${TILE} border-slate-600 cursor-pointer hover:bg-slate-600 hover:border-cyan-500`;
  if (stacked) card.classList.add('shadow-[3px_3px_0_-1px_#334155,3px_3px_0_0_#475569]');
  if (offline) card.classList.add('opacity-60');
  card.title = title;

  const iconEl = document.createElement('div');
  iconEl.className = TILE_ICON;
  iconEl.textContent = icon;
  const titleEl = document.createElement('div');
  titleEl.className = TILE_TITLE;
  titleEl.textContent = title;
  const subEl = document.createElement('div');
  subEl.className = `${TILE_SUB} text-slate-400`;
  subEl.textContent = subtitle;

  card.append(iconEl, titleEl, subEl);
  if (inUse > 0) card.appendChild(createInUseBadge(inUse));
  card.onclick = onOpen;
  return card;
}

/** A stable hue (0–359) per plugin, so each one keeps its colour everywhere. */
function pluginHue(pluginId) {
  let hash = 0;
  for (const ch of pluginId) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

/** "Home Assistant" → "HA", "discord-volume" → "DV", "Spotify" → "SP". */
function pluginInitials(name) {
  const words = name.split(/[\s\-_.]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || '?').slice(0, 2).toUpperCase();
}

/** Plugin tile: coloured monogram with a connected/offline dot, tinted to match. */
function createPluginTile({ pluginId, name, subtitle, inUse, offline = false, onOpen }) {
  const hue = pluginHue(pluginId);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = `${TILE} border-slate-600 cursor-pointer hover:bg-slate-600 hover:border-cyan-500 hover:-translate-y-0.5`;
  card.style.backgroundImage = `linear-gradient(to bottom, hsl(${hue} 70% 50% / ${offline ? 0.06 : 0.16}), transparent 65%)`;
  card.title = offline ? `${name} (not connected)` : name;

  const avatar = document.createElement('div');
  avatar.className =
    'relative w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white tracking-wide shadow-md mb-0.5 transition group-hover:scale-105';
  avatar.style.background = offline
    ? 'linear-gradient(135deg, #64748b, #475569)'
    : `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 35) % 360} 60% 38%))`;
  avatar.textContent = pluginInitials(name);

  const dot = document.createElement('span');
  dot.className = `absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-700 ${offline ? 'bg-slate-400' : 'bg-emerald-400'}`;
  dot.title = offline ? 'Not connected' : 'Connected';
  avatar.appendChild(dot);

  const titleEl = document.createElement('div');
  titleEl.className = TILE_TITLE;
  if (offline) titleEl.classList.replace('text-indigo-200', 'text-slate-400');
  titleEl.textContent = name;
  const subEl = document.createElement('div');
  subEl.className = `${TILE_SUB} ${offline ? 'text-slate-500' : 'text-slate-400'}`;
  subEl.textContent = subtitle;

  card.append(avatar, titleEl, subEl);
  if (inUse > 0) card.appendChild(createInUseBadge(inUse));
  card.onclick = onOpen;
  return card;
}

/** Full-width breadcrumb row: ‹  Plugins › Home Assistant › Lights — every part but the last is clickable. */
function createPageHeader(crumbs) {
  const header = document.createElement('div');
  header.className = 'col-span-full flex items-center gap-1 text-xs min-w-0';

  const back = document.createElement('button');
  back.type = 'button';
  back.title = 'Back';
  back.className =
    'w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 transition shrink-0';
  back.appendChild(svgIcon(CHEVRON_LEFT, 14));
  back.onclick = goBack;
  header.appendChild(back);

  crumbs.forEach(({ label, onClick }, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'text-slate-600';
      sep.textContent = '›';
      header.appendChild(sep);
    }
    const last = i === crumbs.length - 1;
    const el = document.createElement(last ? 'span' : 'button');
    el.textContent = label;
    if (last) {
      el.className = 'font-semibold text-slate-200 truncate';
    } else {
      el.type = 'button';
      el.className = 'text-slate-400 hover:text-white transition shrink-0';
      el.onclick = onClick;
    }
    header.appendChild(el);
  });
  return header;
}

function createNote(text) {
  const msg = document.createElement('p');
  msg.className = 'col-span-full text-xs text-slate-500 italic px-1';
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

const ROOT_CRUMB = { label: 'Plugins', onClick: () => openPage(null) };

function renderPluginCards(list, usage) {
  const offline = offlinePlugins(usage);
  if (!state.pluginActions.length && !offline.size) {
    list.appendChild(createNote('No plugins connected. Connect a plugin via WebSocket on port 59284.'));
    return;
  }

  for (const plugin of state.pluginActions) {
    const inUse = countInUse(usage, plugin.pluginId, plugin.actions.map((a) => a.id));
    list.appendChild(createPluginTile({
      pluginId: plugin.pluginId,
      name: plugin.name,
      subtitle: plural(plugin.actions.length, 'action'),
      inUse,
      onOpen: () => openPage(plugin.pluginId),
    }));
  }
  for (const [pluginId, actionIds] of offline) {
    list.appendChild(createPluginTile({
      pluginId,
      name: pluginId,
      subtitle: 'Offline',
      inUse: actionIds.length,
      offline: true,
      onOpen: () => openPage(pluginId),
    }));
  }
}

// Knob: a gauge arc with a pointer. Button: a ring with a pressed centre.
const KNOB_GLYPH = 'M5.6 18.4A9 9 0 1 1 18.4 18.4M12 13l3.5-3.5';
const BUTTON_GLYPH = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6';

/**
 * Draggable action card: wide and short, so names get the room squares didn't
 * have. The icon carries the plugin's colour and shows whether the action is
 * for a knob turn or a button press; mapped actions get a cyan edge and say where.
 */
function createPluginActionCard(pluginId, action, uses, displayLabel = action.label) {
  const dragName = pluginDragName(pluginId, action.id);
  const offline = !state.pluginActions.some((p) => p.pluginId === pluginId);
  const hue = pluginHue(pluginId);

  const card = document.createElement('div');
  card.className =
    'flex items-center gap-2.5 h-14 px-2.5 rounded-lg border bg-slate-700 cursor-move transition group ' +
    `hover:bg-cyan-700 hover:border-cyan-500 ${uses.length ? 'border-cyan-600' : 'border-slate-600'}`;
  card.setAttribute('draggable', 'true');
  card.title = uses.length ? `${action.label}\nOn ${uses.map(usageText).join(', ')}` : action.label;

  const iconEl = document.createElement('div');
  iconEl.className = 'w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-white transition';
  iconEl.style.background = offline ? '#475569' : `hsl(${hue} 55% 42% / 0.85)`;
  iconEl.appendChild(svgIcon(action.kind === 'button' ? BUTTON_GLYPH : KNOB_GLYPH, 16));

  const textWrap = document.createElement('div');
  textWrap.className = 'flex flex-col min-w-0 flex-1';
  const labelEl = document.createElement('div');
  labelEl.className = 'text-xs font-medium leading-tight text-indigo-200 group-hover:text-white break-words line-clamp-2';
  labelEl.textContent = displayLabel;
  textWrap.appendChild(labelEl);

  const subEl = document.createElement('div');
  subEl.className = 'text-[10px] truncate mt-0.5';
  if (uses.length) {
    subEl.classList.add('text-cyan-300');
    subEl.textContent = `On ${uses.map(usageText).join(', ')}`;
  } else if (action.kind === 'knob' || action.kind === 'button') {
    subEl.classList.add('text-slate-400');
    subEl.textContent = action.kind === 'knob' ? 'Knob only' : 'Button only';
  }
  if (subEl.textContent) textWrap.appendChild(subEl);

  card.append(iconEl, textWrap);

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

/**
 * A full-width grid inside the page grid: 'tiles' for square plugin/group
 * tiles, 'actions' for the wider action cards.
 */
function createSection(kind) {
  const section = document.createElement('div');
  section.className =
    kind === 'tiles'
      ? 'col-span-full grid grid-cols-[repeat(auto-fill,6.25rem)] gap-2'
      : 'col-span-full grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2';
  return section;
}

/**
 * "Light: Desk", "Light: Hall" → "Desk", "Hall" when every action in the
 * group repeats the same "Something: " prefix (the group already says it).
 */
function stripSharedPrefix(actions) {
  const prefixOf = (label) => /^([^:]{1,24}):\s+\S/.exec(label)?.[1];
  const first = prefixOf(actions[0]?.label || '');
  if (!first || actions.length < 2 || !actions.every((a) => prefixOf(a.label) === first)) {
    return (action) => action.label;
  }
  return (action) => action.label.slice(first.length + 1).trim();
}

function appendActionCards(list, pluginId, actions, usage, display = (a) => a.label) {
  if (!actions.length) return;
  const section = createSection('actions');
  for (const action of actions) {
    section.appendChild(createPluginActionCard(
      pluginId,
      action,
      usage.get(pluginActionKey(pluginId, action.id)) || [],
      display(action),
    ));
  }
  list.appendChild(section);
}

function renderPluginPage(list, plugin, usage) {
  list.appendChild(createPageHeader([ROOT_CRUMB, { label: plugin.name }]));

  // Ungrouped actions first, then a tile per group (in first-seen order).
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
  appendActionCards(list, plugin.pluginId, ungrouped, usage);

  if (groups.size) {
    const section = createSection('tiles');
    for (const [groupName, actions] of groups) {
      section.appendChild(createNavCard({
        icon: '📁',
        title: groupName,
        subtitle: plural(actions.length, 'action'),
        inUse: countInUse(usage, plugin.pluginId, actions.map((a) => a.id)),
        stacked: true,
        onOpen: () => openPage(plugin.pluginId, groupName),
      }));
    }
    list.appendChild(section);
  }
}

function renderGroupPage(list, plugin, groupName, usage) {
  list.appendChild(createPageHeader([
    ROOT_CRUMB,
    { label: plugin.name, onClick: () => openPage(plugin.pluginId) },
    { label: groupName },
  ]));
  const actions = plugin.actions.filter((a) => a.group === groupName);
  appendActionCards(list, plugin.pluginId, actions, usage, stripSharedPrefix(actions));
}

function renderOfflinePage(list, pluginId, actionIds, usage) {
  list.appendChild(createPageHeader([ROOT_CRUMB, { label: pluginId }]));
  list.appendChild(createNote("This plugin isn't connected. Showing only the actions that are mapped."));
  appendActionCards(list, pluginId, actionIds.map((id) => ({ id, label: id })), usage);
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
