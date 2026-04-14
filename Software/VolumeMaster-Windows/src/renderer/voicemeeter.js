export const VM_CHANNELS = {
  standard: {
    inputs: [
      { id: 'Input0', label: 'Strip 1' },
      { id: 'Input1', label: 'Strip 2' },
      { id: 'Input2', label: 'Virtual Input' },
    ],
    outputs: [
      { id: 'Output0', label: 'A1' },
      { id: 'Output1', label: 'A2' },
      { id: 'Output2', label: 'B1' },
    ],
  },
  banana: {
    inputs: [
      { id: 'Input0', label: 'Strip 1' },
      { id: 'Input1', label: 'Strip 2' },
      { id: 'Input2', label: 'Strip 3' },
      { id: 'Input3', label: 'Virtual Input 1' },
      { id: 'Input4', label: 'Virtual Input 2' },
    ],
    outputs: [
      { id: 'Output0', label: 'A1' },
      { id: 'Output1', label: 'A2' },
      { id: 'Output2', label: 'A3' },
      { id: 'Output3', label: 'B1' },
      { id: 'Output4', label: 'B2' },
    ],
  },
  potato: {
    inputs: [
      { id: 'Input0', label: 'Strip 1' },
      { id: 'Input1', label: 'Strip 2' },
      { id: 'Input2', label: 'Strip 3' },
      { id: 'Input3', label: 'Strip 4' },
      { id: 'Input4', label: 'Strip 5' },
      { id: 'Input5', label: 'Virtual Input 1' },
      { id: 'Input6', label: 'Virtual Input 2' },
      { id: 'Input7', label: 'Virtual Input 3' },
    ],
    outputs: [
      { id: 'Output0', label: 'A1' },
      { id: 'Output1', label: 'A2' },
      { id: 'Output2', label: 'A3' },
      { id: 'Output3', label: 'A4' },
      { id: 'Output4', label: 'A5' },
      { id: 'Output5', label: 'B1' },
      { id: 'Output6', label: 'B2' },
      { id: 'Output7', label: 'B3' },
    ],
  },
};

/** Returns a friendly display label for a VM channel id (e.g. "Input0") and version. */
export function getVMLabel(vmId, version) {
  const channels = VM_CHANNELS[version] ?? VM_CHANNELS.banana;
  const all = [...channels.inputs, ...channels.outputs];
  return all.find((c) => c.id === vmId)?.label ?? vmId;
}

/** Returns whether a drag payload name is a VM channel (prefixed with "vm:"). */
export function isVMItem(name) {
  return typeof name === 'string' && name.startsWith('vm:');
}

/** Strips the "vm:" prefix to get the raw channel id. */
export function vmItemId(name) {
  return name.slice(3);
}
