from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
import uuid
import json
import os
import asyncio
from pathlib import Path

from ..database import get_db, write_audit_log
from ..services.auth import get_current_user, require_permission
from ..services import csv_engine
from ..services.cache import query_cache
from ..models.schemas import ColumnRoleUpdate

router = APIRouter(prefix="/api/datasources", tags=["datasources"])

UPLOADS_DIR = Path(__file__).parent.parent / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# in-memory progress channels for SSE
_progress_channels: dict = {}


@router.post("/upload")
async def upload_datasource(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    require_permission(current_user, "upload_dataset")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are accepted")

    contents = await file.read()
    if len(contents) > 100 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 100MB)")

    ds_id = "ds_" + uuid.uuid4().hex[:12]
    save_path = UPLOADS_DIR / f"{ds_id}.csv"
    with open(save_path, "wb") as f:
        f.write(contents)

    try:
        df = csv_engine.load_csv(ds_id, str(save_path))
    except Exception as e:
        os.remove(save_path)
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    profiles = csv_engine.profile_columns(ds_id)
    health_status, health_issues = csv_engine.compute_health(ds_id, profiles)
    suggestions = csv_engine.generate_suggestions(ds_id, profiles)
    date_range = csv_engine.compute_date_range(ds_id, profiles)

    name = file.filename.rsplit(".", 1)[0]
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO datasources
               (id, name, filename, row_count, column_count, file_size_bytes,
                uploaded_by, health_status, health_issues, suggested_explorations, date_range)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ds_id, name, file.filename, len(df), len(df.columns), len(contents),
                current_user["id"], health_status,
                json.dumps(health_issues),
                json.dumps(suggestions),
                json.dumps(date_range) if date_range else None,
            ),
        )
        for cp in profiles:
            await db.execute(
                """INSERT INTO column_profiles
                   (id, datasource_id, column_name, column_type, inferred_role,
                    null_count, null_percentage, unique_count, min_value, max_value,
                    mean_value, median_value, top_values, histogram_data)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()), ds_id, cp.column_name, cp.column_type,
                    cp.inferred_role, cp.null_count, cp.null_percentage, cp.unique_count,
                    cp.min_value, cp.max_value, cp.mean_value, cp.median_value,
                    json.dumps(cp.top_values) if cp.top_values else None,
                    json.dumps(cp.histogram_data) if cp.histogram_data else None,
                ),
            )
        await db.commit()
        await write_audit_log(
            db, current_user["id"], "dataset_upload", "datasource", ds_id, name,
            {"row_count": len(df), "column_count": len(df.columns)},
        )
    finally:
        await db.close()

    return {
        "id": ds_id,
        "name": name,
        "filename": file.filename,
        "row_count": len(df),
        "column_count": len(df.columns),
        "file_size_bytes": len(contents),
        "status": "active",
        "uploaded_by": current_user["id"],
        "uploaded_at": "",
        "columns": [cp.model_dump() for cp in profiles],
        "health_status": health_status,
        "health_issues": health_issues,
        "suggested_explorations": suggestions,
        "date_range": date_range,
    }


@router.get("/upload/progress/{job_id}")
async def upload_progress(job_id: str):
    """Stub SSE endpoint that emits a synthetic stage progression. The actual
    upload is synchronous; this provides UX progress feedback."""

    async def event_stream():
        stages = [
            ("receiving", 10, "Receiving file..."),
            ("parsing", 30, "Parsing CSV..."),
            ("detecting_types", 50, "Detecting column types..."),
            ("profiling", 75, "Profiling columns..."),
            ("generating_suggestions", 90, "Generating suggestions..."),
            ("complete", 100, "Done"),
        ]
        for stage, progress, message in stages:
            payload = json.dumps({"stage": stage, "progress": progress, "message": message})
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("")
async def list_datasources(current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM datasources WHERE status = 'active' ORDER BY uploaded_at DESC"
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        for r in rows:
            r["health_issues"] = json.loads(r.get("health_issues") or "[]")
        return rows
    finally:
        await db.close()


@router.get("/{ds_id}/profile")
async def get_datasource_profile(ds_id: str, current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM datasources WHERE id = ?", (ds_id,))
        ds = await cursor.fetchone()
        if not ds:
            raise HTTPException(404, "Datasource not found")
        ds = dict(ds)

        # Viewer gets stripped profile
        if current_user["role"] == "viewer":
            return {
                "id": ds["id"],
                "name": ds["name"],
                "filename": ds["filename"],
                "row_count": ds["row_count"],
                "column_count": ds["column_count"],
                "file_size_bytes": ds["file_size_bytes"],
                "status": ds["status"],
                "uploaded_by": ds["uploaded_by"],
                "uploaded_at": ds["uploaded_at"],
                "columns": [],
                "health_status": ds["health_status"],
                "health_issues": [],
                "suggested_explorations": [],
                "date_range": None,
            }

        c2 = await db.execute(
            "SELECT * FROM column_profiles WHERE datasource_id = ?", (ds_id,)
        )
        cols = []
        for r in await c2.fetchall():
            d = dict(r)
            d["top_values"] = json.loads(d["top_values"]) if d.get("top_values") else None
            d["histogram_data"] = json.loads(d["histogram_data"]) if d.get("histogram_data") else None
            cols.append(d)

        return {
            "id": ds["id"],
            "name": ds["name"],
            "filename": ds["filename"],
            "row_count": ds["row_count"],
            "column_count": ds["column_count"],
            "file_size_bytes": ds["file_size_bytes"],
            "status": ds["status"],
            "uploaded_by": ds["uploaded_by"],
            "uploaded_at": ds["uploaded_at"],
            "columns": cols,
            "health_status": ds["health_status"],
            "health_issues": json.loads(ds.get("health_issues") or "[]"),
            "suggested_explorations": json.loads(ds.get("suggested_explorations") or "[]"),
            "date_range": json.loads(ds["date_range"]) if ds.get("date_range") else None,
        }
    finally:
        await db.close()


@router.patch("/{ds_id}/columns/{column_name}/role")
async def override_column_role(
    ds_id: str,
    column_name: str,
    body: ColumnRoleUpdate,
    current_user: dict = Depends(get_current_user),
):
    require_permission(current_user, "edit_dataset")
    if body.role not in ("dimension", "metric"):
        raise HTTPException(400, "Role must be dimension or metric")
    db = await get_db()
    try:
        await db.execute(
            "UPDATE column_profiles SET user_overridden_role = ? WHERE datasource_id = ? AND column_name = ?",
            (body.role, ds_id, column_name),
        )
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@router.delete("/{ds_id}")
async def delete_datasource(ds_id: str, current_user: dict = Depends(get_current_user)):
    require_permission(current_user, "delete_dataset")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT name FROM datasources WHERE id = ?", (ds_id,))
        ds = await cursor.fetchone()
        if not ds:
            raise HTTPException(404, "Datasource not found")
        # Mark dependent charts broken
        await db.execute(
            "UPDATE charts SET status = 'broken', broken_reason = 'Source dataset was deleted' WHERE datasource_id = ?",
            (ds_id,),
        )
        await db.execute("DELETE FROM column_profiles WHERE datasource_id = ?", (ds_id,))
        await db.execute("DELETE FROM datasources WHERE id = ?", (ds_id,))
        await db.commit()
        # Remove file + memory
        path = UPLOADS_DIR / f"{ds_id}.csv"
        if path.exists():
            os.remove(path)
        csv_engine.unload_dataframe(ds_id)
        query_cache.invalidate_datasource(ds_id)
        await write_audit_log(
            db, current_user["id"], "dataset_delete", "datasource", ds_id, ds["name"]
        )
        return {"status": "deleted"}
    finally:
        await db.close()


@router.patch("/{ds_id}")
async def rename_datasource(
    ds_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    require_permission(current_user, "rename_dataset")
    new_name = body.get("name")
    if not new_name:
        raise HTTPException(400, "name required")
    db = await get_db()
    try:
        await db.execute("UPDATE datasources SET name = ? WHERE id = ?", (new_name, ds_id))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()
