"""Protection explanations for the app: Apollo Protections (canonical) and Device Protections (cached, taught once)."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from services import protection_explanations as explanations
from services.higgins.provider import ProviderFailure

router = APIRouter(tags=["protections"])


@router.get("/protections/apollo/{protection_id}")
async def apollo_protection(protection_id: str):
    found = explanations.apollo_explanation(protection_id)
    if not found:
        raise HTTPException(404, "ApolloSG has no protection by that name.")
    return found


@router.get("/protections/device/{protection_id}")
async def reviewed_device_protection(protection_id: str):
    """Only the pre-written explanation — used where the device itself can't be described (browser preview)."""
    found = explanations.reviewed_device_explanation(protection_id)
    if not found:
        raise HTTPException(404, "ApolloSG has no pre-written explanation of that protection.")
    return found


@router.post("/protections/device/explanation")
async def device_protection(body: explanations.DeviceExplanationRequest, request: Request):
    try:
        result = await explanations.device_explanation(request.state.device["device_id"], body)
    except ProviderFailure as failure:
        raise HTTPException(503, "Higgins couldn't write this explanation right now. Nothing was made up in its place.") from failure
    if result.get("status") in ("generating", "limited"):
        return JSONResponse(result, status_code=202)
    return result
