import { api } from '../utils/api.js';
import { showToast } from '../utils/toast.js';
import { can } from './permissions.js';

const ROLES = ['admin', 'editor', 'viewer'];

export async function renderUsersPage(container) {
  if (!can('manage_users')) {
    container.innerHTML = `<div class="empty-state"><h2>Admin only</h2><p>You don't have permission to view this page.</p></div>`;
    return;
  }
  container.innerHTML = '<div class="skeleton" style="height:200px;"></div>';

  const users = await api.get('/users');
  let auditLog = [];
  try { auditLog = await api.get('/audit-log'); } catch {}

  container.innerHTML = `
    <div class="dashboard-toolbar"><h2>Users & Audit</h2></div>
    <div class="users-layout">
      <div class="users-list" id="users-list">
        ${users.map(u => `
          <div class="user-row" data-id="${u.id}">
            <span class="avatar" style="background:${u.avatar_color}">${u.avatar_initials}</span>
            <div class="user-row-info">
              <div class="name">${escapeHtml(u.name)}</div>
              <div class="email">${escapeHtml(u.email)}</div>
            </div>
            <span class="role-badge ${u.role}">${u.role}</span>
          </div>`).join('')}
      </div>
      <div id="user-detail" class="user-detail card">
        <p style="color:var(--color-text-muted);">Click a user to see their activity</p>
      </div>
    </div>

    <div style="margin-top:24px;">
      <div class="section-heading">Audit Log · last ${auditLog.length}</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table audit-table">
          <thead><tr><th>User</th><th>Action</th><th>Resource</th><th>Time</th></tr></thead>
          <tbody>
            ${auditLog.map(a => `
              <tr>
                <td><span class="avatar avatar-sm" style="background:${a.avatar_color}">${a.avatar_initials || '?'}</span> ${escapeHtml(a.user_name || a.user_id)}</td>
                <td class="${actionClass(a.action)}">${escapeHtml(a.action)}</td>
                <td>${escapeHtml(a.resource_type)}: ${escapeHtml(a.resource_name || a.resource_id || '')}</td>
                <td style="color:var(--color-text-muted);font-size:11px;">${a.timestamp || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('.user-row').forEach(row => {
    row.addEventListener('click', async () => {
      container.querySelectorAll('.user-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const id = row.dataset.id;
      await loadUserDetail(id);
    });
  });
}

async function loadUserDetail(userId) {
  const host = document.getElementById('user-detail');
  host.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  try {
    const detail = await api.get(`/users/${userId}/activity`);
    host.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <span class="avatar avatar-lg" style="background:${detail.user.avatar_color}">${detail.user.avatar_initials}</span>
        <div>
          <h3>${escapeHtml(detail.user.name)}</h3>
          <p style="color:var(--color-text-muted);font-size:12px;">${escapeHtml(detail.user.email)}</p>
        </div>
        <select id="role-select" class="form-select" style="margin-left:auto;width:auto;">
          ${ROLES.map(r => `<option value="${r}" ${r === detail.user.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:24px;font-size:13px;margin-bottom:16px;">
        <div><strong>${detail.chart_count}</strong> charts</div>
        <div><strong>${detail.dashboard_count}</strong> dashboards</div>
      </div>

      <div class="section-heading">Recent Charts</div>
      ${detail.charts.length ? detail.charts.slice(0,10).map(c => `
        <div style="padding:8px 0;border-bottom:1px solid var(--color-border);">
          <strong>${escapeHtml(c.title)}</strong>
          <span style="color:var(--color-text-muted);font-size:11px;">· ${c.chart_type} · ${c.created_at || ''}</span>
        </div>`).join('') : '<p style="color:var(--color-text-muted);">No charts</p>'}
    `;
    document.getElementById('role-select').addEventListener('change', async (e) => {
      try {
        await api.patch(`/users/${userId}/role`, { role: e.target.value });
        showToast(`Role updated to ${e.target.value}`, 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  } catch (e) {
    host.innerHTML = `<div style="color:var(--color-error);">${e.message}</div>`;
  }
}

function actionClass(action) {
  if (action.includes('create') || action.includes('upload')) return 'audit-action-create';
  if (action.includes('edit') || action.includes('change')) return 'audit-action-edit';
  if (action.includes('delete')) return 'audit-action-delete';
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
