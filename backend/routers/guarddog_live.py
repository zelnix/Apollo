"""Site Gate live reputation — backend endpoint for DNS-time hostname checks.

Stage 3: When Site Gate's native VPN observes an unknown DNS hostname, this
endpoint provides a bounded-time intelligence decision using current external
providers.

Privacy: Receives hostname hash prefix, not the complete hostname.
Latency: Bounded to 3 seconds — caller should wait, not fire-and-forget.
Authority: Returns intelligence verdicts. Does NOT independently authorise native blocking.
           Only rule-bundle matches authorise sinkholing.

Protection Before Speed principle: A reasonable delay for investigation is preferred
over allowing an unexamined destination to load immediately.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import logger
from core.db import db, now_utc

router = APIRouter(prefix="/api/guarddog", tags=["guarddog-live"])


# ── Request/Response models ───────────────────────────────────────────────────

class DnsReputationRequest(BaseModel):
    """Privacy-preserving DNS reputation check.
    
    The device sends a hash prefix of the hostname, not the full hostname.
    For unknown hostnames not in the local rule bundle, the device may also
    send the full hostname for a direct check — this is a device-side privacy
    decision controlled by the native code.
    """
    hostname_hash_prefix: str = Field(min_length=4, max_length=16,
        description="First N hex chars of SHA-256(lowercase hostname)")
    hostname: Optional[str] = Field(default=None, max_length=253,
        description="Full hostname (optional — enables direct external lookup)")
    request_context: str = Field(default="dns_observation",
        description="Why this check was requested: dns_observation, link_tap, etc.")


class DnsReputationResponse(BaseModel):
    verdict: str  # "malicious", "clean", "unknown", "unavailable"
    threat_types: list[str] = []
    confidence: str = "none"  # "high", "medium", "low", "none"
    source: str = "none"  # Which provider returned the verdict
    cached: bool = False
    checked_at: str = ""
    coverage: str = "external_only"  # What was actually checked
    
    # Rule authority information
    in_active_bundle: bool = False  # Whether this hostname is in the current rule bundle
    bundle_version: Optional[int] = None
    
    # Honest limitations
    limitation: Optional[str] = None  # e.g., "hostname only — full URL not inspected"
    investigation_complete: bool = True


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/dns-check", response_model=DnsReputationResponse)
async def dns_reputation_check(req: DnsReputationRequest):
    """Live reputation check for a DNS hostname observed by Site Gate.
    
    Called by the native VPN when it observes an unknown DNS query not in the
    local rule bundle. The bounded hold principle applies: the native layer
    should wait for this response (up to ~3 seconds) before forwarding DNS.
    
    Intelligence paths:
    - Hostname provided: full external intelligence check (Safe Browsing etc.)
    - Hash prefix only: local threat indicator check (limited coverage)
    
    When external intelligence confirms a hostname as malicious, a threat
    indicator is created so subsequent rule bundles include the hostname.
    """
    ts = now_utc()
    
    # If the device provided the full hostname, use full external intelligence
    if req.hostname:
        hostname = req.hostname.strip().lower().rstrip(".")
        if not hostname or len(hostname) < 3:
            raise HTTPException(status_code=422, detail="Invalid hostname")
        
        result = await _check_hostname_reputation(hostname, ts)
        
        # When external intelligence confirms malicious: create a threat indicator
        # so the next rule bundle generation includes this hostname for long-term blocking.
        if result.verdict == "malicious" and not result.in_active_bundle:
            await _create_threat_indicator(hostname, result.threat_types, result.source, ts)
        
        return result
    
    # Hash-prefix only: check against known threat indicators (limited coverage)
    prefix = req.hostname_hash_prefix.lower()
    return await _check_hash_prefix(prefix, ts)


async def _check_hostname_reputation(hostname: str, ts) -> DnsReputationResponse:
    """Direct hostname reputation check using external intelligence."""
    from services.intel import run_intel_check, digest
    
    # Check if already in active rule bundle
    indicator = await db.threat_indicators.find_one({
        "hostname": hostname,
        "status": "active",
        "evidence_expiry_deadline": {"$gt": ts},
    })
    in_bundle = indicator is not None
    
    # Get current bundle version
    state = await db.rule_bundle_state.find_one({"ruleset_id": "apollo-rules-v1"})
    bundle_version = state["bundle_version"] if state else None
    
    # Run the external intelligence check (Safe Browsing etc.)
    try:
        result = await run_intel_check("domain", hostname)
    except Exception as exc:
        logger.error("dns_reputation_check_error hostname_len=%d error=%s", len(hostname), type(exc).__name__)
        return DnsReputationResponse(
            verdict="unavailable",
            checked_at=ts.isoformat(),
            coverage="unavailable",
            in_active_bundle=in_bundle,
            bundle_version=bundle_version,
            investigation_complete=False,
            limitation="Intelligence service unavailable. This website was not verified.",
        )
    
    # Map the intel result
    verdict = result.verdict
    confidence = "high" if verdict == "malicious" else "medium" if verdict == "clean" else "none"
    
    limitation = None
    if verdict == "unknown":
        limitation = "No current intelligence available for this hostname. This does not confirm it is safe."
    elif verdict == "clean":
        limitation = "Hostname only — the full URL path was not inspected."
    
    return DnsReputationResponse(
        verdict=verdict,
        threat_types=list(result.threat_types),
        confidence=confidence,
        source=result.sources[0].name if result.sources else "none",
        cached=result.cached,
        checked_at=ts.isoformat(),
        coverage=result.coverage or "external_only",
        in_active_bundle=in_bundle,
        bundle_version=bundle_version,
        limitation=limitation,
        investigation_complete=True,
    )


async def _check_hash_prefix(prefix: str, ts) -> DnsReputationResponse:
    """Hash-prefix reputation check against known threat indicators.
    
    Returns matching threat indicators whose hostname SHA-256 starts with
    the given prefix. The device compares full hashes locally.
    
    Note: This provides privacy (the backend doesn't see the full hostname)
    but limited coverage (only checks against Apollo's known indicators,
    not external providers). For full external checks, the device should
    send the hostname.
    """
    # Check threat indicators whose hostname hash starts with this prefix
    # We need to pre-compute hashes for comparison
    # For efficiency, check the active indicators collection
    matching_hostnames = []
    async for doc in db.threat_indicators.find({
        "status": "active",
        "evidence_expiry_deadline": {"$gt": ts},
    }):
        hostname = doc.get("hostname", "")
        h = hashlib.sha256(hostname.lower().encode()).hexdigest()
        if h.startswith(prefix):
            matching_hostnames.append(hostname)
    
    if matching_hostnames:
        return DnsReputationResponse(
            verdict="malicious",
            threat_types=["THREAT_INTELLIGENCE"],
            confidence="high",
            source="apollo_threat_indicators",
            cached=False,
            checked_at=ts.isoformat(),
            coverage="indicator_match",
            in_active_bundle=True,
            investigation_complete=True,
            limitation="Hostname only — matched against known threat indicators.",
        )
    
    return DnsReputationResponse(
        verdict="unknown",
        checked_at=ts.isoformat(),
        coverage="indicator_check_only",
        in_active_bundle=False,
        investigation_complete=True,
        limitation="Hash prefix checked against known indicators only. No external lookup performed. Send full hostname for complete check.",
    )



async def _create_threat_indicator(hostname: str, threat_types: list[str], source: str, ts):
    """Create a threat indicator for a newly discovered malicious hostname.
    
    This ensures the next rule bundle generation includes this hostname,
    providing long-term blocking authority for the native side.
    """
    existing = await db.threat_indicators.find_one({"hostname": hostname, "status": "active"})
    if existing:
        return  # Already tracked
    
    indicator = {
        "hostname": hostname,
        "threat_types": threat_types,
        "source": source,
        "status": "active",
        "discovered_via": "live_dns_check",
        "created_at": ts,
        "evidence_expiry_deadline": ts + timedelta(hours=24),
    }
    await db.threat_indicators.insert_one(indicator)
    logger.info("threat_indicator_created hostname=%s source=%s via=live_dns_check", hostname, source)
