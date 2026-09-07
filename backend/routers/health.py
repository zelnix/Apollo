from __future__ import annotations


from fastapi import APIRouter

from core.db import now_utc

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "service": "apollo-v1", "time": now_utc().isoformat()}
