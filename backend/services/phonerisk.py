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

from datetime import timezone
from typing import Optional

import asyncio
import httpx
import phonenumbers
from fastapi import HTTPException

from core.config import IPQS_API_KEY, IPQS_ENDPOINT, logger
from core.db import db, now_utc
from core.models import CallRiskResponse, PhoneRiskCache
from services import reusable_intel

CACHE_TTL = reusable_intel.TTL["phone_reputation"]  # IPQS risk/abuse signals change; don't cache indefinitely
SITE = "ipqs_phone"  # this call site, in the reuse counters
MAX_RETRIES = 2                  # retry up to 2 more times on transient failures
RETRY_BACKOFF = 1.0              # seconds; doubled each retry


def _mask_phone(e164: str) -> str:
    """Mask all but the last 3 digits for operational logs. '+61412345678' → '+61*****678'."""
    if len(e164) <= 4:
        return "***"
    return e164[:3] + "*" * (len(e164) - 6) + e164[-3:]


def _higgins(decision: str, data: dict) -> dict:
    score = data.get("fraud_score")
    if decision == "avoid":
        found = "The number has strong reputation signals associated with fraud or recent abuse."
        action = "Do not return the call using this number. Find the organisation's number in its official app or website."
    elif decision == "review":
        found = "The number has some reputation signals worth checking, but ApolloSG cannot establish who is calling."
        action = "Let the call go to voicemail, then verify the caller using an independently sourced number."
    elif decision == "unknown":
        found = "ApolloSG could not obtain reputation information for this number. This does not mean the number is safe or dangerous."
        action = "If the call was unexpected, verify the caller independently before sharing personal information or sending money."
    else:
        found = "The current reputation check did not find strong abuse signals for this number."
        action = "If the call was unexpected, verify the caller independently before sharing information or sending money."
    return {"headline": "Verify the caller independently", "found": found,
            "why": f"Caller ID can be spoofed. A fraud score of {score}/100 is reputation evidence, not proof of identity." if score is not None else
                   "Caller ID can be spoofed, and reputation data was unavailable or incomplete.",
            "could_not_establish": "Apollo could not authenticate the person or organisation behind the number.",
            "next_action": action,
            "exact_response": f"{found} {action}",
            "warning_only": True}


def normalize_phone(raw: str, country: Optional[str]) -> str:
    """E.164 or raise 422 — mirrors the playbook's normalize_phone(); a local number needs a country.
    When no country hint is provided for a local number, tries common regions (AU, US, GB) before failing."""
    stripped = raw.strip()
    if stripped.startswith("+"):
        # International format — no region hint needed
        try:
            parsed = phonenumbers.parse(stripped, None)
            if not phonenumbers.is_possible_number(parsed):
                raise ValueError("impossible number")
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail="Provide a valid phone number.") from exc

    # Local number — try the supplied country first, then common fallbacks
    regions_to_try: list[str] = []
    if country:
        regions_to_try.append(country.upper())
    # Common regions the app supports — try each until one parses as a possible number
    for fallback in ("AU", "US", "GB", "NZ", "CA"):
        if fallback not in regions_to_try:
            regions_to_try.append(fallback)

    for region in regions_to_try:
        try:
            parsed = phonenumbers.parse(stripped, region)
            if phonenumbers.is_possible_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except Exception:  # noqa: BLE001
            continue

    raise HTTPException(status_code=422, detail="Provide a valid phone number (with country code like +61 for AU or +1 for US).")


def _decision(data: dict) -> str:
    """Conservative, honest thresholds — matches the IPQS-recommended risky(>=85)/high(>=90) bands.
    Never "block": see module docstring. `None`/unknown fields are treated as unknown, never as safe."""
    if data.get("recent_abuse") is True or (data.get("fraud_score") or 0) >= 90:
        return "avoid"
    if (data.get("fraud_score") or 0) >= 85 or data.get("risky") is True:
        return "review"
    return "allow"


class PhoneLookupFailed(HTTPException):
    """IPQS gave no usable answer. `failure` says how (the same codes the phone uses): timeout,
    provider_unavailable, server_error, rate_limited, quota_exhausted, auth_failure, rejected, malformed."""

    def __init__(self, failure: str, detail: str):
        super().__init__(status_code=503, detail=detail)
        self.failure = failure


def _answer_failure(message: str) -> str:
    """IPQS answered success=false: why, from its message ("You have insufficient credits…", "Invalid key…")."""
    text = (message or "").lower()
    if any(word in text for word in ("credit", "quota", "exceeded", "insufficient")):
        return "quota_exhausted"
    if any(word in text for word in ("invalid key", "invalid or unauthorized", "unauthorized", "api key")):
        return "auth_failure"
    return "rejected"


async def _query_ipqs(phone_e164: str) -> dict:
    """Query IPQS with automatic retry on transient failures (timeout, network error, 5xx).
    Raises PhoneLookupFailed with the failure kind; quota, authorisation and rejected input are never retried."""
    number = phone_e164.lstrip("+")
    last: PhoneLookupFailed | None = None
    for attempt in range(1 + MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0)) as http:
                resp = await http.get(f"{IPQS_ENDPOINT}/{IPQS_API_KEY}/{number}", params={"strictness": 0})
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            last = PhoneLookupFailed("timeout", "Phone risk provider did not answer in time.")
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code < 500:
                kind = "rate_limited" if code == 429 else "auth_failure" if code in (401, 403) else "rejected"
                raise PhoneLookupFailed(kind, "Phone risk provider refused the lookup.") from exc
            last = PhoneLookupFailed("server_error", "Phone risk provider returned an error.")
        except httpx.RequestError:
            last = PhoneLookupFailed("provider_unavailable", "Phone risk provider could not be reached.")
        except ValueError as exc:
            raise PhoneLookupFailed("malformed", "Phone risk provider sent an unreadable answer.") from exc
        else:
            if not isinstance(data, dict):
                raise PhoneLookupFailed("malformed", "Phone risk provider sent an unreadable answer.")
            if data.get("success") is not True:
                raise PhoneLookupFailed(_answer_failure(str(data.get("message", ""))), "Phone risk lookup failed.")
            return data
        if attempt < MAX_RETRIES:
            wait = RETRY_BACKOFF * (2 ** attempt)
            logger.warning("IPQS attempt %d/%d failed (%s), retrying in %.1fs", attempt + 1, 1 + MAX_RETRIES, last.failure, wait)
            await asyncio.sleep(wait)
    logger.error("IPQS all %d attempts failed for %s: %s", 1 + MAX_RETRIES, _mask_phone(phone_e164), last.failure if last else "?")
    raise last or PhoneLookupFailed("provider_unavailable", "Phone risk provider is temporarily unavailable.")


def _from_cache(phone: str, rc: PhoneRiskCache, *, freshness: str, failure: Optional[str] = None) -> CallRiskResponse:
    return CallRiskResponse(
        number=phone, valid=rc.valid, active=rc.active, fraud_score=rc.fraud_score, recent_abuse=rc.recent_abuse,
        risky=rc.risky, voip=rc.voip, line_type=rc.line_type, carrier=rc.carrier, country=rc.country,
        decision=_decision(rc.model_dump()), cached=True, checked_at=rc.checked_at, source="ipqualityscore",  # type: ignore[arg-type]
        freshness=freshness, failure=failure,  # type: ignore[arg-type]
        higgins=_higgins(_decision(rc.model_dump()), rc.model_dump()),
    )


async def check_phone_risk(raw_number: str, country: Optional[str], *, persist_cache: bool = True) -> CallRiskResponse:
    """A current cached score is used before any lookup credit is spent. If the live lookup fails, the last
    known score is returned marked `freshness="stale"` with the failure kind — never as a fresh lookup.
    `persist_cache=False` reads the cache but doesn't write this lookup to it."""
    phone = normalize_phone(raw_number, country)
    ts = now_utc()
    if not IPQS_API_KEY:
        data = {"fraud_score": None}
        return CallRiskResponse(number=phone, decision="unknown", cached=False, checked_at=ts, source="not_configured",
                                failure="not_configured", higgins=_higgins("unknown", data))

    cached = await db.phone_risk_cache.find_one({"phone_e164": phone})
    if cached:
        rc = PhoneRiskCache.from_mongo(cached)
        if rc.expires_at.replace(tzinfo=timezone.utc) > ts:
            await reusable_intel.count(SITE, "cache_hit", "sufficiency_known", "external_call_avoided")
            return _from_cache(phone, rc, freshness="cached")

    await reusable_intel.count(SITE, *(("cache_expired", "sufficiency_partial") if cached else ("sufficiency_unknown",)), "external_call_required")
    try:
        data = await _query_ipqs(phone)
    except HTTPException as exc:
        failure = getattr(exc, "failure", "provider_unavailable")
        # Last known good: the earlier score, marked stale with why the live lookup failed.
        if cached:
            rc = PhoneRiskCache.from_mongo(cached)
            logger.warning("IPQS failed for %s (%s) — returning stale cache (checked_at=%s)", _mask_phone(phone), failure, rc.checked_at)
            return _from_cache(phone, rc, freshness="stale", failure=failure)
        # No earlier score — an honest "unknown" with the failure kind, never "allow".
        logger.error("IPQS failed for %s (%s) — no cache available, returning unknown", _mask_phone(phone), failure)
        data_unknown: dict = {"fraud_score": None}
        return CallRiskResponse(
            number=phone, decision="unknown", cached=False, checked_at=ts, source="unavailable", failure=failure,
            higgins=_higgins("unknown", data_unknown),
        )

    record = PhoneRiskCache(
        phone_e164=phone, valid=data.get("valid"), active=data.get("active"), fraud_score=data.get("fraud_score"),
        recent_abuse=data.get("recent_abuse"), risky=data.get("risky"), voip=data.get("VOIP"),
        line_type=data.get("line_type"), carrier=data.get("carrier"), country=data.get("country"),
        checked_at=ts, expires_at=ts + CACHE_TTL,
    )
    if persist_cache:
        await db.phone_risk_cache.update_one({"phone_e164": phone}, {"$set": record.to_mongo()}, upsert=True)
        await reusable_intel.count(SITE, "cache_write")
    logger.info("phone risk checked (score=%s, decision=%s)", record.fraud_score, _decision(record.model_dump()))
    return CallRiskResponse(
        number=phone, valid=record.valid, active=record.active, fraud_score=record.fraud_score, recent_abuse=record.recent_abuse,
        risky=record.risky, voip=record.voip, line_type=record.line_type, carrier=record.carrier, country=record.country,
        decision=_decision(record.model_dump()), cached=False, checked_at=ts, source="ipqualityscore",  # type: ignore[arg-type]
        higgins=_higgins(_decision(record.model_dump()), record.model_dump()),
    )
