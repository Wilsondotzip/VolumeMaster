export function setupTabs() {
  const tabs = {
    tabMappings: document.getElementById('tabContentMappings'),
    tabSettings: document.getElementById('tabContentSettings'),
  };

  const buttons = {
    tabMappings: document.getElementById('tabMappings'),
    tabSettings: document.getElementById('tabSettings'),
  };

  Object.entries(buttons).forEach(([id, btn]) => {
    btn.classList.add('cursor-pointer', 'text-gray-400', 'hover:text-indigo-400', 'transition');

    btn.addEventListener('click', () => {
      Object.entries(tabs).forEach(([tabId, content]) => {
        const isActive = tabId === id;
        content.classList.toggle('hidden', !isActive);
        buttons[tabId].classList.toggle('border-b-2', isActive);
        buttons[tabId].classList.toggle('border-indigo-400', isActive);
        buttons[tabId].classList.toggle('text-indigo-400', isActive);
        buttons[tabId].classList.toggle('text-gray-400', !isActive);
      });
    });
  });

  buttons.tabMappings.click();
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
