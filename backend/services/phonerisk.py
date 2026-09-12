"""Call Guard — IPQualityScore phone fraud/spam risk scoring. Proxied entirely server-side: the
IPQS key never reaches the client (see the integration playbook's security guidance). Cached by
normalized E.164 number in Mongo `phone_risk_cache`, mirroring the exact TTL-at-read pattern
services/rdap.py and services/intel.py already use — nothing here is auto-deleted, expiry is just
checked when read.

Truth of State: `decision` is a heuristic/probabilistic classification (IPQS's own ML fraud score),
never deterministic threat intel. It may only ever justify "growling"/"barking" in the app — the ONLY
thing that may produce a verified "biting" call-block PatrolEvent is the device's own
CallScreeningService actually rejecting a real call, with EnforcementEvidence attached
(mechanism="call_screening") — see routers/patrol.py::_derive_verified_block. This module never
claims to have blocked anything; it only scores.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import phonenumbers
from fastapi import HTTPException

from core.config import IPQS_API_KEY, IPQS_ENDPOINT, logger
from core.db import db, now_utc
from core.models import CallRiskResponse, PhoneRiskCache

CACHE_TTL = timedelta(hours=24)  # IPQS risk/abuse signals change; don't cache indefinitely


def normalize_phone(raw: str, country: Optional[str]) -> str:
    """E.164 or raise 422 — mirrors the playbook's normalize_phone(); a local number needs a country."""
    try:
        region = None if raw.strip().startswith("+") else (country.upper() if country else None)
        parsed = phonenumbers.parse(raw, region)
        if not phonenumbers.is_possible_number(parsed):
            raise ValueError("impossible number")
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail="Provide a valid phone number (and a 2-letter country code for local numbers).") from exc


def _decision(data: dict) -> str:
    """Conservative, honest thresholds — matches the IPQS-recommended risky(>=85)/high(>=90) bands.
    Never "block": see module docstring. `None`/unknown fields are treated as unknown, never as safe."""
    if data.get("recent_abuse") is True or (data.get("fraud_score") or 0) >= 90:
        return "avoid"
    if (data.get("fraud_score") or 0) >= 85 or data.get("risky") is True:
        return "review"
    return "allow"


async def _query_ipqs(phone_e164: str) -> dict:
    # IPQS's Phone Validation API takes the key as a URL path segment, not a header (verified against
    # the live API — the documented IPQS-KEY header form was rejected with "Invalid or unauthorized key").
    number = phone_e164.lstrip("+")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as http:
            resp = await http.get(f"{IPQS_ENDPOINT}/{IPQS_API_KEY}/{number}", params={"strictness": 0})
        resp.raise_for_status()
        data = resp.json()
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        raise HTTPException(status_code=503, detail="Phone risk provider is temporarily unavailable.") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Phone risk provider returned an error.") from exc
    if not isinstance(data, dict) or data.get("success") is not True:
        raise HTTPException(status_code=422, detail=str(data.get("message", "Phone risk lookup failed.")) if isinstance(data, dict) else "Phone risk lookup failed.")
    return data


async def check_phone_risk(raw_number: str, country: Optional[str]) -> CallRiskResponse:
    phone = normalize_phone(raw_number, country)
    ts = now_utc()
    if not IPQS_API_KEY:
        return CallRiskResponse(number=phone, decision="allow", cached=False, checked_at=ts, source="not_configured")

    cached = await db.phone_risk_cache.find_one({"phone_e164": phone})
    if cached:
        rc = PhoneRiskCache.from_mongo(cached)
        if rc.expires_at.replace(tzinfo=timezone.utc) > ts:
            return CallRiskResponse(
                number=phone, valid=rc.valid, active=rc.active, fraud_score=rc.fraud_score, recent_abuse=rc.recent_abuse,
                risky=rc.risky, voip=rc.voip, line_type=rc.line_type, carrier=rc.carrier, country=rc.country,
                decision=_decision(rc.model_dump()), cached=True, checked_at=rc.checked_at, source="ipqualityscore",  # type: ignore[arg-type]
            )

    try:
        data = await _query_ipqs(phone)
    except HTTPException:
        # A dead/rejected provider must never be silently read as "safe" — surface the failure so the
        # UI can show "couldn't check" rather than a false "allow". No fallback score is fabricated.
        raise

    record = PhoneRiskCache(
        phone_e164=phone, valid=data.get("valid"), active=data.get("active"), fraud_score=data.get("fraud_score"),
        recent_abuse=data.get("recent_abuse"), risky=data.get("risky"), voip=data.get("VOIP"),
        line_type=data.get("line_type"), carrier=data.get("carrier"), country=data.get("country"),
        checked_at=ts, expires_at=ts + CACHE_TTL,
    )
    await db.phone_risk_cache.update_one({"phone_e164": phone}, {"$set": record.to_mongo()}, upsert=True)
    logger.info("phone risk checked (score=%s, decision=%s)", record.fraud_score, _decision(record.model_dump()))
    return CallRiskResponse(
        number=phone, valid=record.valid, active=record.active, fraud_score=record.fraud_score, recent_abuse=record.recent_abuse,
        risky=record.risky, voip=record.voip, line_type=record.line_type, carrier=record.carrier, country=record.country,
        decision=_decision(record.model_dump()), cached=False, checked_at=ts, source="ipqualityscore",  # type: ignore[arg-type]
    )
