const ALERT_GAP_PX = 8;

/**
 * Keeps the (fixed, bottom-right) toasts clear of the full-width Run/Stop
 * button: while it's on screen they sit just above it, otherwise they fall
 * back to the stylesheet's corner position.
 */
function positionAlertContainer() {
  const container = document.getElementById('alertContainer');
  const runBtn = document.getElementById('saveAndRunBtn');
  if (!container) return;
  const visible = runBtn && runBtn.offsetParent !== null; // null while its tab is hidden
  container.style.bottom = visible
    ? `${window.innerHeight - runBtn.getBoundingClientRect().top + ALERT_GAP_PX}px`
    : '';
}

let positionTrackingStarted = false;

function startPositionTracking() {
  if (positionTrackingStarted) return;
  positionTrackingStarted = true;
  window.addEventListener('resize', positionAlertContainer);
  // The button moves when an error banner appears/disappears (the Mappings
  // tab shrinks) and when switching tabs — follow it while toasts are up.
  const observer = new ResizeObserver(positionAlertContainer);
  for (const id of ['tabContentMappings', 'errorBanners']) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

export function showAlert(type, message) {
  const alertContainer = document.getElementById('alertContainer');
  if (!alertContainer) return;
  startPositionTracking();
  positionAlertContainer();

  const colorStyles = {
    success: { bg: 'rgba(20, 83, 45, 0.8)', border: '#15803d', text: '#bbf7d0' },
    info: { bg: 'rgba(30, 58, 138, 0.8)', border: '#1d4ed8', text: '#bfdbfe' },
    warning: { bg: 'rgba(113, 63, 18, 0.8)', border: '#b45309', text: '#fde68a' },
    error: { bg: 'rgba(127, 29, 29, 0.8)', border: '#b91c1c', text: '#fecaca' },
  };

  const style = colorStyles[type] || colorStyles.info;
  const id = `alert-${Date.now()}`;

  const alert = document.createElement('div');
  alert.id = id;
  alert.className = `
    relative w-full px-4 py-2 pr-10
    text-sm font-medium rounded shadow-sm border
    opacity-0 translate-y-2
    transition-all duration-300 ease-out
  `
    .replace(/\s+/g, ' ')
    .trim();

  alert.style.backgroundColor = style.bg;
  alert.style.borderColor = style.border;
  alert.style.color = style.text;
  alert.style.backdropFilter = 'blur(4px)';

  // Built with textContent, not innerHTML: messages can carry text from outside
  // the app (backend output, device / app names) that must not be parsed as HTML.
  const messageSpan = document.createElement('span');
  messageSpan.className = 'block text-center truncate';
  messageSpan.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'absolute top-2 right-2 hover:opacity-70 transition text-base leading-none';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => alert.remove();

  alert.append(messageSpan, closeBtn);

  alert.style.cursor = 'pointer';
  let expanded = false;
  alert.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    expanded = !expanded;
    messageSpan.classList.toggle('truncate', !expanded);
    messageSpan.classList.toggle('whitespace-normal', expanded);
    messageSpan.classList.toggle('break-words', expanded);
  });

  alertContainer.appendChild(alert);

  requestAnimationFrame(() => {
    alert.classList.remove('opacity-0', 'translate-y-2');
    alert.classList.add('opacity-100', 'translate-y-0');
  });

  setTimeout(() => {
    alert.classList.remove('opacity-100', 'translate-y-0');
    alert.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => document.getElementById(id)?.remove(), 300);
  }, 4000);
}
