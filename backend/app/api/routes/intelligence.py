"""Sanitized cloud lookup. The request body is the only place a URL enters; it is
sanitized immediately and the raw value is discarded (never logged/persisted)."""
from fastapi import APIRouter, HTTPException, Request

from app.domain.models.provider_result import IntelligenceLookupRequest, IntelligenceLookupResponse

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


@router.post("/lookup", response_model=IntelligenceLookupResponse)
async def lookup(body: IntelligenceLookupRequest, request: Request):
    result = await request.app.state.intelligence.lookup(body.url)
    if result is None:
        raise HTTPException(status_code=422, detail="url must be http(s) with a valid host")
    return result
