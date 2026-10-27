"""Cross-source matching: for each website, phone number and email address in a case, what every ApolloSG source says
about it, side by side, with each source's own reference and freshness.

Sources: the free threat lists (services/threat_feeds.py), Google Safe Browsing (from the case's pre-gathered lookups),
ApolloSG's official-domain register and Official Organisation Directory (services/org_directory.py), the official scam
advisories ApolloSG holds, and ApolloSG's own observations (services/observed_intel.py).

It adds two kinds of fact to TC FlyBy's checks, both weak signals (never a concern on their own, alone or together):
- observed: seen in concerning material on THRESHOLD or more separate devices (other than this one) in the last 30 days;
- campaign: seen together, on THRESHOLD or more separate devices, with a website a free threat list lists now.
Everything else is the record Magnum DI receives (teddy/report.magnum_brief) so it doesn't re-derive what is known, and
knows how current each piece is. Nothing here is ever a finding by itself.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from services import observed_intel, org_directory, threat_feeds
from services.higgins.brand_domains import registrable
from services.higgins.teddy.official import fact, official_domain, pregathered, source_ref
from services.higgins.teddy.triage import Plan

log = logging.getLogger("apollo.correlation")
_OBSERVED = "ApolloSG observed intelligence"
_OBSERVED_BASIS = "Counts of separate devices only; no content is kept"


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return value or None


def _row(source: str, status: str, **extra) -> dict:
    return {"source": source, "status": status, **{k: v for k, v in extra.items() if v not in (None, "", [])}}


async def _lists(host: str, urls: list[str]) -> list[dict]:
    fresh = await threat_feeds.fresh_feeds()
    found = []
    for url in urls[:2] or [None]:
        found += await threat_feeds.matches(host, url)
    rows = []
    for name, (label, feed_ids) in threat_feeds.LISTINGS.items():
        if name == "spamhaus_drop":
            continue   # compared by IP address in the link check itself
        hits = [m for m in found if m["source"] in feed_ids]
        if hits:
            hit = hits[0]
            rows.append(_row(label, "listed", detail=hit.get("original_evidence"), reference=hit.get("source_reference"),
                             firstSeen=_iso(hit.get("first_seen_at")), lastConfirmed=_iso(hit.get("last_verified_at")),
                             expires=_iso(hit.get("evidence_expiry_deadline")), url=hit.get("detail_url") or threat_feeds.LIST_PAGES[name]))
        else:
            rows.append(_row(label, "not listed" if any(f in fresh for f in feed_ids) else "not checked (list out of date)"))
    return rows


def _safe_browsing(pg: dict, host: str) -> list[dict]:
    for url, info in pg["safe_browsing"].items():
        if host in url.lower() and info.get("verdict") in ("malicious", "clean"):
            return [_row("Google Safe Browsing", "listed" if info["verdict"] == "malicious" else "not listed",
                         detail=", ".join(info.get("threat_types") or []), lastConfirmed=info.get("queried_at"))]
    return []


async def _observed(check, kind: str, value: str, owner: str, label: str) -> list[dict]:
    rows = []
    seen = await observed_intel.seen(kind, value, exclude=owner)
    if seen:
        rows.append(_row(_OBSERVED, f"seen in concerning material on {seen['devices']} separate devices",
                         firstSeen=_iso(seen["first_seen_at"]), lastConfirmed=_iso(seen["last_seen_at"])))
        check.facts.append(fact(f"ApolloSG has seen {label} in material it found concerning on {seen['devices']} separate devices in the "
                                f"last {observed_intel.WINDOW.days} days.", "weak", topic="observed",
                                source=source_ref(_OBSERVED, authority="independent", basis=_OBSERVED_BASIS)))
    for other in await observed_intel.related(kind, value):
        listed = await threat_feeds.matches(other["name"]) if other["kind"] == "domain" and other.get("name") else []
        lists = list(dict.fromkeys(threat_feeds.LISTINGS[threat_feeds.BY_ID[m["source"]].listing][0] for m in listed))
        rows.append(_row(_OBSERVED, f"seen together with {other.get('name') or 'another ' + other['kind']} on {other['devices']} separate devices"
                         + (f" ({' and '.join(lists)} lists it)" if lists else "")))
        if lists:
            check.facts.append(fact(f"ApolloSG has seen {label} together with {other['name']}, which {' and '.join(lists)} lists, in concerning "
                                    f"material on {other['devices']} separate devices.", "weak", topic="campaign",
                                    source=source_ref(_OBSERVED, authority="independent", basis=_OBSERVED_BASIS)))
    return rows


async def _link(check, plan_: Plan, pg: dict, owner: str) -> dict:
    host = check.subject
    rows = []
    owner_ = official_domain(host)
    if owner_:
        rows.append(_row("ApolloSG official-domain register", f"{owner_[0]}'s official domain"))
    rows += _safe_browsing(pg, host)
    rows += await _lists(host, check.urls)
    domain = registrable(host)
    for match in pg["advisories"] + plan_.advisories:
        if (match.get("matched_on") or "") in (f"domain: {host}", f"domain: {domain}"):
            rows.append(_row("Official scam advisory", "names it", detail=match.get("title")))
    rows += await _observed(check, "domain", host, owner, domain)
    return {"kind": "website", "subject": host, "sources": rows}


async def _contact(check, kind: str, owner: str) -> dict:
    value = check.subject
    rows = []
    hit = org_directory.phone_owner(value) if kind == "phone" else org_directory.email_owner(value)
    if hit:
        rows.append(_row(org_directory.PUBLISHER, f"{hit['name']}'s published {hit.get('label') or 'contact'}", url=hit.get("source_url"),
                         lastConfirmed=_iso(hit.get("confirmed_at"))))
    asic = await threat_feeds.listed(kind, value)
    rows.append(_row("ASIC's investor alert list", "listed", detail=asic[0].get("original_evidence"), url=asic[0].get("detail_url"),
                     lastConfirmed=_iso(asic[0].get("last_verified_at"))) if asic else
                _row("ASIC's investor alert list", "not listed" if "asic-investor-alerts" in await threat_feeds.fresh_feeds() else "not checked (list out of date)"))
    rows += await _observed(check, kind, value, owner, "this number" if kind == "phone" else "this address")
    return {"kind": kind, "subject": value, "sources": rows}


async def cross_source(plan_: Plan, pre_gathered: dict | None, owner: str) -> list[dict]:
    """The cross-source record for the case's websites, numbers and addresses. Adds the observed/campaign weak signals."""
    pg = pregathered(pre_gathered)
    out = []
    for check in plan_.checks:
        try:
            if check.kind == "link":
                out.append(await _link(check, plan_, pg, owner))
            elif check.kind in ("phone", "email"):
                out.append(await _contact(check, check.kind, owner))
        except Exception:  # noqa: BLE001 — the record is extra context; it never breaks an investigation
            log.warning("cross_source_failed kind=%s", check.kind, exc_info=True)
    for entry in out:
        listed = [r for r in entry["sources"] if r["status"] in ("listed", "names it")]
        answered = [r for r in entry["sources"] if not r["status"].startswith("not checked")]
        entry["agreement"] = f"{len(listed)} of {len(answered)} sources that answered list it" if listed else f"none of {len(answered)} sources that answered list it"
    return out


def brief_lines(record: list[dict]) -> str:
    """The record in Magnum DI's brief: each source's own result with its reference and how current it is."""
    lines = []
    for entry in record:
        lines.append(f"- {entry['kind']} {entry['subject']}: {entry['agreement']}.")
        for row in entry["sources"]:
            when = ", ".join(part for part in [f"ref {row['reference']}" if row.get("reference") else "",
                                               f"last confirmed {row['lastConfirmed'][:10]}" if row.get("lastConfirmed") else "",
                                               f"counts until {row['expires'][:10]}" if row.get("expires") else ""] if part)
            lines.append(f"    · {row['source']}: {row['status']}" + (f" — {row['detail'][:160]}" if row.get("detail") else "") + (f" ({when})" if when else ""))
    return "\n".join(lines)
