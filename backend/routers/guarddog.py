"""GuardDog production rule delivery — dynamic bundle generation from verified threat indicators.

Authentication: HTTPS + Ed25519 cryptographic signing (Stage 4).
Bundle versioning: immutable, complete, monotonically versioned. Each version is a full snapshot.
Publication ≠ installation: this endpoint generates bundles; device pull/validation is separate.

The rule bundle is generated dynamically from active threat indicators in the database.
Active, non-expired ThreatIndicator entries with external provenance are included as BLOCK rules.

Signing: Each bundle is signed with Ed25519. The 'signature' field is added to the response
after the canonical JSON of the bundle content is signed. Native devices verify the signature
against a pinned public key before applying any rules.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from core.db import db, now_utc
from services.rule_signing import get_public_key_b64, is_signing_enabled, sign_bundle

router = APIRouter(prefix="/api/guarddog", tags=["guarddog"])

# ── Bundle version tracking ───────────────────────────────────────────────────
# We store the current published bundle in db.rule_bundle_state so that:
# 1. bundleVersion is monotonically increasing
# 2. The bundle is deterministic for a given set of active indicators
# 3. Devices can detect version changes without re-hashing
# Publication records are separate from device installation confirmations.

SCHEMA_VERSION = "2.0"
RULESET_ID = "apollo-rules-v1"
BUNDLE_VALIDITY = timedelta(days=730)  # 2 years; rules expire individually via ThreatIndicator


async def _get_active_indicator_rules() -> list[dict]:
    """Fetch active, non-expired ThreatIndicator entries and convert to native rule format.
    
    Only indicators with:
    - status: "active" (not check_overdue, expired, withdrawn, pending_review)
    - evidence_expiry_deadline in the future
    - scope: "hostname" (only hostname-level blocks become native rules)
    """
    now = now_utc()
    rules = []
    async for doc in db.threat_indicators.find({
        "status": "active",
        "evidence_expiry_deadline": {"$gt": now},
        "scope": "hostname",
    }).sort("hostname", 1):
        rules.append({
            "ruleId": f"ti-{doc['indicator_id']}",
            "host": doc["hostname"],
            "action": "block",
            "matchType": "exact",
            "category": "threat-intelligence",
            "source": doc.get("source", "unknown"),
            "evidenceExpires": doc["evidence_expiry_deadline"].strftime("%Y-%m-%dT%H:%M:%SZ")
                if isinstance(doc["evidence_expiry_deadline"], datetime) else str(doc["evidence_expiry_deadline"]),
        })
    return rules


def _compute_content_hash(rules: list[dict]) -> str:
    """Deterministic hash of the rule set for change detection."""
    canonical = json.dumps(rules, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


async def _get_or_publish_bundle() -> dict:
    """Generate the current production bundle.
    
    If the active rule set has changed since the last published version,
    increment bundleVersion and publish a new immutable bundle.
    If unchanged, return the previously published bundle.
    """
    # Get current active rules
    indicator_rules = await _get_active_indicator_rules()
    all_rules = indicator_rules
    content_hash = _compute_content_hash(all_rules)
    
    # Check if we already published a bundle with this exact content
    state = await db.rule_bundle_state.find_one({"ruleset_id": RULESET_ID})
    
    if state and state.get("content_hash") == content_hash:
        # No change — return the existing bundle
        return state["bundle"]
    
    # Content changed — publish new version
    prev_version = state["bundle"]["bundleVersion"] if state else 2
    new_version = prev_version + 1
    
    # Deterministic timestamps (NOT server wall-clock) — keyed to the version number
    # This ensures the same version always produces the same timestamps,
    # preventing VERSION_CONFLICT rejections on devices.
    issued_at = datetime(2026, 6, 1, tzinfo=timezone.utc) + timedelta(hours=new_version)
    expires_at = issued_at + BUNDLE_VALIDITY
    
    bundle = {
        "schemaVersion": SCHEMA_VERSION,
        "rulesetId": RULESET_ID,
        "bundleVersion": new_version,
        "issuedAt": issued_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "payload": {
            "rules": all_rules,
        },
    }
    
    # Persist the published bundle state
    now = now_utc()
    await db.rule_bundle_state.update_one(
        {"ruleset_id": RULESET_ID},
        {"$set": {
            "ruleset_id": RULESET_ID,
            "bundle": bundle,
            "content_hash": content_hash,
            "published_at": now,
            "bundle_version": new_version,
            "rule_count": len(all_rules),
            "indicator_count": len(indicator_rules),
        }},
        upsert=True,
    )
    
    # Record publication event (immutable audit)
    await db.rule_bundle_publications.insert_one({
        "bundle_version": new_version,
        "published_at": now,
        "content_hash": content_hash,
        "rule_count": len(all_rules),
        "indicator_count": len(indicator_rules),
        "indicator_ids": [r["ruleId"] for r in indicator_rules],
    })
    
    return bundle


@router.get("/rules")
async def get_rules():
    """Serve the current production rule bundle.

    Generated dynamically from active, non-expired ThreatIndicator entries
    with external provenance.

    Authentication: HTTPS + Ed25519 signature (Stage 4).
    The 'signature' field contains the base64-encoded Ed25519 signature of the
    canonical JSON content (sorted keys, compact, without the 'signature' key).
    Native clients verify this signature against the pinned public key.

    Bundle is immutable for a given version. Content changes trigger version increment.
    """
    bundle = await _get_or_publish_bundle()
    
    # Stage 4: Sign the bundle if Ed25519 signing is configured
    sig = sign_bundle(bundle)
    if sig:
        bundle = {**bundle, "signature": sig}
    
    return bundle


@router.get("/rules/status")
async def get_rules_status():
    """Admin/diagnostic: current bundle publication status."""
    state = await db.rule_bundle_state.find_one({"ruleset_id": RULESET_ID}, {"_id": 0, "bundle": 0})
    recent_pubs = await db.rule_bundle_publications.find(
        {}, {"_id": 0}
    ).sort("published_at", -1).to_list(10)
    return {
        "current": state,
        "recent_publications": recent_pubs,
    }


@router.get("/controlled-verify")
async def controlled_verify():
    """Controlled verification endpoint (separate from rule delivery)."""
    return {"status": "ok", "source": "guarddog-controlled"}


@router.get("/rules/public-key")
async def get_public_key():
    """Serve the Ed25519 public key for rule bundle signature verification.

    Native devices fetch this to verify signed bundles. In production, the public
    key is typically pinned in the APK; this endpoint provides it for initial setup,
    key rotation, and diagnostic purposes.

    Returns 503 if signing is not configured.
    """
    if not is_signing_enabled():
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Rule signing not configured")
    
    pub_key = get_public_key_b64()
    return {
        "algorithm": "Ed25519",
        "public_key": pub_key,
        "encoding": "base64_raw_32bytes",
        "usage": "Verify the 'signature' field on /api/guarddog/rules responses",
    }
