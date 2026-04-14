import { state } from './state.js';
import { sanitizeAppName } from './utils.js';
import { VM_CHANNELS } from './voicemeeter.js';

export async function loadProcessList() {
  state.runningProcesses = await window.api.listProcesses();
  renderProcessSearch();
}

export async function loadInputDevices() {
  state.inputDevices = await window.api.getInputDevices();
  renderInputDeviceList();
}

export function setupProcessSearchFocus() {
  document.getElementById('processSearch')?.addEventListener('focus', async () => {
    await loadProcessList();
    document.getElementById('processSearch').value = '';
  });
}

export function renderProcessSearch() {
  const searchInput = document.getElementById('processSearch');
  const filterSelect = document.getElementById('processFilter');
  const list = document.getElementById('processList');
  if (!searchInput || !list || !filterSelect) return;

  function applyFilters() {
    const searchValue = searchInput.value.toLowerCase();
    const filterValue = filterSelect.value;
    updateList(searchValue, filterValue);
  }

  searchInput.oninput = applyFilters;
  filterSelect.onchange = applyFilters;
  applyFilters();

  function updateList(searchFilter, typeFilter) {
    while (list.firstChild) list.removeChild(list.firstChild);
    state.runningProcesses
      .filter((proc) => {
        if (!proc || !proc.name) return false;
        const matchesSearch = proc.name.toLowerCase().includes(searchFilter);
        const matchesType = typeFilter === 'all' || (typeFilter === 'gui' && proc.isGUI);
        return matchesSearch && matchesType;
      })
      .forEach((proc) => {
        const item = document.createElement('div');
        item.textContent = sanitizeAppName(proc.name);
        item.id = `process-item-${proc.name}`;
        item.className =
          'px-2 py-1 bg-slate-700 text-indigo-200 rounded cursor-move hover:bg-indigo-600 transition whitespace-nowrap capitalize max-h-8';
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', (e) => {
          state.mappingDragActive = true;
          state.mappingDragPayload = { name: proc.name };
          e.dataTransfer.clearData();
          e.dataTransfer.setData('text/plain', proc.name);
          e.dataTransfer.effectAllowed = 'copy';
          item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => {
          state.mappingDragActive = false;
          item.style.opacity = '1';
        });
        list.appendChild(item);
      });
  }
}

export function renderVoiceMeeterChannels() {
  const notEnabledMsg = document.getElementById('vmNotEnabledMsg');
  const columns = document.getElementById('vmChannelColumns');
  const inputList = document.getElementById('vmInputList');
  const outputList = document.getElementById('vmOutputList');
  if (!inputList || !outputList) return;

  const vmEnabled = state.config.vm === true || state.config.vm === 'true';
  if (!vmEnabled) {
    notEnabledMsg?.classList.remove('hidden');
    columns?.classList.add('hidden');
    return;
  }
  notEnabledMsg?.classList.add('hidden');
  columns?.classList.remove('hidden');

  const version = state.config.vmversion || 'banana';
  const channels = VM_CHANNELS[version] ?? VM_CHANNELS.banana;

  function buildItem(id, label) {
    const dragName = `vm:${id}`;
    const item = document.createElement('div');
    item.className =
      'flex items-center gap-2 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded cursor-move hover:bg-purple-700 hover:border-purple-500 transition group';
    item.setAttribute('draggable', 'true');

    const dot = document.createElement('div');
    dot.className = 'w-2 h-2 rounded-full bg-purple-400 group-hover:bg-white shrink-0 transition';

    const lbl = document.createElement('span');
    lbl.className = 'text-xs text-indigo-200 group-hover:text-white truncate transition';
    lbl.textContent = label;

    item.append(dot, lbl);

    item.addEventListener('dragstart', (e) => {
      state.mappingDragActive = true;
      state.mappingDragPayload = { name: dragName };
      e.dataTransfer.clearData();
      e.dataTransfer.setData('text/plain', dragName);
      e.dataTransfer.effectAllowed = 'copy';
      item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => {
      state.mappingDragActive = false;
      item.style.opacity = '1';
    });

    return item;
  }

  while (inputList.firstChild) inputList.removeChild(inputList.firstChild);
  while (outputList.firstChild) outputList.removeChild(outputList.firstChild);

  channels.inputs.forEach(({ id, label }) => inputList.appendChild(buildItem(id, label)));
  channels.outputs.forEach(({ id, label }) => outputList.appendChild(buildItem(id, label)));
}

export function renderInputDeviceList() {
  const list = document.getElementById('inputDeviceList');
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  if (!state.inputDevices || !state.inputDevices.length) return;

  state.inputDevices.forEach((name, index) => {
    const card = document.createElement('div');
    card.id = `input-device-${index}`;
    card.className =
      'flex items-center gap-3 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg cursor-move hover:bg-indigo-600 hover:border-indigo-500 transition group';
    card.setAttribute('draggable', 'true');

    const icon = document.createElement('div');
    icon.className =
      'w-8 h-8 rounded-md bg-slate-600 group-hover:bg-indigo-500 flex items-center justify-center text-lg shrink-0 transition';
    icon.textContent = '🎤';

    const label = document.createElement('div');
    label.className = 'text-sm text-indigo-200 group-hover:text-white truncate transition';
    label.textContent = name;

    card.append(icon, label);

    card.addEventListener('dragstart', (e) => {
      state.mappingDragActive = true;
      state.mappingDragPayload = { name };
      e.dataTransfer.clearData();
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.effectAllowed = 'copy';
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', () => {
      state.mappingDragActive = false;
      card.style.opacity = '1';
    });

    list.appendChild(card);
  });
}
