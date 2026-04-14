export const state = {
  config: { Mappings: {}, exePaths: {} },
  runningProcesses: [],
  inputDevices: [],
  iconCache: new Map(),
  /** Set during knob-mapping drags; Chromium sometimes omits dataTransfer.types on dragover. */
  mappingDragActive: false,
  /** Fallback when drop.getData('text/plain') is empty (Electron/Chromium quirk). Cleared after drop/dragend. */
  mappingDragPayload: null,
};
