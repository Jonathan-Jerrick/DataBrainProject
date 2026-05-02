from fastapi import APIRouter, Depends, HTTPException
import json
import uuid

from ..database import get_db, write_audit_log
from ..services.auth import get_current_user, require_permission
from ..services.permissions import can_edit_chart, can_delete_chart
from ..models.schemas import ChartCreate, ChartUpdate

router = APIRouter(prefix="/api/charts", tags=["charts"])


@router.post("")
async def create_chart(body: ChartCreate, current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "create_chart")
    db = await get_db()
    try:
        ds = await (await db.execute("SELECT id FROM datasources WHERE id = ?", (body.datasource_id,))).fetchone()
        if not ds:
            raise HTTPException(400, "Datasource not found")
        dash = await (await db.execute("SELECT id FROM dashboards WHERE id = ?", (body.dashboard_id,))).fetchone()
        if not dash:
            raise HTTPException(400, "Dashboard not found")
        cid = "chart_" + uuid.uuid4().hex[:10]
        await db.execute(
            """INSERT INTO charts
               (id, title, dashboard_id, datasource_id, query_spec, chart_type,
                visual_config, created_by, width, height, position_x, position_y)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cid, body.title, body.dashboard_id, body.datasource_id,
                json.dumps(body.query_spec.model_dump()), body.chart_type,
                json.dumps(body.visual_config), current_user["id"],
                body.width, body.height, body.position_x, body.position_y,
            ),
        )
        await db.commit()
        await write_audit_log(db, current_user["id"], "chart_create", "chart", cid, body.title)
        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (cid,))
        out = dict(await cursor.fetchone())
        out["query_spec"] = json.loads(out["query_spec"])
        out["visual_config"] = json.loads(out["visual_config"])
        return out
    finally:
        await db.close()


@router.patch("/{chart_id}")
async def update_chart(
    chart_id: str,
    body: ChartUpdate,
    current_user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (chart_id,))
        chart = await cursor.fetchone()
        if not chart:
            raise HTTPException(404, "Chart not found")
        chart = dict(chart)
        if not can_edit_chart(current_user, chart):
            raise HTTPException(403, "Editors can only edit charts they created.")

        sets = []
        vals = []
        if body.title is not None:
            sets.append("title = ?"); vals.append(body.title)
        if body.query_spec is not None:
            sets.append("query_spec = ?"); vals.append(json.dumps(body.query_spec.model_dump()))
        if body.chart_type is not None:
            sets.append("chart_type = ?"); vals.append(body.chart_type)
        if body.visual_config is not None:
            sets.append("visual_config = ?"); vals.append(json.dumps(body.visual_config))
        if body.width is not None:
            sets.append("width = ?"); vals.append(body.width)
        if body.height is not None:
            sets.append("height = ?"); vals.append(body.height)
        if body.position_x is not None:
            sets.append("position_x = ?"); vals.append(body.position_x)
        if body.position_y is not None:
            sets.append("position_y = ?"); vals.append(body.position_y)
        sets.append("version = version + 1")
        sets.append("updated_at = CURRENT_TIMESTAMP")

        # If chart was broken and datasource exists now, reset to active
        ds_check = await (await db.execute("SELECT id FROM datasources WHERE id = ?", (chart["datasource_id"],))).fetchone()
        if chart["status"] == "broken" and ds_check:
            sets.append("status = 'active'")
            sets.append("broken_reason = NULL")

        vals.append(chart_id)
        await db.execute(f"UPDATE charts SET {', '.join(sets)} WHERE id = ?", vals)
        await db.commit()
        await write_audit_log(db, current_user["id"], "chart_edit", "chart", chart_id, chart["title"])

        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (chart_id,))
        out = dict(await cursor.fetchone())
        out["query_spec"] = json.loads(out["query_spec"])
        out["visual_config"] = json.loads(out["visual_config"])
        return out
    finally:
        await db.close()


@router.delete("/{chart_id}")
async def delete_chart(chart_id: str, current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (chart_id,))
        chart = await cursor.fetchone()
        if not chart:
            raise HTTPException(404, "Chart not found")
        chart = dict(chart)
        if not can_delete_chart(current_user, chart):
            raise HTTPException(403, "Editors can only delete charts they created.")
        await db.execute("DELETE FROM charts WHERE id = ?", (chart_id,))
        await db.commit()
        await write_audit_log(db, current_user["id"], "chart_delete", "chart", chart_id, chart["title"])
        return {"status": "deleted"}
    finally:
        await db.close()


@router.post("/{chart_id}/duplicate")
async def duplicate_chart(chart_id: str, current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "duplicate_any_chart")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (chart_id,))
        chart = await cursor.fetchone()
        if not chart:
            raise HTTPException(404, "Chart not found")
        chart = dict(chart)
        new_id = "chart_" + uuid.uuid4().hex[:10]
        await db.execute(
            """INSERT INTO charts
               (id, title, dashboard_id, datasource_id, query_spec, chart_type,
                visual_config, created_by, width, height, position_x, position_y)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_id, f"Copy of {chart['title']}", chart["dashboard_id"], chart["datasource_id"],
                chart["query_spec"], chart["chart_type"], chart["visual_config"],
                current_user["id"], chart["width"], chart["height"], chart["position_x"], chart["position_y"],
            ),
        )
        await db.commit()
        await write_audit_log(db, current_user["id"], "chart_duplicate", "chart", new_id, chart["title"])
        cursor = await db.execute("SELECT * FROM charts WHERE id = ?", (new_id,))
        out = dict(await cursor.fetchone())
        out["query_spec"] = json.loads(out["query_spec"])
        out["visual_config"] = json.loads(out["visual_config"])
        return out
    finally:
        await db.close()
