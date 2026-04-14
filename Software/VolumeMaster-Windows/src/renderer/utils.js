export function sanitizeAppName(name) {
  return name.replace(/([A-Z]+)/g, ' $1').replace('.exe', '').trim();
}
