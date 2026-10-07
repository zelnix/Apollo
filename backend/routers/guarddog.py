"""GuardDog production rule delivery — HTTPS-authenticated, no signing keys."""
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/guarddog", tags=["guarddog"])

# ── Production rule bundle ────────────────────────────────────────────────
# Delivered over authenticated HTTPS. TLS + baked-in URL provides authentication.
# No Ed25519 signing keys — validation is schema + version + expiry on device.
PRODUCTION_RULES = {
    "schemaVersion": "2.0",
    "rulesetId": "apollo-rules-v1",
    "bundleVersion": 2,
    "issuedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "expiresAt": (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "payload": {
        "rules": [
            {
                "ruleId": "prod-controlled-verify-v1",
                "host": "apolloverify.harmonywellnessgroup.com.au",
                "action": "block",
                "matchType": "exact",
                "category": "controlled-verification",
            }
        ]
    },
}


@router.get("/rules")
async def get_rules():
    """Serve the current production rule bundle."""
    return PRODUCTION_RULES


@router.get("/controlled-verify")
async def controlled_verify():
    """Controlled verification endpoint (separate from rule delivery)."""
    return {"status": "ok", "source": "guarddog-controlled"}
