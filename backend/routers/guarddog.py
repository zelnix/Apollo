"""GuardDog production rule delivery — HTTPS-authenticated, no signing keys."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/guarddog", tags=["guarddog"])

# ── Production rule bundle ────────────────────────────────────────────────
# Delivered over authenticated HTTPS. TLS + baked-in URL provides authentication.
# No Ed25519 signing keys — validation is schema + version + expiry on device.
#
# IMPORTANT: issuedAt and expiresAt are DETERMINISTIC — they must NOT use
# dynamic timestamps (e.g. the current server time) because the on-device
# RuleBundleValidator hashes the full JSON for version-conflict detection.
# A server restart that changes timestamps but keeps the same bundleVersion
# would cause a VERSION_CONFLICT rejection on devices that already accepted
# the previous hash.
#
# When updating rules: bump bundleVersion AND update issuedAt/expiresAt.
PRODUCTION_RULES = {
    "schemaVersion": "2.0",
    "rulesetId": "apollo-rules-v1",
    "bundleVersion": 2,
    "issuedAt": "2026-06-01T00:00:00Z",
    "expiresAt": "2028-06-01T00:00:00Z",
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
    """Serve the current production rule bundle.

    Authentication: Currently HTTPS-only (TLS + baked-in URL in the signed APK).
    The Android runtime's fetch() does not send an auth header; the endpoint
    does not require one. This is a deliberate simplification for the initial
    deployment — the baked-in URL in the signed APK provides origin-binding,
    and the rules are not sensitive data. If per-device auth is needed later,
    add Apollo JWT verification here and a matching Authorization header in
    ApolloGuardDogProductionRuntime.fetch().
    """
    return PRODUCTION_RULES


@router.get("/controlled-verify")
async def controlled_verify():
    """Controlled verification endpoint (separate from rule delivery)."""
    return {"status": "ok", "source": "guarddog-controlled"}
