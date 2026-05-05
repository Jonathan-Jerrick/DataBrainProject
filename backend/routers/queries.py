import json
import uuid

from fastapi import APIRouter, Depends

from ..database import get_db, write_audit_log
from ..models.schemas import QuerySpec, QueryTemplateCreate
from ..services import csv_engine
from ..services.auth import get_current_user, require_permission
from ..services.cache import query_cache

router = APIRouter(prefix="/api", tags=["queries"])


@router.post("/queries/execute")
async def execute_query(spec: QuerySpec, current_user: dict = Depends(get_current_user)):
    spec_dict = spec.model_dump()
    cached = query_cache.get(spec_dict)
    if cached is not None:
        out = dict(cached)
        out["cache_hit"] = True
        return out
    result = csv_engine.execute_query(spec)
    out = result.model_dump()
    query_cache.set(spec_dict, out, datasource_id=spec.datasource_id)

    db = await get_db()
    try:
        await write_audit_log(
            db, current_user["id"], "query_executed", "datasource", spec.datasource_id,
            details={"row_count": result.row_count},
        )
    finally:
        await db.close()
    return out


@router.post("/queries/preview")
async def preview_query(spec: QuerySpec, current_user: dict = Depends(get_current_user)):
    spec.limit = 10
    result = csv_engine.execute_query(spec)
    return result.model_dump()


@router.get("/query-templates")
async def list_query_templates(current_user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM query_templates ORDER BY created_at DESC")
        rows = [dict(r) for r in await cursor.fetchall()]
        for r in rows:
            r["query_spec"] = json.loads(r["query_spec"])
        return rows
    finally:
        await db.close()


@router.post("/query-templates")
async def create_query_template(
    body: QueryTemplateCreate,
    current_user: dict = Depends(get_current_user),
):
    require_permission(current_user, "save_query_template")
    db = await get_db()
    try:
        tid = "qt_" + uuid.uuid4().hex[:10]
        await db.execute(
            "INSERT INTO query_templates (id, name, datasource_id, query_spec, created_by) VALUES (?, ?, ?, ?, ?)",
            (tid, body.name, body.datasource_id, json.dumps(body.query_spec.model_dump()), current_user["id"]),
        )
        await db.commit()
        return {"id": tid, "name": body.name, "datasource_id": body.datasource_id, "query_spec": body.query_spec.model_dump()}
    finally:
        await db.close()
