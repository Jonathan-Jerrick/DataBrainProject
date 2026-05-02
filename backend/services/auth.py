from fastapi import Header, HTTPException
from typing import Optional
from ..database import get_db, get_user_by_id


async def get_current_user(x_user_id: Optional[str] = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Missing X-User-Id header")
    db = await get_db()
    try:
        user = await get_user_by_id(db, x_user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid user id")
        return user
    finally:
        await db.close()


def require_permission(user: dict, permission: str):
    from .permissions import can
    if not can(user["role"], permission):
        raise HTTPException(
            status_code=403,
            detail=f"Your role ({user['role']}) does not allow: {permission}",
        )
