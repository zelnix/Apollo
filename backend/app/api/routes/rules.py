from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.security import require_admin
from app.domain.models.rule_bundle import SignedRuleBundle, SignRequest
from app.domain.validation.rule_conflicts import RuleValidationError

router = APIRouter(prefix="/rules", tags=["rules"])


@router.get("/{ruleset_id}/latest", response_model=SignedRuleBundle)
async def latest_bundle(ruleset_id: str, request: Request):
    bundle = await request.app.state.rule_service.latest(ruleset_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="no bundle for ruleset")
    return bundle


@router.get("/{ruleset_id}/versions")
async def bundle_versions(ruleset_id: str, request: Request) -> dict:
    return {"rulesetId": ruleset_id, "versions": await request.app.state.rule_service.versions(ruleset_id)}


@router.post("/sign", response_model=SignedRuleBundle, dependencies=[Depends(require_admin)])
async def sign_rules(body: SignRequest, request: Request):
    try:
        return await request.app.state.rule_service.sign_and_publish(body)
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": "RULE_CONFLICT", "problems": exc.problems})
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
