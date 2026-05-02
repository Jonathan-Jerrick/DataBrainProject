import { store } from '../utils/state.js';

const PERMISSIONS = {
  admin: new Set([
    'upload_dataset', 'delete_dataset', 'archive_dataset', 'rename_dataset',
    'edit_dataset', 'view_column_profiles', 'create_dashboard',
    'delete_any_dashboard', 'lock_dashboard', 'set_dashboard_visibility',
    'set_default_dashboard', 'create_chart', 'edit_any_chart',
    'delete_any_chart', 'move_chart', 'duplicate_any_chart',
    'reassign_chart_ownership', 'manage_users', 'view_audit_log',
    'workspace_settings', 'save_query_template', 'export_chart',
    'apply_filters', 'save_filters', 'view_dashboards', 'view_datasets',
    'revoke_dashboard_access', 'change_user_role', 'fullscreen_chart',
  ]),
  editor: new Set([
    'edit_dataset', 'view_column_profiles', 'bookmark_dataset',
    'create_dashboard', 'delete_own_dashboard', 'duplicate_dashboard',
    'create_chart', 'edit_own_chart', 'delete_own_chart',
    'duplicate_any_chart', 'comment_on_chart', 'move_chart',
    'save_query_template', 'export_chart', 'apply_filters',
    'save_filters', 'view_dashboards', 'view_datasets', 'fullscreen_chart',
  ]),
  viewer: new Set([
    'export_chart', 'apply_temp_filters', 'view_dashboards',
    'view_dataset_names', 'fullscreen_chart',
  ]),
};

export function can(permission) {
  const u = store.get('activeUser');
  if (!u) return false;
  return PERMISSIONS[u.role]?.has(permission) || false;
}

export function canEditChart(chart) {
  const u = store.get('activeUser');
  if (!u || !chart) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'editor' && chart.created_by === u.id) return true;
  return false;
}

export function canDeleteChart(chart) {
  return canEditChart(chart);
}

export function canEditDashboard(dashboard) {
  const u = store.get('activeUser');
  if (!u || !dashboard) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'editor' && dashboard.created_by === u.id) return true;
  return false;
}

export function applyPermissions(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-requires-permission]').forEach(el => {
    const perm = el.dataset.requiresPermission;
    if (!can(perm)) el.remove();
  });
  rootEl.querySelectorAll('[data-requires-edit-chart]').forEach(el => {
    const chartId = el.dataset.requiresEditChart;
    const chart = (window._charts || []).find(c => c.id === chartId);
    if (!canEditChart(chart)) el.remove();
  });
}
