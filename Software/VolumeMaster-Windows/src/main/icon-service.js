const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const exec = util.promisify(require('child_process').exec);

// In-memory cache: exe name → resolved full path, survives across calls
const exePathCache = new Map();

function cacheDir() {
  return path.join(require('electron').app.getPath('userData'), 'iconCache');
}

function ensureCacheDir() {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePathForKey(key) {
  const hash = crypto.createHash('sha256').update(key.trim().toLowerCase()).digest('hex');
  return path.join(ensureCacheDir(), `${hash}.png`);
}

function loadIconFromCache(key) {
  const filePath = cachePathForKey(key);
  try {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function saveIconToCache(key, nativeImage) {
  const filePath = cachePathForKey(key);
  try {
    fs.writeFileSync(filePath, nativeImage.toPNG());
  } catch (err) {
    console.error('Failed to save icon to cache:', err);
  }
}

async function findRunningProcessExePath(exeName) {
  // Check in-memory cache first to avoid repeated PowerShell spawns
  if (exePathCache.has(exeName)) {
    return exePathCache.get(exeName);
  }

  try {
    const baseName = path.basename(exeName, '.exe');
    const cmd = `powershell -NoProfile -NonInteractive -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1"`;
    const { stdout } = await exec(cmd, { encoding: 'utf8', timeout: 5000 });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) {
      exePathCache.set(exeName, resolved);
      return resolved;
    }
  } catch {
    // Process not found or PowerShell timed out
  }

  return null;
}

async function getAppIcon(exeNameOrPath) {
  if (!exeNameOrPath || typeof exeNameOrPath !== 'string') return null;

  const cacheKey = exeNameOrPath.trim().toLowerCase();

  // Return disk-cached icon if available
  const cached = loadIconFromCache(cacheKey);
  if (cached) return cached;

  // Resolve to an absolute path — direct path skips PowerShell entirely
  let resolvedPath;
  if (path.isAbsolute(exeNameOrPath) && fs.existsSync(exeNameOrPath)) {
    resolvedPath = exeNameOrPath;
  } else {
    resolvedPath = await findRunningProcessExePath(exeNameOrPath);
  }

  if (!resolvedPath) return null;

  try {
    // app.getFileIcon is Electron-native: no extra native addons needed
    const { app } = require('electron');
    const nativeImage = await app.getFileIcon(resolvedPath, { size: 'large' });
    if (nativeImage.isEmpty()) return null;

    saveIconToCache(cacheKey, nativeImage);
    return `data:image/png;base64,${nativeImage.toPNG().toString('base64')}`;
  } catch (err) {
    console.error('Icon extraction failed:', err);
    return null;
  }
}

module.exports = { getAppIcon, findRunningProcessExePath };
