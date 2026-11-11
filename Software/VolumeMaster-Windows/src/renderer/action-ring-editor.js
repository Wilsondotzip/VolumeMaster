import { state } from './state.js';
import {
  getBuiltinTypeMeta,
  RING_MAX_SLOTS,
  RING_SLOT_TYPES,
  ringSlotDisplay,
  defaultBuiltinParams,
} from './builtin-actions.js';
import { pluginActionKey } from './plugins.js';

// Editor for an Action Ring's slots, shown in the knob config dialog (widened).
// Left: a live preview of the wheel. Right: the ring's name, its slots (select
// one to edit it, reorder, remove) and an "Add action" picker. Built-in slots
// reuse the normal action fields via `buildSlotFields` (knob-config.js's
// buildBuiltinActionFields, passed in to avoid a circular import).

const PREVIEW_SIZE = 240;
const NS = 'http://www.w3.org/2000/svg';

const INPUT_CLASS =
  'w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-gray-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500';
const SMALL_BTN_CLASS =
  'w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-600 transition disabled:opacity-30 disabled:pointer-events-none';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Plugin actions a ring slot can run: anything not restricted to knob turns. */
function pickablePluginActions() {
  return state.pluginActions
    .map((plugin) => ({ plugin, actions: plugin.actions.filter((a) => a.kind !== 'knob') }))
    .filter(({ actions }) => actions.length);
}

/**
 * The program's own icon for an Open Program slot (data URL), or null while it
 * loads / if there isn't one — callers show the emoji then. Cached per path;
 * `onLoad` runs once a new icon arrives so the caller can redraw.
 */
const programIcons = new Map(); // path -> data URL | null
function programIcon(slot, onLoad) {
  const path = slot.kind === 'builtin' && slot.type === 'open_program' ? slot.params?.path : '';
  if (!path) return null;
  if (programIcons.has(path)) return programIcons.get(path);
  programIcons.set(path, null);
  window.api.getAppIcon(path).then((src) => {
    if (!src) return;
    programIcons.set(path, src);
    onLoad?.();
  }).catch(() => {});
  return null;
}

// --- Wheel preview ---------------------------------------------------------------

function svgEl(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Same geometry as ring.html, scaled down: slot 0 at 12 o'clock, clockwise. */
function drawPreview(svg, slots, selected, title, onIconLoad) {
  svg.textContent = '';
  const c = PREVIEW_SIZE / 2;
  const rOut = 112;
  const rIn = 64;
  const gap = 3;
  const point = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)];

  svg.appendChild(svgEl('circle', { cx: c, cy: c, r: 119, fill: '#0f172a', stroke: '#334155' }));

  const n = slots.length;
  if (!n) {
    svg.appendChild(svgEl('circle', {
      cx: c, cy: c, r: (rOut + rIn) / 2, fill: 'none', stroke: '#334155', 'stroke-width': rOut - rIn, 'stroke-dasharray': '6 6',
    }));
  }
  const step = (Math.PI * 2) / Math.max(n, 1);
  slots.forEach((slot, i) => {
    const active = i === selected;
    let d;
    if (n === 1) {
      d = `M${c} ${c - rOut} A${rOut} ${rOut} 0 1 1 ${c - 0.01} ${c - rOut} L${c - 0.01} ${c - rIn} A${rIn} ${rIn} 0 1 0 ${c} ${c - rIn}Z`;
    } else {
      const a0 = i * step - step / 2;
      const a1 = a0 + step;
      const [o0, o1] = [a0 + gap / 2 / rOut, a1 - gap / 2 / rOut];
      const [i0, i1] = [a0 + gap / 2 / rIn, a1 - gap / 2 / rIn];
      const large = o1 - o0 > Math.PI ? 1 : 0;
      const [x0, y0] = point(rOut, o0);
      const [x1, y1] = point(rOut, o1);
      const [x2, y2] = point(rIn, i1);
      const [x3, y3] = point(rIn, i0);
      d = `M${x0} ${y0} A${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3}Z`;
    }
    svg.appendChild(svgEl('path', {
      d,
      fill: active ? 'rgba(129,140,248,0.4)' : 'rgba(51,65,85,0.8)',
      stroke: active ? '#a5b4fc' : '#475569',
    }));
    const [ix, iy] = point((rOut + rIn) / 2, i * step);
    const fontSize = n <= 8 ? 18 : n <= 16 ? 13 : 10;
    const image = programIcon(slot, onIconLoad);
    if (image) {
      const s = Math.round(fontSize * 1.15);
      svg.appendChild(svgEl('image', { href: image, x: ix - s / 2, y: iy - s / 2, width: s, height: s }));
    } else {
      const icon = svgEl('text', {
        x: ix, y: iy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': fontSize,
      });
      icon.textContent = ringSlotDisplay(slot).icon;
      svg.appendChild(icon);
    }
  });

  const label = svgEl('text', {
    x: c, y: c - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#64748b', 'font-weight': 700, 'letter-spacing': 1,
  });
  label.textContent = (title || 'Action Ring').toUpperCase().slice(0, 18);
  svg.appendChild(label);
  const count = svgEl('text', { x: c, y: c + 10, 'text-anchor': 'middle', 'font-size': 11, fill: '#94a3b8' });
  count.textContent = n ? `${n} / ${RING_MAX_SLOTS}` : 'Empty';
  svg.appendChild(count);
}

// --- Editor ------------------------------------------------------------------------

/**
 * Builds the ring editor into `fields`. Returns getValue() → { title, slots },
 * each slot carrying the label / detail / icon the wheel shows.
 */
export function buildActionRingFields(entry, fields, buildSlotFields) {
  const slots = clone(Array.isArray(entry.params?.slots) ? entry.params.slots : []);
  let selected = slots.length ? 0 : -1;
  let commitSelected = null; // reads the open slot's fields back into it
  let picking = false;

  const layout = document.createElement('div');
  layout.className = 'flex gap-5 items-start';

  // Left column: preview
  const previewCol = document.createElement('div');
  previewCol.className = 'shrink-0 flex flex-col items-center gap-2';
  const svg = svgEl('svg', { width: PREVIEW_SIZE, height: PREVIEW_SIZE, viewBox: `0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}` });
  const previewHint = document.createElement('p');
  previewHint.className = 'text-xs text-slate-500 text-center w-[15rem]';
  previewHint.textContent = 'Press the knob to open the ring, turn to choose, press again to run it.';
  previewCol.append(svg, previewHint);

  // Right column: name, slots, add, slot settings
  const side = document.createElement('div');
  side.className = 'flex-1 min-w-0 flex flex-col gap-3';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex flex-col gap-1';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'text-xs text-gray-400';
  titleLabel.textContent = 'Ring name';
  titleLabel.htmlFor = 'actionRingTitle';
  const titleInput = document.createElement('input');
  titleInput.id = 'actionRingTitle';
  titleInput.type = 'text';
  titleInput.maxLength = 40;
  titleInput.placeholder = 'Action Ring';
  titleInput.value = entry.params?.title || '';
  titleInput.className = INPUT_CLASS;
  titleInput.oninput = () => drawPreview(svg, slots, selected, titleInput.value, redrawIcons);
  titleWrap.append(titleLabel, titleInput);

  const listHeader = document.createElement('div');
  listHeader.className = 'flex items-center justify-between';
  const listLabel = document.createElement('span');
  listLabel.className = 'text-xs text-gray-400';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className =
    'px-2.5 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-40 disabled:pointer-events-none';
  listHeader.append(listLabel, addBtn);

  // The list: rounded-lg (8px) with 1px border + 4px padding → rows are 3px.
  const list = document.createElement('div');
  list.className = 'custom-scroll flex flex-col gap-1 max-h-48 overflow-y-auto p-1 bg-slate-900 border border-slate-700 rounded-lg';

  const picker = document.createElement('div');
  picker.className = 'custom-scroll hidden flex flex-col gap-0.5 max-h-56 overflow-y-auto p-1 bg-slate-900 border border-indigo-500/60 rounded-lg';

  const slotFields = document.createElement('div');
  slotFields.className = 'flex flex-col gap-1';

  side.append(titleWrap, listHeader, list, picker, slotFields);
  layout.append(previewCol, side);
  fields.appendChild(layout);

  function commit() {
    if (commitSelected && slots[selected]) slots[selected].params = commitSelected();
  }

  function select(i) {
    commit();
    selected = i;
    picking = false;
    render();
  }

  function move(i, delta) {
    commit();
    const j = i + delta;
    [slots[i], slots[j]] = [slots[j], slots[i]];
    if (selected === i) selected = j;
    else if (selected === j) selected = i;
    render();
  }

  function remove(i) {
    commit();
    slots.splice(i, 1);
    if (selected >= slots.length) selected = slots.length - 1;
    render();
  }

  function add(slot) {
    commit();
    slots.push(slot);
    selected = slots.length - 1;
    picking = false;
    render();
  }

  // A program icon finished loading: redraw the list and wheel (not the slot's
  // fields, which may be mid-edit)
  function redrawIcons() {
    renderList();
    drawPreview(svg, slots, selected, titleInput.value, redrawIcons);
  }

  function renderList() {
    list.textContent = '';
    if (!slots.length) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-500 italic px-2 py-1.5';
      empty.textContent = 'No actions yet. Add one to start the ring.';
      list.appendChild(empty);
      return;
    }
    slots.forEach((slot, i) => {
      const { label, detail, icon } = ringSlotDisplay(slot);
      const row = document.createElement('div');
      row.className =
        'flex items-center gap-2 px-1.5 py-1 rounded-[3px] cursor-pointer transition ' +
        (i === selected ? 'bg-indigo-600/30 ring-1 ring-indigo-400/70' : 'hover:bg-slate-700/60');
      row.onclick = () => select(i);

      const num = document.createElement('span');
      num.className = 'w-5 text-right text-[10px] text-slate-500 tabular-nums shrink-0';
      num.textContent = String(i + 1);
      const iconEl = document.createElement('span');
      iconEl.className = 'w-5 flex justify-center shrink-0';
      const image = programIcon(slot, redrawIcons);
      if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = '';
        img.className = 'w-4 h-4';
        iconEl.appendChild(img);
      } else {
        iconEl.textContent = icon;
      }
      const text = document.createElement('div');
      text.className = 'flex flex-col min-w-0 flex-1';
      const labelEl = document.createElement('span');
      labelEl.className = 'text-xs font-semibold text-slate-200 truncate';
      labelEl.textContent = label;
      text.appendChild(labelEl);
      if (detail) {
        const detailEl = document.createElement('span');
        detailEl.className = 'text-[10px] text-slate-500 truncate';
        detailEl.textContent = detail;
        text.appendChild(detailEl);
      }

      const controls = document.createElement('div');
      controls.className = 'flex shrink-0';
      const mk = (glyph, title, onClick, disabled) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = SMALL_BTN_CLASS;
        btn.textContent = glyph;
        btn.title = title;
        btn.disabled = disabled;
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
        return btn;
      };
      controls.append(
        mk('↑', 'Move earlier (anticlockwise)', () => move(i, -1), i === 0),
        mk('↓', 'Move later (clockwise)', () => move(i, 1), i === slots.length - 1),
        mk('✕', 'Remove', () => remove(i), false),
      );

      row.append(num, iconEl, text, controls);
      list.appendChild(row);
    });
  }

  function pickerHeading(text) {
    const h = document.createElement('div');
    h.className = 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-2 pt-1.5 pb-0.5';
    h.textContent = text;
    return h;
  }

  function pickerRow(icon, label, detail, onPick) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'flex items-center gap-2 px-2 py-1 rounded-[3px] text-left hover:bg-indigo-600/40 transition';
    const iconEl = document.createElement('span');
    iconEl.className = 'w-5 text-center shrink-0';
    iconEl.textContent = icon;
    const labelEl = document.createElement('span');
    labelEl.className = 'text-xs text-slate-200 truncate flex-1';
    labelEl.textContent = label;
    row.append(iconEl, labelEl);
    if (detail) {
      const detailEl = document.createElement('span');
      detailEl.className = 'text-[10px] text-slate-500 shrink-0';
      detailEl.textContent = detail;
      row.appendChild(detailEl);
    }
    row.onclick = onPick;
    return row;
  }

  function renderPicker() {
    picker.textContent = '';
    picker.classList.toggle('hidden', !picking);
    if (!picking) return;

    picker.appendChild(pickerHeading('Built-in'));
    for (const type of RING_SLOT_TYPES) {
      const meta = getBuiltinTypeMeta(type);
      if (!meta) continue;
      picker.appendChild(pickerRow(meta.icon, meta.label, meta.description, () => add({
        id: crypto.randomUUID(), kind: 'builtin', type, params: defaultBuiltinParams(type, 'press'),
      })));
    }

    const plugins = pickablePluginActions();
    if (!plugins.length) {
      picker.appendChild(pickerHeading('Plugins'));
      const none = document.createElement('p');
      none.className = 'text-xs text-slate-500 italic px-2 py-1';
      none.textContent = 'No plugins connected.';
      picker.appendChild(none);
    }
    for (const { plugin, actions } of plugins) {
      picker.appendChild(pickerHeading(plugin.name));
      for (const action of actions) {
        const key = pluginActionKey(plugin.pluginId, action.id);
        picker.appendChild(pickerRow('🔌', action.label, '', () => add({
          id: crypto.randomUUID(), kind: 'plugin', key,
        })));
      }
    }
  }

  function renderSlotFields() {
    slotFields.textContent = '';
    commitSelected = null;
    const slot = slots[selected];
    if (!slot || picking) return;

    const heading = document.createElement('div');
    heading.className = 'text-xs text-gray-400 pt-1 border-t border-slate-700';
    slotFields.appendChild(heading);

    if (slot.kind === 'plugin') {
      heading.textContent = `Slot ${selected + 1}: plugin action`;
      const note = document.createElement('p');
      note.className = 'text-xs text-slate-500';
      note.textContent = 'Runs like a button press on this plugin action. Its settings live in the plugin.';
      slotFields.appendChild(note);
      return;
    }
    const meta = getBuiltinTypeMeta(slot.type);
    heading.textContent = `Slot ${selected + 1}: ${meta?.label || slot.type}`;
    if (!meta?.configurable) {
      const note = document.createElement('p');
      note.className = 'text-xs text-slate-500';
      note.textContent = 'Nothing to set up for this action.';
      slotFields.appendChild(note);
      return;
    }
    const container = document.createElement('div');
    slotFields.appendChild(container);
    commitSelected = buildSlotFields(slot, container);
    // Keep the list and preview in step as the slot's settings change.
    // 'change' covers selects and typed text; 'focusout' covers the shortcut
    // recorder, which sets its value from code (no change event).
    const refresh = () => {
      commit();
      renderList();
      drawPreview(svg, slots, selected, titleInput.value, redrawIcons);
    };
    container.addEventListener('change', refresh);
    container.addEventListener('focusout', refresh);
  }

  function render() {
    listLabel.textContent = `Actions (${slots.length} / ${RING_MAX_SLOTS})`;
    addBtn.textContent = picking ? 'Close' : '+ Add action';
    addBtn.disabled = !picking && slots.length >= RING_MAX_SLOTS;
    renderList();
    renderPicker();
    renderSlotFields();
    drawPreview(svg, slots, selected, titleInput.value, redrawIcons);
  }

  addBtn.onclick = () => {
    commit();
    picking = !picking;
    render();
  };

  render();

  return () => {
    commit();
    return {
      title: titleInput.value.trim(),
      slots: slots.map((slot) => ({ ...slot, ...ringSlotDisplay(slot) })),
    };
  };
}
