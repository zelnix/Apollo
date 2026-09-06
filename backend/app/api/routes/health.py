from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    provider = request.app.state.provider
    return {
        "status": "ok",
        "service": "guarddog-m1-backend",
        "signingKeyId": request.app.state.key_registry.default_key_id,
        "provider": {"id": provider.provider_id, "configured": provider.is_configured()},
    }
