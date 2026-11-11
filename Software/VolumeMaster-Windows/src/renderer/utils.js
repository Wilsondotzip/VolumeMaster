import { state } from './state.js';

export function sanitizeAppName(name) {
  return name.replace(/([A-Z]+)/g, ' $1').replace('.exe', '').trim();
}

/**
 * Splits a Windows input device name into its hardware and input type:
 * "Microphone (2- Yeti Stereo Microphone)" -> { title: 'Yeti Stereo Microphone', type: 'Microphone' }.
 * The hardware part can hold its own brackets ("Line In (Realtek(R) Audio)"), so
 * the type ends at the first " (" and the hardware runs to the last ")".
 * Windows' "2- " duplicate prefix is dropped. Names without brackets stay whole.
 */
export function parseInputDeviceName(name) {
  const match = /^(.*?) \((.*)\)$/.exec(name || '');
  if (!match) return { title: name || '', type: 'Input device' };
  const hardware = match[2].replace(/^\d+-\s*/, '').trim();
  return { title: hardware || match[1], type: match[1] };
}

export function getProcessDisplayInfo(appName) {
  const rawName = typeof appName === 'string' ? appName.trim() : '';
  const running = state.runningProcesses.find(
    (proc) => typeof proc?.name === 'string' && proc.name.toLowerCase() === rawName.toLowerCase()
  );
  const title = typeof running?.title === 'string' ? running.title.trim() : '';
  return {
    title,
    subtitle: rawName,
  };
}
