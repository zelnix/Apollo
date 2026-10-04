"""GuardDog production trust endpoints.

Serves the signed trust manifest, rule bundle, and controlled verification
probe for the GuardDog DNS-VPN enforcement engine.
"""

import json
import os
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/guarddog", tags=["guarddog"])

_ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "guarddog_artifacts"


def _load_artifact(name: str) -> dict | None:
    path = _ARTIFACTS_DIR / name
    if path.exists():
        return json.loads(path.read_text())
    return None


@router.get("/trust-manifest")
async def trust_manifest():
    """Return the current signed trust manifest."""
    artifact = _load_artifact("trust-manifest.json")
    if artifact is None:
        return {"error": "trust manifest not yet published"}
    return artifact


@router.get("/rule-bundle")
async def rule_bundle():
    """Return the current signed rule bundle."""
    artifact = _load_artifact("rule-bundle.json")
    if artifact is None:
        return {"error": "rule bundle not yet published"}
    return artifact


@router.get("/controlled-verify")
async def controlled_verify():
    """Controlled verification endpoint.

    When the GuardDog VPN is active, DNS for the controlled host resolves to the
    controlled IPv4 via the tunnel.  The app requests this URL to confirm interception.
    """
    return {"status": "ok", "source": "guarddog-controlled"}
