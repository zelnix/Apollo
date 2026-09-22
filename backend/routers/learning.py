"""No-store consumer reader for the backend-owned learning catalogue."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services import learning

router = APIRouter()
NO_STORE = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}


@router.get("/learning/articles")
async def articles(group: str | None = None, search: str | None = None, cursor: str | None = None, limit: int = Query(default=20, ge=1, le=50)):
    return JSONResponse(jsonable_encoder(await learning.list_articles(group, search, cursor, limit)), headers=NO_STORE)


@router.get("/learning/articles/{slug}")
async def article(slug: str):
    value = await learning.get_article(slug)
    if not value:
        raise HTTPException(status_code=404, detail="Learning article not found.")
    return JSONResponse(jsonable_encoder(value), headers=NO_STORE)