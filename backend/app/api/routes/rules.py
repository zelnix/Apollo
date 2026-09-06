from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.logging import get_logger
from app.core.security import require_admin
from app.domain.models.rule_bundle import SignedRuleBundle, SignRequest
from app.domain.validation.rule_conflicts import RuleValidationError
from app.domain.validation.signing_guard import SigningRefused, enforce_signing_preconditions

router = APIRouter(prefix="/rules", tags=["rules"])
log = get_logger("rules")


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
    """Administrative/test workflow only: admin token + signing enabled + explicit confirm + ruleset allow-list
    + controlled-configuration validation. Never returns or logs private key material."""
    settings = request.app.state.settings
    try:
        enforce_signing_preconditions(settings, body)
        signed = await request.app.state.rule_service.sign_and_publish(body)
    except SigningRefused as exc:
        log.warning("signing refused code=%s ruleset=%s", exc.code, body.rulesetId)
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "detail": exc.detail})
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": "RULE_CONFLICT", "problems": exc.problems})
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    log.info("signed ruleset=%s version=%s keyId=%s rules=%s", signed.rulesetId, signed.bundleVersion, signed.keyId, len(signed.payload.rules))
    return signed
