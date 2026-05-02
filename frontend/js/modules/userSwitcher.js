import { api } from '../utils/api.js';
import { store } from '../utils/state.js';
import { showToast } from '../utils/toast.js';

const ROLE_LABELS = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

export async function initUserSwitcher() {
  const users = await api.get('/users');
  store.set('users', users);

  // Default to admin user
  const defaultUser = users.find(u => u.id === 'user_sarah') || users[0];
  store.set('activeUser', defaultUser);

  renderSwitcher();
  updateRoleBadge();
  updateViewerBanner();
  updateSidebarPermissions();

  store.subscribe('activeUser', () => {
    renderSwitcher();
    updateRoleBadge();
    updateViewerBanner();
    updateSidebarPermissions();
  });
}

function renderSwitcher() {
  const el = document.getElementById('user-switcher');
  const u = store.get('activeUser');
  const users = store.get('users') || [];
  if (!el || !u) return;

  el.innerHTML = `
    <button class="user-switcher-trigger" id="us-trigger">
      <span class="avatar" style="background:${u.avatar_color}">${u.avatar_initials}</span>
      <span class="user-switcher-name">${u.name}</span>
      <span class="user-switcher-chevron">▼</span>
    </button>
    <div class="user-switcher-dropdown hidden" id="us-dropdown">
      ${users.map(usr => `
        <div class="user-switcher-item ${usr.id === u.id ? 'active' : ''}" data-user-id="${usr.id}">
          <span class="avatar" style="background:${usr.avatar_color}">${usr.avatar_initials}</span>
          <div class="user-switcher-item-info">
            <div class="name">${usr.name}</div>
            <div class="email">${usr.email}</div>
          </div>
          <span class="role-badge ${usr.role}">${ROLE_LABELS[usr.role]}</span>
        </div>
      `).join('')}
    </div>
  `;

  const trigger = document.getElementById('us-trigger');
  const dropdown = document.getElementById('us-dropdown');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    el.classList.toggle('open', !dropdown.classList.contains('hidden'));
  });
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    el.classList.remove('open');
  });

  dropdown.querySelectorAll('.user-switcher-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.userId;
      const target = users.find(x => x.id === id);
      if (target && target.id !== u.id) {
        switchUser(target);
      }
      dropdown.classList.add('hidden');
    });
  });
}

function switchUser(user) {
  store.set('activeUser', user);
  showToast(`Switched to ${user.name} (${ROLE_LABELS[user.role]})`, 'info', 2500);
  window.dispatchEvent(new CustomEvent('userSwitched', { detail: user }));
}

function updateRoleBadge() {
  const el = document.getElementById('role-badge');
  const u = store.get('activeUser');
  if (!el || !u) return;
  el.className = `role-badge ${u.role}`;
  el.textContent = ROLE_LABELS[u.role];
}

function updateViewerBanner() {
  const banner = document.getElementById('viewer-banner');
  const u = store.get('activeUser');
  if (!banner || !u) return;
  if (u.role === 'viewer') {
    banner.textContent = `👁 Viewing as ${u.name} · Viewer · Temporary filters only`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function updateSidebarPermissions() {
  const u = store.get('activeUser');
  document.querySelectorAll('.sidebar-link[data-requires-permission]').forEach(link => {
    const perm = link.dataset.requiresPermission;
    const allowed = u && (perm === 'manage_users' ? u.role === 'admin' : true);
    link.style.display = allowed ? '' : 'none';
  });
}
