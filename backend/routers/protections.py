"""Protection explanations for the app: Apollo Protections and the common Device Protections, reviewed text only."""
from fastapi import APIRouter, HTTPException

from services import protection_explanations as explanations

router = APIRouter(tags=["protections"])


@router.get("/protections/apollo/{protection_id}")
async def apollo_protection(protection_id: str):
    found = explanations.apollo_explanation(protection_id)
    if not found:
        raise HTTPException(404, "ApolloSG has no protection by that name.")
    return found


@router.get("/protections/device/{protection_id}")
async def reviewed_device_protection(protection_id: str):
    found = explanations.reviewed_device_explanation(protection_id)
    if not found:
        raise HTTPException(404, "ApolloSG has no explanation of that protection yet.")
    return found
