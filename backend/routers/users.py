from fastapi import APIRouter, Depends, HTTPException
from typing import List
import json

from ..database import get_db, write_audit_log
from ..services.auth import get_current_user, require_permission
from ..models.schemas import UserRoleUpdate

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
async def list_users():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users ORDER BY role, name")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.get("/users/{user_id}/activity")
async def user_activity(user_id: str, current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "manage_users")
    db = await get_db()
    try:
        u = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = await u.fetchone()
        if not user:
            raise HTTPException(404, "User not found")

        c1 = await db.execute("SELECT COUNT(*) AS c FROM charts WHERE created_by = ?", (user_id,))
        chart_count = (await c1.fetchone())["c"]
        c2 = await db.execute("SELECT COUNT(*) AS c FROM dashboards WHERE created_by = ?", (user_id,))
        dash_count = (await c2.fetchone())["c"]
        c3 = await db.execute(
            "SELECT * FROM audit_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20",
            (user_id,),
        )
        recent = [dict(r) for r in await c3.fetchall()]

        c4 = await db.execute(
            "SELECT * FROM charts WHERE created_by = ? ORDER BY created_at DESC LIMIT 50",
            (user_id,),
        )
        charts = [dict(r) for r in await c4.fetchall()]
        for ch in charts:
            ch["query_spec"] = json.loads(ch["query_spec"])

        return {
            "user": dict(user),
            "chart_count": chart_count,
            "dashboard_count": dash_count,
            "recent_actions": recent,
            "charts": charts,
        }
    finally:
        await db.close()


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: UserRoleUpdate,
    current_user: dict = Depends(get_current_user),
):
    require_permission(current_user, "change_user_role")
    if body.role not in ("admin", "editor", "viewer"):
        raise HTTPException(400, "Invalid role")
    db = await get_db()
    try:
        await db.execute("UPDATE users SET role = ? WHERE id = ?", (body.role, user_id))
        await db.commit()
        await write_audit_log(
            db, current_user["id"], "role_change", "user", user_id,
            details={"new_role": body.role},
        )
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return dict(await cursor.fetchone())
    finally:
        await db.close()


@router.get("/audit-log")
async def get_audit_log(current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "view_audit_log")
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT al.*, u.name AS user_name, u.avatar_color, u.avatar_initials, u.role AS user_role
               FROM audit_log al
               LEFT JOIN users u ON al.user_id = u.id
               ORDER BY al.timestamp DESC LIMIT 50"""
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        return rows
    finally:
        await db.close()
