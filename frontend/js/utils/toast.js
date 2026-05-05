const MAX_TOASTS = 3;

/**
 * Show a toast.
 * options: { duration, action: { label, onClick } }
 * Returns a function that dismisses the toast immediately.
 */
export function showToast(message, type = 'info', durationOrOpts = 4000) {
  const opts = typeof durationOrOpts === 'object' ? durationOrOpts : { duration: durationOrOpts };
  const duration = opts.duration ?? 4000;
  const action = opts.action;

  const container = document.getElementById('toast-container');
  if (!container) return () => {};

  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const messageEl = document.createElement('div');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;
  toast.appendChild(messageEl);

  if (action && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label || 'Undo';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { action.onClick(); } catch (err) { console.error(err); }
      remove();
    });
    toast.appendChild(btn);
  }

  const progress = document.createElement('div');
  progress.className = 'toast-progress';
  toast.appendChild(progress);
  container.appendChild(toast);

  progress.style.transition = `width ${duration}ms linear`;
  requestAnimationFrame(() => { progress.style.width = '0%'; });

  let timer;
  const remove = () => {
    clearTimeout(timer);
    if (!toast.parentNode) return;
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', remove);
  timer = setTimeout(remove, duration);

  return remove;
}
