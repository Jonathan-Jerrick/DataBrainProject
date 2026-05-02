const MAX_TOASTS = 3;

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Trim existing
  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-message">${escapeHtml(message)}</div>
    <div class="toast-progress"></div>
  `;
  container.appendChild(toast);

  const progress = toast.querySelector('.toast-progress');
  progress.style.transition = `width ${duration}ms linear`;
  requestAnimationFrame(() => { progress.style.width = '0%'; });

  const remove = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };

  toast.addEventListener('click', remove);
  setTimeout(remove, duration);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
