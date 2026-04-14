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

export function setupSubTabs() {
  const panels = {
    subTabApps: document.getElementById('subContentApps'),
    subTabDevices: document.getElementById('subContentDevices'),
    subTabVoiceMeeter: document.getElementById('subContentVoiceMeeter'),
  };

  const buttons = {
    subTabApps: document.getElementById('subTabApps'),
    subTabDevices: document.getElementById('subTabDevices'),
    subTabVoiceMeeter: document.getElementById('subTabVoiceMeeter'),
  };

  Object.entries(buttons).forEach(([id, btn]) => {
    btn.addEventListener('click', () => {
      Object.entries(panels).forEach(([panelId, content]) => {
        const isActive = panelId === id;
        content.classList.toggle('hidden', !isActive);
        buttons[panelId].classList.toggle('border-b-2', isActive);
        buttons[panelId].classList.toggle('border-indigo-400', isActive);
        buttons[panelId].classList.toggle('text-indigo-400', isActive);
        buttons[panelId].classList.toggle('text-slate-500', !isActive);
      });
    });
  });
}
