import { state } from './state.js';

export const BUILTIN_PREFIX = 'builtin:';

// The fixed set of generic button-action templates shown in the Actions tab (Pro only).
// 'configurable: true' types open the knob config modal immediately on drop.
export const BUILTIN_ACTION_TYPES = [
  { type: 'keyboard_shortcut', label: 'Keyboard Shortcut', icon: '⌨️', configurable: true },
  { type: 'mute', label: 'Mute', icon: '🔇', configurable: false },
  { type: 'open_program', label: 'Open Program', icon: '📂', configurable: true },
];

export function getBuiltinTypeMeta(type) {
  return BUILTIN_ACTION_TYPES.find((t) => t.type === type) || null;
}

export function isBuiltinItem(name) {
  return typeof name === 'string' && name.startsWith(BUILTIN_PREFIX);
}

export function builtinDragName(type) {
  return `${BUILTIN_PREFIX}${type}`;
}

export function builtinTypeFromDragName(dragName) {
  return dragName.slice(BUILTIN_PREFIX.length);
}

/** Sub-label shown on a placed card, reflecting whatever's configured so far. */
export function describeBuiltinAction(entry) {
  if (entry.type === 'keyboard_shortcut') return entry.params?.keys || 'Click to set shortcut';
  if (entry.type === 'open_program') {
    const path = entry.params?.path;
    return path ? path.split(/[\\/]/).pop() : 'Click to choose program';
  }
  if (entry.type === 'mute') return "Mutes this knob's targets";
  return '';
}

export function renderBuiltinActionList() {
  const list = document.getElementById('builtinActionList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);

  for (const { type, label, icon } of BUILTIN_ACTION_TYPES) {
    const dragName = builtinDragName(type);

    const card = document.createElement('div');
    card.className =
      'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-move hover:bg-amber-700 hover:border-amber-500 transition group';
    card.setAttribute('draggable', 'true');

    const iconEl = document.createElement('div');
    iconEl.className =
      'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-amber-600 flex items-center justify-center text-lg shrink-0 transition';
    iconEl.textContent = icon;

    const textWrap = document.createElement('div');
    textWrap.className = 'flex flex-col min-w-0';

    const labelEl = document.createElement('div');
    labelEl.className = 'text-sm text-indigo-200 group-hover:text-white truncate transition font-medium';
    labelEl.textContent = label;

    const sub = document.createElement('div');
    sub.className = 'text-xs text-slate-400 truncate';
    sub.textContent = 'Drag onto a knob’s Button Press Action';

    textWrap.append(labelEl, sub);
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

    list.appendChild(card);
  }
}
