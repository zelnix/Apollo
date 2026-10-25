"""Public brand assets: the banner emails show. No device context, nothing personal."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from core.brand import BANNER_PATH

router = APIRouter()


@router.get("/brand/banner.jpg", include_in_schema=False)
async def banner():
    return FileResponse(BANNER_PATH, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
