import { state } from './state.js';

/** Breaks shared refs from IPC/YAML quirks; renderer must not share Mappings array instances. */
export function cloneConfig(data) {
  if (!data || typeof data !== 'object') return { Mappings: {} };
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return { Mappings: {} };
  }
}

/**
 * Serialise all saves through a queue so rapid drops never race each other.
 * Each save captures the latest state.config at execution time, so all
 * in-flight mutations are included in the next write.
 */
let _saveQueue = Promise.resolve();

export function saveConfigAndSync() {
  const p = _saveQueue.then(async () => {
    const next = await window.api.saveConfig(state.config);
    if (next && typeof next === 'object') {
      state.config = cloneConfig(next);
    }
  });
  // Keep the queue alive even if one save throws.
  _saveQueue = p.catch(() => {});
  return p;
}
