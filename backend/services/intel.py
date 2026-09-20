"""Reputation intelligence: blocklist + Google Safe Browsing, HMAC digest cache, redirect expansion."""
from __future__ import annotations

import asyncio
import hmac
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import HTTPException

from core.config import SAFE_BROWSING_API_KEY, SB_ENDPOINT, SB_THREAT_TYPES, URL_HMAC_SECRET, logger
from core.db import db, now_utc
from core.models import BlocklistEntry, IntelCheckResponse, IntelSource, ReputationCache, Verdict
from services.rdap import lookup_domain_cached
from services.outbound import public_stream, REDIRECTS

def digest(value: str) -> str:
    return hmac.new(URL_HMAC_SECRET.encode(), value.encode(), sha256).hexdigest()


def sanitize_url(raw: str) -> tuple[str, str]:
    """Strip credentials and fragments; return (url, host). Validation only, no canonicalisation games."""
    candidate = raw if "://" in raw else f"https://{raw}"
    try:
        parsed = urlparse(candidate)
        hostname, port = parsed.hostname, parsed.port
    except ValueError:
        raise HTTPException(status_code=422, detail="Only http/https links can be checked")
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise HTTPException(status_code=422, detail="Only http/https links can be checked")
    host = hostname.lower()
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    clean = urlunparse((parsed.scheme, netloc, "/", "", "", ""))
    return clean, host


def host_matches(host: str, entry_host: str) -> bool:
    return host == entry_host or host.endswith("." + entry_host)


async def blocklist_check(host: str) -> IntelSource:
    entries = await db.blocklist.find({"deleted_at": None}).to_list(5000)
    for raw in entries:
        entry = BlocklistEntry.from_mongo(raw)
        if host_matches(host, entry.host):
            return IntelSource(
                name="apollo_blocklist",
                status="match",
                detail=f"Domain is on Apollo's managed threat list ({entry.reason}).",
                threat_types=[entry.threat_type],
            )
    return IntelSource(name="apollo_blocklist", status="clear", detail="Not on Apollo's managed threat list.")


_sb_probe: dict[str, Any] = {"status": None, "checked_at": None, "detail": ""}


async def safe_browsing_lookup(url: str) -> tuple[IntelSource, Optional[datetime]]:
    if not SAFE_BROWSING_API_KEY:
        return IntelSource(name="google_safe_browsing", status="not_configured", detail="No Safe Browsing key configured."), None
    # Short-circuit while the key is known-bad (re-probed every 10 minutes) to avoid hammering Google.
    if _sb_probe["status"] == "auth_error" and _sb_probe["checked_at"] and now_utc() - _sb_probe["checked_at"] < timedelta(minutes=10):
        return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing key was rejected; reputation check unavailable."), None
    payload = {
        "client": {"clientId": "apollo-v1", "clientVersion": "1.0"},
        "threatInfo": {
            "threatTypes": SB_THREAT_TYPES,
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": url}],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.post(SB_ENDPOINT, params={"key": SAFE_BROWSING_API_KEY}, json=payload)
        if resp.status_code in (401, 403):
            _sb_probe.update(status="auth_error", checked_at=now_utc(), detail="Key rejected by Google Safe Browsing.")
            return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing key was rejected; reputation check unavailable."), None
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        _sb_probe.update(status="unreachable", checked_at=now_utc(), detail="Safe Browsing did not respond.")
        return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing did not respond in time."), None
    if not isinstance(data, dict) or not isinstance(data.get("matches", []), list):
        # Malformed answer (wrong shape) is rejected — degrade to "unavailable", never read it as "clear".
        _sb_probe.update(status="unreachable", checked_at=now_utc(), detail="Safe Browsing answer was malformed.")
        return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing sent an unreadable answer."), None
    _sb_probe.update(status="ok", checked_at=now_utc(), detail="Safe Browsing reachable.")
    matches = [m for m in data.get("matches", []) if isinstance(m, dict)]
    if matches:
        threats = sorted({str(m.get("threatType", "UNKNOWN")) for m in matches})
        seconds = 300
        try:
            seconds = max(60, int(str(matches[0].get("cacheDuration", "300s")).rstrip("s").split(".")[0]))
        except ValueError:
            pass
        return (
            IntelSource(name="google_safe_browsing", status="match", detail="Listed as unsafe by Google Safe Browsing.", threat_types=threats),
            now_utc() + timedelta(seconds=seconds),
        )
    return IntelSource(name="google_safe_browsing", status="clear", detail="No current Safe Browsing listing."), None


def combine(sources: list[IntelSource]) -> tuple[Verdict, list[str], str]:
    threats = sorted({t for s in sources for t in s.threat_types})
    if any(s.status == "match" for s in sources):
        return "malicious", threats, "full" if all(s.status in ("match", "clear") for s in sources) else "partial"
    clear = [s for s in sources if s.status == "clear"]
    if len(clear) == len(sources):
        return "clean", [], "full"
    if clear:
        return "unknown", [], "partial"
    return "unknown", [], "none"


async def expand_redirects(url: str, max_hops: int = 5) -> list[str]:
    """Follow HTTP redirects without downloading bodies. Returns the URL chain (first → final)."""
    chain = [url]
    try:
        async with asyncio.timeout(12):
            cur = url
            for _ in range(min(max_hops, 5)):
                async with public_stream("HEAD", cur) as resp:
                    status, loc = resp.status_code, resp.headers.get("location")
                if status in (405, 403, 400):
                    # Headers only; close without buffering any GET body.
                    async with public_stream("GET", cur) as resp:
                        status, loc = resp.status_code, resp.headers.get("location")
                if status not in REDIRECTS or not loc:
                    break
                nxt = str(httpx.URL(cur).join(loc))
                if nxt in chain:
                    break
                chain.append(nxt)
                cur = nxt
    except Exception as exc:  # noqa: BLE001
        logger.info("redirect expansion stopped: %s", type(exc).__name__)
    return chain


async def run_intel_check(indicator_type: str, value: str) -> IntelCheckResponse:
    url, host = sanitize_url(value)
    indicator = host if indicator_type == "domain" else url
    dg = digest(indicator)
    ts = now_utc()
    cached = await db.reputation_cache.find_one({"indicator_digest": dg})
    if cached:
        rc = ReputationCache.from_mongo(cached)
        if rc.expires_at.replace(tzinfo=timezone.utc) > ts:
            return IntelCheckResponse(
                verdict=rc.verdict, threat_types=rc.threat_types, sources=[IntelSource(**s) for s in rc.sources],
                indicator_digest=dg, checked_at=rc.checked_at, cached=True, coverage=rc.coverage,  # type: ignore[arg-type]
            )
    sources = [await blocklist_check(host)]
    sb_source, sb_expiry = await safe_browsing_lookup(url if indicator_type == "url" else f"http://{host}/")
    sources.append(sb_source)
    verdict, threats, coverage = combine(sources)
    expires = sb_expiry or (ts + timedelta(minutes=5 if verdict != "unknown" else 1))
    record = ReputationCache(
        indicator_digest=dg, verdict=verdict, threat_types=threats, sources=[s.model_dump() for s in sources],
        coverage=coverage, checked_at=ts, expires_at=expires,
    )
    await db.reputation_cache.update_one({"indicator_digest": dg}, {"$set": record.to_mongo()}, upsert=True)
    return IntelCheckResponse(
        verdict=verdict, threat_types=threats, sources=sources, indicator_digest=dg, checked_at=ts, cached=False, coverage=coverage  # type: ignore[arg-type]
    )


async def assess_indicator(indicator_type: str, value: str, expand: bool) -> IntelCheckResponse:
    """The full check: blocklist + Safe Browsing verdict, optional redirect-chain expansion (URLs
    only), and a best-effort/parallel RDAP domain-info lookup (see services/rdap.py) — never gates
    the verdict. This is THE shared assessment used by both POST /intel/check (Check a Link) and
    POST /message/analyse (Email/Text Guard's automatic per-link pre-click assessment), so every
    link checked anywhere in the app gets the exact same treatment. Pure extraction of the previous
    /intel/check body — behaviour for that endpoint is unchanged."""
    if indicator_type == "url":
        try:
            initial_host: Optional[str] = sanitize_url(value)[1]
        except HTTPException:
            initial_host = None
    else:
        initial_host = value.strip().lower() or None
    domain_task = asyncio.create_task(lookup_domain_cached(initial_host)) if initial_host else None

    async def _await_domain():
        if not domain_task:
            return None
        try:
            return await asyncio.wait_for(domain_task, timeout=6.0)
        except Exception:  # noqa: BLE001
            return None

    if not expand or indicator_type != "url":
        result = await run_intel_check(indicator_type, value)
        return result.model_copy(update={"domain_info": await _await_domain()})
    # Bounded as a whole: a slow redirect chain must never hold the check hostage — judge the link as given instead.
    try:
        chain = await asyncio.wait_for(expand_redirects(value), timeout=12)
    except asyncio.TimeoutError:
        chain = [value]
    final = chain[-1]
    # Judge the final destination; any confirmed-malicious hop along the way also counts.
    result = await run_intel_check("url", final)
    threat_types, sources, verdict = list(result.threat_types), list(result.sources), result.verdict
    for hop in chain[:-1]:
        try:
            r = await run_intel_check("url", hop)
        except HTTPException:
            continue
        if r.verdict == "malicious":
            verdict = "malicious"; threat_types = sorted(set(threat_types + r.threat_types))
    hosts = []
    for u in chain:
        try:
            hosts.append(sanitize_url(u)[1])
        except HTTPException:
            hosts.append(urlparse(u).hostname or u)
    return IntelCheckResponse(verdict=verdict, threat_types=threat_types, sources=sources, indicator_digest=result.indicator_digest, checked_at=result.checked_at, cached=result.cached,
                              coverage=result.coverage, redirect_chain=hosts if len(chain) > 1 else [], final_url=final if len(chain) > 1 else None,
                              domain_info=await _await_domain())
