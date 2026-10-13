"""No-store consumer reader for the backend-owned learning catalogue."""
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services import learning

router = APIRouter()
public_router = APIRouter()
NO_STORE = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}


@router.get("/learning/articles")
async def articles(category: str | None = None, group: str | None = None, audience: str | None = None, tag: str | None = None,
                   risk_context: str | None = None, content_type: str | None = None, language: str | None = None,
                   search: str | None = None, cursor: str | None = None, limit: int = Query(default=20, ge=1, le=50)):
    return JSONResponse(jsonable_encoder(await learning.list_articles(category or group, audience, tag, risk_context, content_type, language, search, cursor, limit)), headers=NO_STORE)


@router.get("/learning/articles/{slug}")
async def article(slug: str):
    value = await learning.get_article(slug)
    if not value:
        raise HTTPException(status_code=404, detail="Learning article not found.")
    return JSONResponse(jsonable_encoder(value), headers=NO_STORE)


@public_router.get("/learning/image/{path:path}")
async def learning_image(path: str):
    """Serve a stored learning article image from Emergent Object Storage."""
    from fastapi.responses import Response
    try:
        from services import emergent_storage
        data, content_type = emergent_storage.get_object(path)
        return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        raise HTTPException(status_code=404, detail="Image not found")



class LearningPreferences(BaseModel):
    model_config = {"populate_by_name": True, "extra": "forbid"}
    topics: list[str] = Field(default_factory=list, max_length=20)
    audiences: list[str] = Field(default_factory=list, max_length=10)
    content_types: list[str] = Field(default_factory=list, max_length=10, alias="contentTypes")


class ArticleFeedback(BaseModel):
    helpful: bool
    reason: str | None = Field(default=None, max_length=500)


@router.get("/learning/preferences")
async def preferences(request: Request):
    return JSONResponse(jsonable_encoder(await learning.article_preferences(request.state.device["device_id"])), headers=NO_STORE)


@router.put("/learning/preferences")
async def update_preferences(body: LearningPreferences, request: Request):
    value = body.model_dump(mode="json"); value["contentTypes"] = value.pop("content_types")
    return JSONResponse(jsonable_encoder(await learning.save_preferences(request.state.device["device_id"], value)), headers=NO_STORE)


@router.post("/learning/articles/{slug}/feedback", status_code=202)
async def article_feedback(slug: str, body: ArticleFeedback, request: Request):
    if not await learning.get_article(slug): raise HTTPException(status_code=404, detail="Learning article not found.")
    await learning.record_feedback(request.state.device["device_id"], slug, body.helpful, body.reason)
    return JSONResponse({"accepted": True}, status_code=202, headers=NO_STORE)