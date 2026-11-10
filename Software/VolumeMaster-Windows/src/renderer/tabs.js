export function setupTabs() {
  const tabs = {
    tabMappings: document.getElementById('tabContentMappings'),
    tabSettings: document.getElementById('tabContentSettings'),
  };

  const buttons = {
    tabMappings: document.getElementById('tabMappings'),
    tabSettings: document.getElementById('tabSettings'),
  };

  // Look comes from .folder-tab[aria-selected] in renderer.html. Switching
  // slides the new page in from the side of the tab that was clicked (tabs
  // further right come in from the right), unless reduced motion is on.
  const order = Object.keys(buttons);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = null;

  function show(id) {
    if (id === current) return;
    const direction = current === null ? 0 : Math.sign(order.indexOf(id) - order.indexOf(current));
    current = id;

    Object.entries(tabs).forEach(([tabId, content]) => {
      const isActive = tabId === id;
      content.classList.toggle('hidden', !isActive);
      buttons[tabId].setAttribute('aria-selected', String(isActive));
    });

    if (direction !== 0 && !reduceMotion.matches) {
      tabs[id].animate(
        [
          { opacity: 0, transform: `translateX(${direction * 28}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
  }

  Object.entries(buttons).forEach(([id, btn]) => btn.addEventListener('click', () => show(id)));
  show('tabMappings'); // first paint: no animation
}

const SUB_TAB_CONTENT_IDS = {
  subTabApps: 'subContentApps',
  subTabDevices: 'subContentDevices',
  subTabVoiceMeeter: 'subContentVoiceMeeter',
  subTabCategories: 'subContentCategories',
  subTabPlugins: 'subContentPlugins',
  subTabActions: 'subContentActions',
};

/**
 * Shows/hides a sub-tab button (e.g. when VoiceMeeter gets disabled, or a
 * device switches out of Pro). If that tab's panel is the one currently
 * showing, falls back to Applications instead of leaving an invisible tab
 * "selected" with its content still on screen.
 */
export function setSubTabAvailable(buttonId, available) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const wasVisible = !btn.classList.contains('hidden');
  btn.classList.toggle('hidden', !available);

  if (available || !wasVisible) return;
  const contentId = SUB_TAB_CONTENT_IDS[buttonId];
  const content = contentId && document.getElementById(contentId);
  if (content && !content.classList.contains('hidden')) {
    document.getElementById('subTabApps')?.click();
  }
}

export function setupSubTabs() {
  const panels = {
    subTabApps: document.getElementById('subContentApps'),
    subTabDevices: document.getElementById('subContentDevices'),
    subTabVoiceMeeter: document.getElementById('subContentVoiceMeeter'),
    subTabCategories: document.getElementById('subContentCategories'),
    subTabPlugins: document.getElementById('subContentPlugins'),
    subTabActions: document.getElementById('subContentActions'),
  };

  const buttons = {
    subTabApps: document.getElementById('subTabApps'),
    subTabDevices: document.getElementById('subTabDevices'),
    subTabVoiceMeeter: document.getElementById('subTabVoiceMeeter'),
    subTabCategories: document.getElementById('subTabCategories'),
    subTabPlugins: document.getElementById('subTabPlugins'),
    subTabActions: document.getElementById('subTabActions'),
  };

  Object.entries(buttons).forEach(([id, btn]) => {
    btn.addEventListener('click', () => {
      Object.entries(panels).forEach(([panelId, content]) => {
        const isActive = panelId === id;
        content.classList.toggle('hidden', !isActive);
        buttons[panelId].classList.toggle('bg-slate-800', isActive);
        buttons[panelId].classList.toggle('border-indigo-400', isActive);
        buttons[panelId].classList.toggle('border-transparent', !isActive);
        buttons[panelId].classList.toggle('text-indigo-400', isActive);
        buttons[panelId].classList.toggle('text-slate-500', !isActive);
      });
    });
  });
}
