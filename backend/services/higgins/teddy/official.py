"""TC FlyBy stage 1 — direct and authoritative sources.

Every lookup here is a direct check against the source that holds the answer: Apollo's blocklist and
Google Safe Browsing (cached in reputation_cache), the domain registry's RDAP record, Apollo's register of
official government and organisation domains, the official scam-advisory feeds Apollo already holds, the
ABR/ASIC check-digit algorithms, and any specialist results Higgins Triage already gathered for the case.
No AI is involved. A lookup that fails is recorded as unavailable — never as safe.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from services import kb_sources
from services.higgins.indicators import BRANDS
from services.higgins.teddy.triage import FREE_MAIL, Check, Plan, abn_valid, acn_valid, registrable

LOOKUP_SECONDS = 8.0


def fact(text: str, signal: str, *, decisive: bool = False, kind: str = "live_evidence", source: dict | None = None,
         topic: str | None = None) -> dict:
    """One statement Teddy established. `kind` keeps live evidence apart from Apollo knowledge (never a finding).
    `signal`: concern | anomaly | clear | neutral | missing (looked up, not established) | context (knowledge)."""
    return {"text": text, "signal": signal, "decisive": decisive, "class": kind, "source": source, "topic": topic}


def source_ref(publisher: str, *, url: str | None = None, authority: str = "official", basis: str = "", retrieval: str = "fetched",
            checked_at: str | None = None) -> dict:
    return {"publisher": publisher, "url": url, "authority": authority, "basis": basis, "retrieval": retrieval,
            "checkedAt": checked_at or datetime.now(timezone.utc).isoformat()}


# ── Network lookups (each one replaceable in bounded tests) ─────────────────
async def lookup_url(url: str) -> dict | None:
    """Apollo blocklist + Google Safe Browsing verdict for one URL."""
    from services import intel
    try:
        result = await asyncio.wait_for(intel.run_intel_check("url", url), timeout=LOOKUP_SECONDS)
    except Exception:  # noqa: BLE001 — an unchecked URL is unavailable, never clean
        return None
    return {"verdict": result.verdict, "threatTypes": list(result.threat_types), "coverage": result.coverage,
            "sources": [s.model_dump() for s in result.sources], "checkedAt": result.checked_at.isoformat()}


async def lookup_domain(domain: str) -> dict | None:
    """The domain registry's RDAP registration record."""
    from services import rdap
    try:
        info = await asyncio.wait_for(rdap.lookup_domain_cached(domain), timeout=LOOKUP_SECONDS)
    except Exception:  # noqa: BLE001
        return None
    if not info or not info.available or info.error:
        return None
    return {"registeredAt": info.registered_at.isoformat() if info.registered_at else None, "ageDays": info.age_days,
            "registrar": info.registrar, "newlyRegistered": info.newly_registered}


async def advisories(hosts: list[str], sender_domain: str, text: str) -> list[dict]:
    """Official scam advisories Apollo already holds that name one of these domains (or describe this scam)."""
    from services.triage_engine import _match_scam_intel
    try:
        return await _match_scam_intel({"link_domains": hosts, "sender_domain": sender_domain, "text_preview": text[:2000]})
    except Exception:  # noqa: BLE001
        return []


# ── Reading what Higgins Triage already gathered for the case ────────────────
def pregathered(pe: dict | None) -> dict:
    pe = pe or {}
    return {"safe_browsing": (pe.get("safe_browsing") or {}).get("urls") or {},
            "rdap": (pe.get("rdap") or {}).get("domains") or {},
            "redirects": (pe.get("redirects") or {}).get("urls") or {},
            "ipqs_urls": (pe.get("ipqs") or {}).get("urls") or {},
            "ipqs_phones": (pe.get("ipqs") or {}).get("phones") or {},
            "downloads": (pe.get("download_links") or {}).get("items") or [],
            "advisories": (pe.get("scam_intel") or {}).get("matches") or []}


KNOWN_SECTIONS = {"safe_browsing", "rdap", "redirects", "ipqs", "download_links", "scam_intel", "_summary", "hibp"}


def unread_sections(pe: dict | None) -> dict:
    """Pre-gathered results Teddy has no reader for. They are passed on verbatim so nothing is lost."""
    out = {}
    for key, value in (pe or {}).items():
        if key not in KNOWN_SECTIONS:
            out[key] = value
        elif key in ("safe_browsing", "rdap", "redirects") and isinstance(value, dict) and not any(k in value for k in ("urls", "domains")):
            out[key] = value
    return out


def official_domain(host: str) -> tuple[str, str] | None:
    """(publisher, basis) when the host belongs to an official government/organisation domain on Apollo's register."""
    source = kb_sources.source_for(f"https://{host}")
    if source and source.tier == kb_sources.TIER_1:
        return source.publisher, "ApolloSG's register of official government and regulator domains"
    for name, domain in BRANDS.values():
        if registrable(host) == registrable(domain):
            return name, f"{name}'s published domain ({domain}) on ApolloSG's register of organisation domains"
    return None


def _sb_publisher(sources: list[dict]) -> str:
    names = []
    for s in sources:
        if s.get("status") != "match":
            continue
        name = (s.get("name") or "").lower()
        names.append("Google Safe Browsing" if "safe" in name or "google" in name else "Apollo's blocklist" if "block" in name else s.get("name"))
    return " and ".join(dict.fromkeys(n for n in names if n)) or "Google Safe Browsing"


_THREATS = {"SOCIAL_ENGINEERING": "a phishing (social engineering) site", "MALWARE": "a malware site",
            "UNWANTED_SOFTWARE": "a site serving unwanted software", "POTENTIALLY_HARMFUL_APPLICATION": "a site serving harmful apps"}


def _threat_words(types: list[str]) -> str:
    return " and ".join(dict.fromkeys(_THREATS.get(t, t.replace("_", " ").lower()) for t in types)) or "dangerous"


async def _link(check: Check, pg: dict, plan_: Plan) -> None:
    host = check.subject
    owner = official_domain(host)
    if owner:
        publisher, basis = owner
        check.facts.append(fact(f"{host} is {publisher}'s official domain.", "clear", decisive=True, topic="official_domain",
                                source=source_ref("ApolloSG official-domain register", authority="official", basis=basis)))
    urls = check.urls or [f"https://{host}/"]
    checked_any = False
    for url in urls[:2]:
        chain = (pg["redirects"].get(url) or {}).get("chain") or []
        targets = [url] + ([chain[-1]] if len(chain) > 1 and chain[-1] != url else [])
        if len(targets) > 1:
            check.facts.append(fact(f"The link {url[:120]} redirects to {targets[-1][:120]}.", "anomaly",
                                    source=source_ref("Apollo redirect expansion", authority="independent", basis="HTTP redirect chain recorded by Apollo")))
        for target in targets:
            sb = pg["safe_browsing"].get(target)
            if sb and sb.get("status", "ok") == "ok" and sb.get("verdict"):
                result = {"verdict": sb["verdict"], "threatTypes": sb.get("threat_types") or [], "coverage": sb.get("coverage", "full"),
                          "sources": [{"name": "Google Safe Browsing", "status": "match" if sb["verdict"] == "malicious" else "clear"}],
                          "checkedAt": sb.get("queried_at")}
            else:
                result = await lookup_url(target)
            if not result or result["coverage"] == "none":
                continue
            checked_any = True
            target_host = target.split("//")[-1].split("/")[0]
            if result["verdict"] == "malicious":
                publisher = _sb_publisher(result["sources"])
                check.facts.append(fact(f"{publisher} lists {target_host} as {_threat_words(result['threatTypes'])}.", "concern", decisive=True, topic="listing",
                                        source=source_ref(publisher, url=f"https://transparencyreport.google.com/safe-browsing/search?url={target_host}",
                                                       authority="independent", basis="Direct Safe Browsing / blocklist lookup", checked_at=result.get("checkedAt"))))
            elif result["verdict"] == "clean":
                check.facts.append(fact(f"{target_host} is not listed by Google Safe Browsing or Apollo's blocklist.", "clear", topic="listing",
                                        source=source_ref("Google Safe Browsing", url=f"https://transparencyreport.google.com/safe-browsing/search?url={target_host}",
                                                       authority="independent", basis="Direct Safe Browsing / blocklist lookup", checked_at=result.get("checkedAt"))))
    domain = registrable(host)
    rd = pg["rdap"].get(domain) or pg["rdap"].get(host)
    record = None
    if rd and rd.get("status") == "ok" and rd.get("registration_date") not in (None, "unknown"):
        record = {"registeredAt": rd["registration_date"], "ageDays": None, "newlyRegistered": bool(rd.get("newly_registered"))}
    elif not owner:
        record = await lookup_domain(domain)
    if record and record.get("registeredAt"):
        age = record.get("ageDays")
        when = record["registeredAt"][:10]
        young = record.get("newlyRegistered") or (age is not None and age < 90)
        check.facts.append(fact(f"{domain} was registered on {when}" + (f" ({age} days before this check)." if age is not None and age < 365 else "."),
                                "anomaly" if young else "neutral", topic="registration",
                                source=source_ref("Domain registry (RDAP)", url=f"https://rdap.org/domain/{domain}", authority="official",
                                               basis="The registry's RDAP registration record")))
    for url, info in pg["ipqs_urls"].items():
        if host in url.lower() and info.get("status") == "ok":
            flags = [name for name in ("phishing", "malware", "suspicious") if info.get(name)]
            if flags:
                check.facts.append(fact(f"IPQualityScore flags {host} as {', '.join(flags)} (risk score {info.get('risk_score', '?')}/100).", "anomaly",
                                        source=source_ref("IPQualityScore", authority="independent", basis="Commercial URL reputation lookup")))
    for item in pg["downloads"]:
        if host in (item.get("url") or "").lower():
            check.facts.append(fact(f"The link downloads a file directly ({item.get('filename', 'a file')}).", "anomaly",
                                    source=source_ref("ApolloSG download-link detection", authority="independent", basis="Static link analysis")))
    for match in pg["advisories"] + plan_.advisories:
        if (match.get("matched_on") or "") == f"domain: {host}" or (match.get("matched_on") or "") == f"domain: {domain}":
            check.facts.append(fact(f"An official scam advisory names {host}: “{match.get('title', 'advisory')}”.", "concern", decisive=True,
                                    source=source_ref("Official scam advisory feed", authority="official", basis="Government advisory held by ApolloSG")))
    if any(f["decisive"] for f in check.facts):
        check.status, check.route = "resolved", "official_source"
    elif not checked_any and not owner:
        check.facts.append(fact(f"Google Safe Browsing could not be checked for {host}.", "missing", topic="listing"))


def _lookalike(name: str, official: str, place: str) -> bool:
    """The organisation's name is part of the other address itself (commbank-notice.net) — a lookalike, which is a
    warning sign on its own, unlike a name merely mentioned beside someone else's link."""
    host = place.lower()
    for needle in [n for n, brand in BRANDS.items() if brand == (name, official)] + [name.lower()]:
        for variant in {needle.replace(" ", ""), needle.replace(" ", "-")}:
            if len(variant) >= 5 and variant in host or re.search(rf"(?<![a-z0-9]){re.escape(variant)}(?![a-z0-9])", host):
                return True
    return False


def _impersonation(check: Check, plan_: Plan) -> None:
    name, official = check.subject, check.urls[0]
    places = [h for h in plan_.entities.hosts] + [e.split("@")[-1] for e in plan_.entities.emails]
    if not places:
        check.status, check.open_issue = "needs_reasoning", f"Whether the material genuinely comes from {name}."
        return
    mismatched = [p for p in places if registrable(p) != registrable(official)]
    if mismatched:
        for place in mismatched[:3]:
            if _lookalike(name, official, place):
                text, topic = f"{place} carries {name}'s name, but it is not {name}'s domain ({official}).", "lookalike"
            else:
                text, topic = f"The material names {name}, but {place} is not {name}'s domain ({official}).", "impersonation"
            check.facts.append(fact(text, "anomaly", topic=topic,
                                    source=source_ref("ApolloSG official-domain register", basis=f"{name}'s published domain")) | {"place": place})
        check.status, check.open_issue = "needs_reasoning", f"Impersonation: whether the material genuinely comes from {name}."
    else:
        check.facts.append(fact(f"Every link and address in the material uses {official}, {name}'s official domain.", "clear",
                                source=source_ref("ApolloSG official-domain register", basis=f"{name}'s published domain")))
        check.status, check.route = "resolved", "official_source"


def _phone(check: Check, pg: dict) -> None:
    info = next((v for k, v in pg["ipqs_phones"].items() if k and check.subject and k[-8:] in check.subject.replace(" ", "")), None)
    if info and info.get("status") == "ok":
        risky = (info.get("fraud_score") or 0) >= 85 or info.get("recent_abuse")
        check.facts.append(fact(f"IPQualityScore gives {check.subject} a fraud score of {info.get('fraud_score', '?')}/100"
                                + ("; recent abuse is reported" if info.get("recent_abuse") else "") + f" (carrier: {info.get('carrier', 'unknown')}).",
                                "anomaly" if risky else "neutral",
                                source=source_ref("IPQualityScore", authority="independent", basis="Commercial phone reputation lookup")))


def _email(check: Check, plan_: Plan) -> None:
    domain = check.subject.split("@")[-1].lower()
    owner = official_domain(domain)
    if owner:
        check.facts.append(fact(f"{check.subject} uses {domain}, {owner[0]}'s official domain.", "clear",
                                source=source_ref("ApolloSG official-domain register", basis=owner[1])))
    elif domain in FREE_MAIL and plan_.entities.brands:
        check.facts.append(fact(f"{check.subject} is a free personal email account ({domain}), not an address of {plan_.entities.brands[0][0]}.", "anomaly",
                                topic="freemail", source=source_ref("ApolloSG official-domain register", basis="Free email providers are not organisation domains")))


def _registration_number(check: Check) -> None:
    label = "ABN" if check.kind == "abn" else "ACN"
    valid = abn_valid(check.subject) if check.kind == "abn" else acn_valid(check.subject)
    publisher = "Australian Business Register" if check.kind == "abn" else "ASIC"
    source = source_ref(f"{publisher} check-digit algorithm", authority="official", basis=f"{publisher}'s published {label} validation rule")
    if valid:
        check.facts.append(fact(f"{label} {check.subject} passes the {publisher}'s check-digit test.", "neutral", source=source))
    else:
        check.facts.append(fact(f"{label} {check.subject} fails the {publisher}'s check-digit test, so it is not a valid {label}.", "anomaly", source=source))
        check.status, check.route = "resolved", "official_source"


async def run(plan_: Plan, pre_gathered: dict | None, text: str) -> None:
    """Stage 1 for every planned check. Stops nothing itself — the engine decides from the facts."""
    pg = pregathered(pre_gathered)
    sender_domain = plan_.entities.emails[0].split("@")[-1].lower() if plan_.entities.emails else ""
    hosts = [registrable(h) for h in plan_.entities.hosts]
    plan_.advisories = [] if pg["advisories"] or not (hosts or sender_domain or text) else await advisories(hosts, sender_domain, text)
    for check in plan_.checks:
        if check.kind == "link":
            await _link(check, pg, plan_)
        elif check.kind == "impersonation":
            _impersonation(check, plan_)
        elif check.kind == "phone":
            _phone(check, pg)
        elif check.kind == "email":
            _email(check, plan_)
        elif check.kind in ("abn", "acn"):
            _registration_number(check)
        elif check.kind == "scam_alerts":
            for match in pg["advisories"] + plan_.advisories:
                on = match.get("matched_on") or ""
                if on.startswith("keyword"):
                    check.facts.append(fact(f"An official advisory describes a similar scam: “{match.get('title', 'advisory')}” (severity {match.get('severity', 'unknown')}).",
                                            "context", kind="apollo_knowledge",
                                            source=source_ref("Official scam advisory feed", basis="Government advisory held by ApolloSG — general knowledge")))
