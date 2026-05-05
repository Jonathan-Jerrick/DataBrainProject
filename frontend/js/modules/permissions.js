// Role -> permission mapping. Mirrors backend/services/permissions.py — keep
// both in sync. Used to gate UI elements on the active user's role.
import { store } from '../utils/state.js';

const PERMISSIONS = {
  admin: new Set([
    'upload_dataset', 'delete_dataset', 'rename_dataset', 'edit_dataset',
    'create_dashboard', 'create_chart', 'duplicate_any_chart',
    'save_query_template', 'export_chart', 'apply_filters',
    'manage_users', 'view_audit_log', 'change_user_role',
  ]),
  editor: new Set([
    'edit_dataset', 'create_dashboard', 'create_chart',
    'duplicate_any_chart', 'save_query_template',
    'export_chart', 'apply_filters',
  ]),
  viewer: new Set([
    'export_chart', 'apply_temp_filters',
  ]),
};

export function can(permission) {
  const u = store.get('activeUser');
  return !!u && PERMISSIONS[u.role]?.has(permission);
}

function isOwner(resource) {
  const u = store.get('activeUser');
  return !!u && resource && resource.created_by === u.id;
}

export function canEditChart(chart) {
  const u = store.get('activeUser');
  if (!u || !chart) return false;
  return u.role === 'admin' || (u.role === 'editor' && isOwner(chart));
}

// Removes elements that the current user cannot access, based on a
// `data-requires-permission="<perm>"` attribute. Call after every render.
export function applyPermissions(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-requires-permission]').forEach(el => {
    if (!can(el.dataset.requiresPermission)) el.remove();
  });
}
