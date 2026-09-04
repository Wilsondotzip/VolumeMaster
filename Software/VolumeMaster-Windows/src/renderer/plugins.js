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
    for (const action of plugin.actions) {
      const dragName = pluginDragName(plugin.pluginId, action.id);

      const card = document.createElement('div');
      card.className =
        'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-move hover:bg-cyan-700 hover:border-cyan-500 transition group';
      card.setAttribute('draggable', 'true');

      const iconEl = document.createElement('div');
      iconEl.className =
        'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-cyan-600 flex items-center justify-center text-lg shrink-0 transition';
      iconEl.textContent = '🔌';

      const textWrap = document.createElement('div');
      textWrap.className = 'flex flex-col min-w-0';

      const labelEl = document.createElement('div');
      labelEl.className = 'text-sm text-indigo-200 group-hover:text-white truncate transition font-medium';
      labelEl.textContent = action.label;

      const sub = document.createElement('div');
      sub.className = 'text-xs text-slate-400 truncate';
      sub.textContent = plugin.name;

      textWrap.append(labelEl, sub);
      card.append(iconEl, textWrap);

      if (action.kind === 'knob' || action.kind === 'button') {
        const badge = document.createElement('span');
        badge.className =
          'ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-300 bg-amber-900 bg-opacity-40 border border-amber-700 rounded px-1.5 py-0.5';
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

      list.appendChild(card);
    }
  }
}
