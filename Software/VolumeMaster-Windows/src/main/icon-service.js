const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const platform = require('./platform');

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

function saveIconToCache(key, pngBuffer) {
  const filePath = cachePathForKey(key);
  try {
    fs.writeFileSync(filePath, pngBuffer);
  } catch (err) {
    console.error('Failed to save icon to cache:', err);
  }
}

async function getAppIcon(exeNameOrPath) {
  if (!exeNameOrPath || typeof exeNameOrPath !== 'string') return null;

  const cacheKey = exeNameOrPath.trim().toLowerCase();

  // Return disk-cached icon if available
  const cached = loadIconFromCache(cacheKey);
  if (cached) return cached;

  // Resolve to an absolute path — direct path skips platform lookup entirely
  let resolvedPath;
  if (path.isAbsolute(exeNameOrPath) && fs.existsSync(exeNameOrPath)) {
    resolvedPath = exeNameOrPath;
  } else {
    resolvedPath = await platform.findProcessExePath(exeNameOrPath);
  }

  if (!resolvedPath) return null;

  try {
    let png;
    if (platform.extractIconPNG) {
      // Platform-specific extractor (macOS: app.getFileIcon crashes the
      // main process there, so the Swift backend renders the icon instead)
      png = await platform.extractIconPNG(resolvedPath);
    } else {
      // app.getFileIcon is Electron-native: no extra native addons needed
      const { app } = require('electron');
      const nativeImage = await app.getFileIcon(resolvedPath, { size: 'large' });
      png = nativeImage.isEmpty() ? null : nativeImage.toPNG();
    }
    if (!png) return null;

    saveIconToCache(cacheKey, png);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    console.error('Icon extraction failed:', err);
    return null;
  }
}

module.exports = { getAppIcon };
