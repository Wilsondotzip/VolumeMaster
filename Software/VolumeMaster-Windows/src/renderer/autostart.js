export async function loadAutoStartState() {
  const autoStartCheckbox = document.getElementById('autoStartCheckbox');
  if (!autoStartCheckbox) return;

  try {
    const enabled = await window.api.getAutoStart();
    autoStartCheckbox.checked = enabled;
  } catch (err) {
    console.error('AutoStart load failed:', err);
  }
}

export function setupAutoStartListener() {
  const autoStartCheckbox = document.getElementById('autoStartCheckbox');
  if (!autoStartCheckbox) return;

  autoStartCheckbox.addEventListener('change', async () => {
    try {
      await window.api.setAutoStart(autoStartCheckbox.checked);
    } catch (err) {
      console.error('AutoStart update failed:', err);
    }
  });
}
