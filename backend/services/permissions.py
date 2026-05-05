"""Role -> permission mapping. Mirrored on the frontend at
frontend/js/modules/permissions.js — keep both in sync.
"""

PERMISSIONS = {
    "admin": {
        "upload_dataset", "delete_dataset", "rename_dataset", "edit_dataset",
        "create_dashboard", "create_chart", "duplicate_any_chart",
        "save_query_template", "export_chart", "apply_filters",
        "manage_users", "view_audit_log", "change_user_role",
    },
    "editor": {
        "edit_dataset", "create_dashboard", "create_chart",
        "duplicate_any_chart", "save_query_template",
        "export_chart", "apply_filters",
    },
    "viewer": {
        "export_chart", "apply_temp_filters",
    },
}


def can(user_role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(user_role, set())


def _is_owner(user: dict, resource: dict) -> bool:
    return bool(user) and resource.get("created_by") == user.get("id")


def can_edit_chart(user: dict, chart: dict) -> bool:
    if not user:
        return False
    return user["role"] == "admin" or (user["role"] == "editor" and _is_owner(user, chart))


def can_delete_chart(user: dict, chart: dict) -> bool:
    return can_edit_chart(user, chart)


def can_edit_dashboard(user: dict, dashboard: dict) -> bool:
    if not user:
        return False
    return user["role"] == "admin" or (user["role"] == "editor" and _is_owner(user, dashboard))


def can_delete_dashboard(user: dict, dashboard: dict) -> bool:
    return can_edit_dashboard(user, dashboard)
