from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.security import require_admin
from app.domain.models.key_metadata import KeyMetadata

router = APIRouter(prefix="/keys", tags=["keys"])


@router.get("", response_model=list[KeyMetadata])
async def list_keys(request: Request):
    return await request.app.state.key_registry.list_keys()


@router.post("/{key_id}/retire", response_model=KeyMetadata, dependencies=[Depends(require_admin)])
async def retire_key(key_id: str, request: Request):
    registry = request.app.state.key_registry
    if key_id == registry.default_key_id:
        raise HTTPException(status_code=409, detail="cannot retire the active default signing key")
    meta = await registry.retire(key_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="unknown keyId")
    return meta
