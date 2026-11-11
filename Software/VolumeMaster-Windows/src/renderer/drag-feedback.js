import { state } from './state.js';
import { isPluginItem, isPluginDragAllowedFor } from './plugins.js';
import { isBuiltinItem, isBuiltinTurnCompatible } from './builtin-actions.js';

// How dragging a source card (app, input, category, plugin or built-in action)
// onto the knobs looks. Styles are in tailwind.css under "Drag and drop".
//
//  - Ghost: a compact pill with the card's icon and name follows the pointer,
//    in place of Chromium's translucent snapshot of the whole card.
//  - While dragging, <body> gets drag-active plus drag-to-knob / -button /
//    -turn for each kind of zone that accepts this card. CSS outlines those
//    zones and fades the rest, so where it can go is visible before you get there.
//  - The zone under the pointer gets .drop-hover (set from mappings.js's
//    dragover, which already works out the target).
//  - After a drop, the zone flashes and the card that appears in it pops in.
//
// The accept rules mirror onKnobsDragOverCapture in mappings.js.

const DRAG_CLASSES = ['drag-active', 'drag-to-knob', 'drag-to-button', 'drag-to-turn'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Which kinds of drop zone accept the dragged source card. */
function dropTargetsFor(name) {
  const builtin = isBuiltinItem(name);
  const plugin = isPluginItem(name);
  return {
    knob: !builtin && (!plugin || isPluginDragAllowedFor('knob')),
    button: builtin || (plugin && isPluginDragAllowedFor('button')),
    turn: builtin && isBuiltinTurnCompatible(name),
  };
}

/** Compact copy of a source card for setDragImage: its icon and its name. */
function buildGhost(card) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';

  const [iconSource, textSource] = card.children;
  const icon = document.createElement('div');
  icon.className = 'drag-ghost-icon';
  const img = iconSource?.tagName === 'IMG' ? iconSource : iconSource?.querySelector?.('img, svg');
  if (img) icon.appendChild(img.cloneNode(true));
  else icon.textContent = iconSource?.textContent?.trim() || '';

  const label = document.createElement('span');
  label.className = 'drag-ghost-label';
  label.textContent = ((textSource?.firstElementChild || textSource)?.textContent || card.textContent || '').trim();

  ghost.append(icon, label);
  return ghost;
}

function onDragStart(e) {
  // Card handlers (target phase) have already set the payload by now
  const name = state.mappingDragActive ? state.mappingDragPayload?.name : null;
  const card = e.target instanceof Element ? e.target.closest('[draggable="true"]') : null;
  if (!name || !card) return;

  const targets = dropTargetsFor(name);
  document.body.classList.add('drag-active');
  document.body.classList.toggle('drag-to-knob', targets.knob);
  document.body.classList.toggle('drag-to-button', targets.button);
  document.body.classList.toggle('drag-to-turn', targets.turn);

  // setDragImage needs the element rendered (off-screen is fine) at this moment
  const ghost = buildGhost(card);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 18, ghost.offsetHeight / 2);
  setTimeout(() => ghost.remove(), 0);
}

function onDragEnd() {
  document.body.classList.remove(...DRAG_CLASSES);
  clearDropHover();
}

/** The zone under the pointer: solid outline + tint. Only one at a time. */
export function setDropHover(zone) {
  for (const el of document.querySelectorAll('.drop-hover')) {
    if (el !== zone) el.classList.remove('drop-hover');
  }
  zone?.classList.add('drop-hover');
}

export function clearDropHover() {
  setDropHover(null);
}

/** After a drop: flash the zone and pop in whatever card appears in it. */
export function confirmDrop(zone) {
  if (!zone || reduceMotion.matches) return;
  zone.animate(
    [{ backgroundColor: 'rgb(99 102 241 / 0.28)' }, { backgroundColor: 'rgb(99 102 241 / 0)' }],
    { duration: 550, easing: 'ease-out' },
  );
  // Cards are added after the save round-trip; watch briefly for them
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || node.tagName === 'P') continue; // skip empty-state text
        node.scrollIntoView({ block: 'nearest' });
        node.animate(
          [
            { opacity: 0, transform: 'translateY(6px) scale(0.96)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    }
  });
  observer.observe(zone, { childList: true });
  setTimeout(() => observer.disconnect(), 1500);
}

export function setupDragFeedback() {
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragend', onDragEnd, true);
  document.addEventListener('drop', () => setTimeout(onDragEnd, 0), true);
  // Leaving the knobs area: nothing under the pointer is a target any more
  document.addEventListener('dragover', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#knobsAppsContainer')) clearDropHover();
  });
}
