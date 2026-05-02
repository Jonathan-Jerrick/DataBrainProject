from fastapi import APIRouter, Depends, HTTPException
import json
import uuid

from ..database import get_db, write_audit_log
from ..services.auth import get_current_user, require_permission
from ..services.permissions import can_edit_dashboard, can_delete_dashboard
from ..models.schemas import DashboardCreate, DashboardUpdate

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])


def _dashboard_visible(user: dict, d: dict) -> bool:
    if user["role"] == "admin":
        return True
    if d["visibility"] == "workspace":
        return True
    if d["visibility"] == "editors_only" and user["role"] == "editor":
        return True
    if d["visibility"] == "private" and d["created_by"] == user["id"]:
        return True
    return False


@router.get("")
async def list_dashboards(current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM dashboards ORDER BY is_default DESC, created_at ASC")
        rows = [dict(r) for r in await cursor.fetchall()]
        visible = [r for r in rows if _dashboard_visible(current_user, r)]

        # Filter by revoked access for viewers
        if current_user["role"] == "viewer":
            cursor2 = await db.execute(
                "SELECT dashboard_id FROM dashboard_access WHERE user_id = ? AND is_revoked = 1",
                (current_user["id"],),
            )
            revoked = {r["dashboard_id"] for r in await cursor2.fetchall()}
            visible = [r for r in visible if r["id"] not in revoked]

        for r in visible:
            r["layout_config"] = json.loads(r.get("layout_config") or "[]")
        return visible
    finally:
        await db.close()


@router.post("")
async def create_dashboard(body: DashboardCreate, current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "create_dashboard")
    db = await get_db()
    try:
        did = "dash_" + uuid.uuid4().hex[:10]
        await db.execute(
            "INSERT INTO dashboards (id, name, created_by, visibility) VALUES (?, ?, ?, ?)",
            (did, body.name, current_user["id"], body.visibility),
        )
        await db.commit()
        await write_audit_log(db, current_user["id"], "dashboard_create", "dashboard", did, body.name)
        cursor = await db.execute("SELECT * FROM dashboards WHERE id = ?", (did,))
        d = dict(await cursor.fetchone())
        d["layout_config"] = json.loads(d.get("layout_config") or "[]")
        return d
    finally:
        await db.close()


@router.patch("/{dash_id}")
async def update_dashboard(
    dash_id: str,
    body: DashboardUpdate,
    current_user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM dashboards WHERE id = ?", (dash_id,))
        d = await cursor.fetchone()
        if not d:
            raise HTTPException(404, "Dashboard not found")
        d = dict(d)
        if not can_edit_dashboard(current_user, d):
            raise HTTPException(403, "You cannot edit this dashboard")

        # Editors cannot change is_locked / visibility / is_default
        if current_user["role"] != "admin":
            if body.is_locked is not None or body.visibility is not None or body.is_default is not None:
                raise HTTPException(403, "Only admins can change locked/visibility/default")

        sets = []
        vals = []
        if body.name is not None:
            sets.append("name = ?"); vals.append(body.name)
        if body.layout_config is not None:
            sets.append("layout_config = ?"); vals.append(json.dumps(body.layout_config))
        if body.is_locked is not None:
            sets.append("is_locked = ?"); vals.append(body.is_locked)
        if body.visibility is not None:
            sets.append("visibility = ?"); vals.append(body.visibility)
        if body.is_default is not None:
            sets.append("is_default = ?"); vals.append(body.is_default)
            if body.is_default:
                await db.execute("UPDATE dashboards SET is_default = 0 WHERE id != ?", (dash_id,))
        sets.append("updated_at = CURRENT_TIMESTAMP")
        if sets:
            vals.append(dash_id)
            await db.execute(f"UPDATE dashboards SET {', '.join(sets)} WHERE id = ?", vals)
            await db.commit()

        await write_audit_log(db, current_user["id"], "dashboard_edit", "dashboard", dash_id, d["name"])
        cursor = await db.execute("SELECT * FROM dashboards WHERE id = ?", (dash_id,))
        out = dict(await cursor.fetchone())
        out["layout_config"] = json.loads(out.get("layout_config") or "[]")
        return out
    finally:
        await db.close()


@router.delete("/{dash_id}")
async def delete_dashboard(dash_id: str, current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM dashboards WHERE id = ?", (dash_id,))
        d = await cursor.fetchone()
        if not d:
            raise HTTPException(404, "Dashboard not found")
        d = dict(d)
        if not can_delete_dashboard(current_user, d):
            raise HTTPException(403, "You cannot delete this dashboard")
        if d.get("is_default"):
            raise HTTPException(400, "Cannot delete the default dashboard")
        await db.execute("DELETE FROM charts WHERE dashboard_id = ?", (dash_id,))
        await db.execute("DELETE FROM dashboards WHERE id = ?", (dash_id,))
        await db.commit()
        await write_audit_log(db, current_user["id"], "dashboard_delete", "dashboard", dash_id, d["name"])
        return {"status": "deleted"}
    finally:
        await db.close()


@router.get("/{dash_id}/charts")
async def get_dashboard_charts(dash_id: str, current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM charts WHERE dashboard_id = ? ORDER BY created_at ASC",
            (dash_id,),
        )
        rows = []
        for r in await cursor.fetchall():
            d = dict(r)
            d["query_spec"] = json.loads(d["query_spec"])
            d["visual_config"] = json.loads(d.get("visual_config") or "{}")
            rows.append(d)
        return rows
    finally:
        await db.close()
