// Custom title bar (Windows): the native one is hidden (titleBarStyle 'hidden'
// in main/window.js). Minimize and close go through the window's normal
// handlers, so they still hide to the tray / quit as before.
export function setupTitleBar() {
  const bar = document.getElementById('titleBar');
  if (!bar || window.api.platform !== 'win32') return;

  for (const btn of bar.querySelectorAll('[data-window-action]')) {
    btn.addEventListener('click', () => window.api.windowControl(btn.dataset.windowAction));
  }

  const maxBtn = bar.querySelector('[data-window-action="maximize"]');
  const showMaximized = (maximized) => {
    bar.classList.toggle('maximized', !!maximized);
    const label = maximized ? 'Restore' : 'Maximize';
    maxBtn.title = label;
    maxBtn.setAttribute('aria-label', label);
  };
  window.api.onWindowMaximized(showMaximized);
  window.api.isWindowMaximized().then(showMaximized);
}
