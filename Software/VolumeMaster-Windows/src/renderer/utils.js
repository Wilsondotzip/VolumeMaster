import { state } from './state.js';

export function sanitizeAppName(name) {
  return name.replace(/([A-Z]+)/g, ' $1').replace('.exe', '').trim();
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
