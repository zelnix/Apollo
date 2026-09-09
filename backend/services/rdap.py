"""RDAP domain lookup: IANA bootstrap -> authoritative registry. No API key required.

Best-effort only, by design: a slow, missing or malformed RDAP answer must NEVER affect the
malicious/clean verdict computed in services/intel.py — it only adds registrar/registration-date
context and a "newly registered" scam signal. Every exception is caught here; callers always get
back a DomainInfo (possibly marked unavailable) or None, never a raised error.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

import httpx

from core.config import logger
from core.db import db, now_utc
from core.models import DomainInfo, DomainInfoCache

IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json"
RDAP_TIMEOUT = httpx.Timeout(connect=3.0, read=5.0, write=3.0, pool=3.0)
CACHE_TTL = timedelta(hours=48)
NEWLY_REGISTERED_DAYS = 30

# IANA's bootstrap only lists single-label TLDs. A handful of registries delegate registration one
# label deeper (e.g. example.co.uk, not example.uk). No full public-suffix list here — a pragmatic
# MVP set covering the most common cases; unusual ones may resolve to the wrong apex domain.
_TWO_LABEL_SUFFIXES = {
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
    "co.nz", "org.nz", "co.jp", "co.in", "co.za", "com.au", "net.au", "org.au",
    "com.br", "com.cn", "co.kr", "com.mx", "co.id",
}

_bootstrap_cache: dict[str, Any] = {"data": None, "expires_at": datetime.min.replace(tzinfo=timezone.utc)}
_bootstrap_lock = asyncio.Lock()


def registrable_domain(host: str) -> str:
    """Best-effort eTLD+1 guess so RDAP is queried on the registered domain, not an arbitrary
    subdomain (e.g. mail.example.com -> example.com)."""
    labels = [l for l in host.lower().strip(".").split(".") if l]
    if len(labels) <= 2:
        return ".".join(labels)
    last_two = ".".join(labels[-2:])
    if last_two in _TWO_LABEL_SUFFIXES and len(labels) >= 3:
        return ".".join(labels[-3:])
    return last_two


async def _get_bootstrap(http: httpx.AsyncClient) -> dict:
    now = now_utc()
    if _bootstrap_cache["data"] and now < _bootstrap_cache["expires_at"]:
        return _bootstrap_cache["data"]
    async with _bootstrap_lock:
        if _bootstrap_cache["data"] and now_utc() < _bootstrap_cache["expires_at"]:
            return _bootstrap_cache["data"]
        resp = await http.get(IANA_BOOTSTRAP_URL)
        resp.raise_for_status()
        data = resp.json()
        _bootstrap_cache["data"] = data
        _bootstrap_cache["expires_at"] = now_utc() + timedelta(hours=24)
        return data


async def _base_url_for(domain: str, http: httpx.AsyncClient) -> Optional[str]:
    """Right-to-left, longest-suffix match against the IANA bootstrap registry (RFC 9224)."""
    data = await _get_bootstrap(http)
    best: Optional[tuple[int, list]] = None
    for service in data.get("services", []):
        if not isinstance(service, list) or len(service) < 2:
            continue
        suffixes, bases = service[0], service[1]
        for suffix in suffixes:
            s = str(suffix).rstrip(".").lower()
            if domain == s or domain.endswith("." + s):
                depth = len(s.split("."))
                if not best or depth > best[0]:
                    best = (depth, bases)
    if not best:
        return None
    for base in best[1]:
        if str(base).startswith("https://"):
            return str(base).rstrip("/") + "/"
    return None


def _vcard_value(entity: dict, field: str) -> Optional[str]:
    """jCard: ["vcard", [[property, params, type, value], ...]]."""
    card = entity.get("vcardArray")
    if not isinstance(card, list) or len(card) < 2 or not isinstance(card[1], list):
        return None
    for item in card[1]:
        if isinstance(item, list) and len(item) >= 4 and str(item[0]).lower() == field:
            value = item[3]
            if isinstance(value, list):
                value = " ".join(str(x) for x in value if x)
            value = str(value).strip()
            if value:
                return value
    return None


def _parse_rdap(domain: str, body: dict, base: str) -> DomainInfo:
    entities = body.get("entities") if isinstance(body.get("entities"), list) else []
    registrar_entity = next((e for e in entities if isinstance(e, dict) and "registrar" in (e.get("roles") or [])), None)
    registrant_entity = next((e for e in entities if isinstance(e, dict) and "registrant" in (e.get("roles") or [])), None)
    events = body.get("events") if isinstance(body.get("events"), list) else []
    # Only the domain-level "registration" event counts — never "last changed" or "expiration".
    reg_event = next((e for e in events if isinstance(e, dict) and str(e.get("eventAction", "")).lower() == "registration"), None)
    registered_at = None
    if reg_event and reg_event.get("eventDate"):
        try:
            registered_at = datetime.fromisoformat(str(reg_event["eventDate"]).replace("Z", "+00:00"))
        except ValueError:
            registered_at = None
    registrar = None
    if registrar_entity:
        registrar = _vcard_value(registrar_entity, "fn") or _vcard_value(registrar_entity, "org")
    registrant_org = _vcard_value(registrant_entity, "org") if registrant_entity else None
    return DomainInfo(domain=domain, registrar=registrar, registered_at=registered_at, registrant_organization=registrant_org, rdap_server=base, available=True)


async def _fetch_live(domain: str) -> DomainInfo:
    async with httpx.AsyncClient(timeout=RDAP_TIMEOUT, headers={"Accept": "application/rdap+json, application/json", "User-Agent": "ApolloV1-RDAP/1.0"}, follow_redirects=True) as http:
        base = await _base_url_for(domain, http)
        if not base:
            return DomainInfo(domain=domain, available=False, error="no_authoritative_service")
        resp = await http.get(f"{base}domain/{quote(domain, safe='.')}")
        if resp.status_code == 404:
            return DomainInfo(domain=domain, available=False, error="not_found")
        resp.raise_for_status()
        return _parse_rdap(domain, resp.json(), base)


def _with_age(info: DomainInfo) -> DomainInfo:
    if info.registered_at:
        reg = info.registered_at if info.registered_at.tzinfo else info.registered_at.replace(tzinfo=timezone.utc)
        age_days = (now_utc() - reg).days
        info.age_days = age_days
        info.newly_registered = 0 <= age_days < NEWLY_REGISTERED_DAYS
    return info


async def lookup_domain_cached(host: Optional[str]) -> Optional[DomainInfo]:
    """Mongo-cached (48h) RDAP lookup for the registrable domain behind `host`. Never raises."""
    if not host:
        return None
    domain = registrable_domain(host)
    if not domain or "." not in domain:
        return None
    try:
        now = now_utc()
        cached = await db.domain_info_cache.find_one({"domain": domain})
        if cached:
            dc = DomainInfoCache.from_mongo(cached)
            if dc.expires_at.replace(tzinfo=timezone.utc) > now:
                return _with_age(DomainInfo(domain=dc.domain, registrar=dc.registrar, registered_at=dc.registered_at, registrant_organization=dc.registrant_organization, rdap_server=dc.rdap_server, available=dc.available, error=dc.error))
        info = await _fetch_live(domain)
        record = DomainInfoCache(domain=domain, registrar=info.registrar, registered_at=info.registered_at, registrant_organization=info.registrant_organization, rdap_server=info.rdap_server, available=info.available, error=info.error, checked_at=now, expires_at=now + CACHE_TTL)
        await db.domain_info_cache.update_one({"domain": domain}, {"$set": record.to_mongo()}, upsert=True)
        return _with_age(info)
    except Exception as exc:  # noqa: BLE001 — best-effort by contract; never propagate to the verdict path.
        logger.info("rdap lookup failed: %s", type(exc).__name__)
        return DomainInfo(domain=domain, available=False, error="lookup_failed")
