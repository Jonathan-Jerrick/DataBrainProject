PERMISSIONS = {
    "admin": {
        "upload_dataset", "delete_dataset", "archive_dataset", "rename_dataset",
        "edit_dataset", "view_column_profiles", "create_dashboard",
        "delete_any_dashboard", "lock_dashboard", "set_dashboard_visibility",
        "set_default_dashboard", "create_chart", "edit_any_chart",
        "delete_any_chart", "move_chart", "duplicate_any_chart",
        "reassign_chart_ownership", "manage_users", "view_audit_log",
        "workspace_settings", "save_query_template", "export_chart",
        "apply_filters", "save_filters", "view_dashboards", "view_datasets",
        "revoke_dashboard_access", "change_user_role", "fullscreen_chart",
    },
    "editor": {
        "edit_dataset", "view_column_profiles", "bookmark_dataset",
        "create_dashboard", "delete_own_dashboard", "duplicate_dashboard",
        "create_chart", "edit_own_chart", "delete_own_chart",
        "duplicate_any_chart", "comment_on_chart", "move_chart",
        "save_query_template", "export_chart", "apply_filters",
        "save_filters", "view_dashboards", "view_datasets",
        "fullscreen_chart",
    },
    "viewer": {
        "export_chart", "apply_temp_filters", "view_dashboards",
        "view_dataset_names", "fullscreen_chart",
    },
}


def can(user_role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(user_role, set())


def can_edit_chart(user: dict, chart: dict) -> bool:
    if not user:
        return False
    if user["role"] == "admin":
        return True
    if user["role"] == "editor" and chart.get("created_by") == user["id"]:
        return True
    return False


def can_delete_chart(user: dict, chart: dict) -> bool:
    return can_edit_chart(user, chart)


def can_edit_dashboard(user: dict, dashboard: dict) -> bool:
    if not user:
        return False
    if user["role"] == "admin":
        return True
    if user["role"] == "editor" and dashboard.get("created_by") == user["id"]:
        return True
    return False


def can_delete_dashboard(user: dict, dashboard: dict) -> bool:
    return can_edit_dashboard(user, dashboard)
