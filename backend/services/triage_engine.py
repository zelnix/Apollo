"""Apollo Triage Engine — 3-tier cost-optimised screening.

Tier 0: Local deterministic screening ($0)
    - Cache lookup, known indicators, duplicates, deterministic rules.
Tier 1: Cheap AI triage (~$0.00005/call)
    - Minimal structured Gemini call → SAFE / SUSPICIOUS / UNCERTAIN.
Tier 2: Full Magnum DI escalation (unchanged depth).

DESIGN PRINCIPLES:
    • Evidence-based classification only — never force items into a tier to meet KPI.
    • Known-bad still triggers existing protection — does NOT re-spend Gemini tokens.
    • Cache uses risk-aware expiry (30d malicious, 7d safe-deterministic, 24h AI verdicts).
    • User-initiated Check bypasses triage entirely.
    • Triage model is configurable via GEMINI_TRIAGE_MODEL env var.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from core.db import db, now_utc

_log = logging.getLogger("apollo.triage")

# ── Verdict / Tier enums ────────────────────────────────────────────────────

class Verdict(str, Enum):
    SAFE = "SAFE"
    SUSPICIOUS = "SUSPICIOUS"
    UNCERTAIN = "UNCERTAIN"


class Tier(int, Enum):
    LOCAL = 0       # Deterministic / cached ($0)
    AI_TRIAGE = 1   # Cheap model triage
    MAGNUM_DI = 2   # Full investigation


# ── Result data class ───────────────────────────────────────────────────────

@dataclass
class TriageResult:
    tier: Tier
    verdict: Verdict
    reason: str
    escalation_reason: Optional[str] = None
    cost_usd: float = 0.0
    cached: bool = False
    cache_key: Optional[str] = None
    source_type: str = ""            # "email", "text", etc.
    indicators_summary: dict = field(default_factory=dict)
    provider_evidence: dict = field(default_factory=dict)  # Specialist provider results with provenance
    providers_used: list = field(default_factory=list)      # Which providers contributed
    gemini_calls_prevented: bool = False                    # Whether provider evidence prevented a Gemini call

    @property
    def should_escalate(self) -> bool:
        """Whether this item should proceed to Magnum DI."""
        return self.verdict in (Verdict.SUSPICIOUS, Verdict.UNCERTAIN)

    def wire(self) -> dict:
        return {
            "tier": self.tier.value,
            "verdict": self.verdict.value,
            "reason": self.reason,
            "escalation_reason": self.escalation_reason,
            "cost_usd": self.cost_usd,
            "cached": self.cached,
            "source_type": self.source_type,
            "providers_used": self.providers_used,
            "gemini_calls_prevented": self.gemini_calls_prevented,
        }

    def compact_evidence_for_magnum_di(self) -> str:
        """Produce a compact, provenance-attributed summary of all specialist
        provider findings suitable for injection into a Magnum DI case.

        Format: one line per finding, with provider name and query timestamp.
        Magnum DI retains the ability to investigate further if evidence is
        conflicting, incomplete or stale.
        """
        lines = ["Pre-gathered specialist intelligence (Apollo Triage):"]
        pe = self.provider_evidence

        # RDAP domain info
        for domain, info in pe.get("rdap", {}).get("domains", {}).items():
            if info.get("status") == "ok":
                reg = info.get("registration_date", "unknown")
                registrar = info.get("registrar", "unknown")
                newly = " — NEWLY REGISTERED (≤30 days)" if info.get("newly_registered") else ""
                lines.append(f"  • Domain {domain}: registered {reg} via {registrar}{newly} (RDAP, {info.get('queried_at', '?')})")
            elif info.get("status") == "unavailable":
                lines.append(f"  • Domain {domain}: RDAP lookup unavailable ({info.get('detail', 'timeout/error')})")

        # Safe Browsing
        for url, info in pe.get("safe_browsing", {}).get("urls", {}).items():
            if info.get("verdict") == "malicious":
                threats = ", ".join(info.get("threat_types", []))
                lines.append(f"  • URL {url}: LISTED as {threats} by Google Safe Browsing ({info.get('queried_at', '?')})")
            elif info.get("verdict") == "clean":
                lines.append(f"  • URL {url}: Not currently listed by Google Safe Browsing ({info.get('queried_at', '?')})")

        # Redirect chains
        for url, info in pe.get("redirects", {}).get("urls", {}).items():
            chain = info.get("chain", [])
            if len(chain) > 1:
                final = info.get("final_url", chain[-1])
                lines.append(f"  • URL {url}: redirects through {len(chain)} hops → final: {final} ({info.get('queried_at', '?')})")

        # IPQS phone risk
        for phone, info in pe.get("ipqs", {}).get("phones", {}).items():
            if info.get("status") == "ok":
                score = info.get("fraud_score", "?")
                abuse = "; RECENT ABUSE" if info.get("recent_abuse") else ""
                carrier = info.get("carrier", "unknown")
                lines.append(f"  • Phone {phone}: IPQS fraud score {score}/100, carrier: {carrier}{abuse} ({info.get('queried_at', '?')})")

        # HIBP breach
        for email, info in pe.get("hibp", {}).get("emails", {}).items():
            if info.get("status") == "found":
                count = len(info.get("breaches", []))
                lines.append(f"  • Email {email}: found in {count} known breach(es) ({info.get('queried_at', '?')})")
            elif info.get("status") == "clear":
                lines.append(f"  • Email {email}: not found in known breaches ({info.get('queried_at', '?')})")

        # Scam intel matches
        for match in pe.get("scam_intel", {}).get("matches", []):
            lines.append(f"  • Active scam advisory match: \"{match.get('title', '?')}\" — severity: {match.get('severity', '?')}, matched on: {match.get('matched_on', '?')}")

        if len(lines) == 1:
            lines.append("  (No specialist provider results gathered for this item.)")

        return "\n".join(lines)


def compact_evidence_for_magnum_di(provider_evidence: dict) -> str:
    """Standalone version of TriageResult.compact_evidence_for_magnum_di.
    Produces a compact provenance-attributed summary from a raw provider_evidence dict.
    Used by manual Check pre-gathering where there is no TriageResult."""
    lines = ["Pre-gathered specialist intelligence (Apollo Triage):"]
    pe = provider_evidence

    for domain, info in pe.get("rdap", {}).get("domains", {}).items():
        if info.get("status") == "ok":
            reg = info.get("registration_date", "unknown")
            registrar = info.get("registrar", "unknown")
            newly = " — NEWLY REGISTERED (≤30 days)" if info.get("newly_registered") else ""
            lines.append(f"  • Domain {domain}: registered {reg} via {registrar}{newly} (RDAP, {info.get('queried_at', '?')})")
    for url, info in pe.get("safe_browsing", {}).get("urls", {}).items():
        if info.get("verdict") == "malicious":
            threats = ", ".join(info.get("threat_types", []))
            lines.append(f"  • URL {url}: LISTED as {threats} by Google Safe Browsing ({info.get('queried_at', '?')})")
        elif info.get("verdict") == "clean":
            lines.append(f"  • URL {url}: Not currently listed by Google Safe Browsing ({info.get('queried_at', '?')})")
    for url, info in pe.get("redirects", {}).get("urls", {}).items():
        chain = info.get("chain", [])
        if len(chain) > 1:
            final = info.get("final_url", chain[-1])
            lines.append(f"  • URL {url}: redirects through {len(chain)} hops → final: {final} ({info.get('queried_at', '?')})")
    for phone, info in pe.get("ipqs", {}).get("phones", {}).items():
        if info.get("status") == "ok":
            score = info.get("fraud_score", "?")
            abuse = "; RECENT ABUSE" if info.get("recent_abuse") else ""
            carrier = info.get("carrier", "unknown")
            lines.append(f"  • Phone {phone}: IPQS fraud score {score}/100, carrier: {carrier}{abuse} ({info.get('queried_at', '?')})")
    for email, info in pe.get("hibp", {}).get("emails", {}).items():
        if info.get("status") == "found":
            count = len(info.get("breaches", []))
            lines.append(f"  • Email {email}: found in {count} known breach(es) ({info.get('queried_at', '?')})")
        elif info.get("status") == "clear":
            lines.append(f"  • Email {email}: not found in known breaches ({info.get('queried_at', '?')})")
    for match in pe.get("scam_intel", {}).get("matches", []):
        lines.append(f"  • Active scam advisory match: \"{match.get('title', '?')}\" — severity: {match.get('severity', '?')}, matched on: {match.get('matched_on', '?')}")

    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def _extract_indicators(text: str) -> dict:
    """Extract URLs, domains, phone numbers and emails from arbitrary text.
    Used by manual Check pre-gathering to identify indicators to check."""
    import re as _re
    result: dict = {"urls": [], "domains": [], "phones": [], "emails": []}

    # URLs
    url_matches = _re.findall(r'https?://[^\s<>"\')\]]+', text)
    result["urls"] = list(dict.fromkeys(url_matches))[:10]

    # Domains from URLs
    from urllib.parse import urlparse
    for url in result["urls"]:
        try:
            host = urlparse(url).hostname
            if host:
                result["domains"].append(host)
        except Exception:
            pass

    # Emails
    email_matches = _re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', text)
    result["emails"] = list(dict.fromkeys(email_matches))[:10]

    # Phone numbers (basic E.164 and common formats)
    phone_matches = _re.findall(r'(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}', text)
    result["phones"] = list(dict.fromkeys(phone_matches))[:10]

    result["domains"] = list(dict.fromkeys(result["domains"]))[:10]
    return result


# ── Collection ──────────────────────────────────────────────────────────────

COLLECTION = "triage_results"


async def ensure_indexes() -> None:
    coll = db[COLLECTION]
    await coll.create_index("fingerprint")
    await coll.create_index("created_at")
    await coll.create_index("expires_at")
    await coll.create_index([("device_id", 1), ("fingerprint", 1)])
    await coll.create_index([("tier", 1), ("verdict", 1)])


# ── Cache TTL policy (risk-aware) ──────────────────────────────────────────

_CACHE_TTL = {
    # (tier, verdict) → timedelta
    (Tier.LOCAL, Verdict.SAFE): timedelta(days=7),         # Known safe deterministic
    (Tier.LOCAL, Verdict.SUSPICIOUS): timedelta(days=30),  # Known malicious
    (Tier.AI_TRIAGE, Verdict.SAFE): timedelta(hours=24),   # AI-assessed safe
    (Tier.AI_TRIAGE, Verdict.SUSPICIOUS): timedelta(hours=24),  # AI-assessed suspicious
    # UNCERTAIN is never cached to avoid suppressing required escalation
}


def _cache_ttl(tier: Tier, verdict: Verdict) -> Optional[timedelta]:
    """Return cache TTL or None if this result should not be cached."""
    if verdict == Verdict.UNCERTAIN:
        return None  # Never cache UNCERTAIN
    return _CACHE_TTL.get((tier, verdict))


# ── Fingerprint computation ─────────────────────────────────────────────────

def compute_fingerprint(evidence: dict) -> str:
    """Compute a normalized indicator fingerprint from structured evidence.

    Captures the MATERIAL identity of the threat indicator:
    - Sender domain (not display name)
    - Subject line (normalized lowercase, stripped of Re:/Fwd:)
    - Link destination domains (sorted, deduplicated)
    - Authentication results (SPF/DKIM/DMARC)
    - Attachment extensions (sorted)

    Does NOT include:
    - Message body text (too variable)
    - Timestamps
    - Message IDs
    """
    parts = []

    # Sender domain
    sender = evidence.get("sender_domain", "").lower().strip()
    if sender:
        parts.append(f"sender:{sender}")

    # Normalized subject
    subject = evidence.get("subject", "").lower().strip()
    subject = re.sub(r"^(?:re:|fwd?:|fw:)\s*", "", subject, flags=re.IGNORECASE).strip()
    if subject:
        parts.append(f"subject:{subject[:200]}")  # Cap at 200 chars

    # Link domains (sorted, unique)
    link_domains = sorted(set(
        d.lower() for d in evidence.get("link_domains", []) if d
    ))
    if link_domains:
        parts.append(f"links:{','.join(link_domains[:20])}")

    # Auth results
    auth = evidence.get("auth_results", {})
    if auth:
        auth_str = "|".join(f"{k}={v}" for k, v in sorted(auth.items()) if v)
        if auth_str:
            parts.append(f"auth:{auth_str}")

    # Attachment extensions
    exts = sorted(set(evidence.get("attachment_extensions", [])))
    if exts:
        parts.append(f"attachments:{','.join(exts)}")

    # Reply-to domain mismatch indicator
    reply_domain = evidence.get("reply_to_domain", "").lower().strip()
    if reply_domain and reply_domain != sender:
        parts.append(f"reply_to:{reply_domain}")

    fingerprint_input = "|".join(parts) if parts else "empty"
    return hashlib.sha256(fingerprint_input.encode()).hexdigest()


# ── Cache lookup & storage ──────────────────────────────────────────────────

async def _cache_lookup(fingerprint: str, device_id: str) -> Optional[dict]:
    """Look up a cached triage result. Returns None if not found or expired."""
    now = now_utc()
    result = await db[COLLECTION].find_one(
        {
            "fingerprint": fingerprint,
            "device_id": device_id,
            "expires_at": {"$gt": now},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if result:
        # Increment cache hit counter
        await db[COLLECTION].update_one(
            {"fingerprint": fingerprint, "device_id": device_id, "created_at": result["created_at"]},
            {"$inc": {"cache_hit_count": 1}, "$set": {"last_hit_at": now}},
        )
    return result


async def _cache_store(
    fingerprint: str,
    device_id: str,
    result: TriageResult,
    evidence_summary: dict,
) -> None:
    """Store a triage result in the cache with risk-aware TTL."""
    ttl = _cache_ttl(result.tier, result.verdict)
    if ttl is None:
        # Don't cache (e.g. UNCERTAIN)
        return

    now = now_utc()
    doc = {
        "fingerprint": fingerprint,
        "device_id": device_id,
        "tier": result.tier.value,
        "verdict": result.verdict.value,
        "reason": result.reason,
        "escalation_reason": result.escalation_reason,
        "cost_usd": result.cost_usd,
        "source_type": result.source_type,
        "providers_used": result.providers_used,
        "evidence_summary": evidence_summary,
        "created_at": now,
        "expires_at": now + ttl,
        "cache_hit_count": 0,
        "last_hit_at": None,
    }
    await db[COLLECTION].insert_one(doc)


# ── Record triage outcome (always, including non-cached) ────────────────────

async def record_triage(
    device_id: str,
    fingerprint: str,
    result: TriageResult,
    evidence_summary: dict,
    *,
    cached: bool = False,
) -> None:
    """Record every triage decision for reporting — cached or fresh."""
    now = now_utc()
    doc = {
        "record_type": "decision",
        "fingerprint": fingerprint,
        "device_id": device_id,
        "tier": result.tier.value,
        "verdict": result.verdict.value,
        "reason": result.reason,
        "escalation_reason": result.escalation_reason,
        "cost_usd": result.cost_usd,
        "source_type": result.source_type,
        "cached": cached,
        "providers_used": result.providers_used,
        "gemini_calls_prevented": result.gemini_calls_prevented,
        "decided_at": now,
    }
    await db[COLLECTION].insert_one(doc)


# ── Tier 0: Local deterministic screening ───────────────────────────────────

def _extract_evidence_from_email(message: dict) -> dict:
    """Extract structured evidence from an email message dict.

    Returns a normalized evidence dict suitable for fingerprinting and Tier 0 rules.
    """
    sender = str(message.get("from", ""))
    subject = str(message.get("subject", ""))
    links = message.get("links", []) if isinstance(message.get("links"), list) else []
    reply_to = str(message.get("reply_to", "")) if message.get("reply_to") else ""
    attachment_names = message.get("attachment_names", []) if isinstance(message.get("attachment_names"), list) else []
    auth_results = message.get("auth_results", {}) if isinstance(message.get("auth_results"), dict) else {}

    # Extract domains
    from services.mailbox_monitor import _extract_domain_from_email, _org_domain
    sender_domain = _extract_domain_from_email(sender) or ""
    reply_to_domain = _extract_domain_from_email(reply_to) or ""

    # Link domains
    link_domains = []
    from urllib.parse import urlparse
    for link in links:
        href = link.get("href", "") if isinstance(link, dict) else ""
        if href:
            try:
                parsed = urlparse(href if "://" in href else f"https://{href}")
                host = (parsed.hostname or "").lower()
                if host:
                    link_domains.append(host)
            except Exception:
                pass

    # Attachment extensions
    attachment_extensions = []
    for name in attachment_names:
        if "." in name:
            attachment_extensions.append("." + name.rsplit(".", 1)[-1].lower())

    return {
        "sender": sender,
        "sender_domain": sender_domain,
        "subject": subject,
        "reply_to_domain": reply_to_domain,
        "link_domains": link_domains,
        "attachment_names": attachment_names,
        "attachment_extensions": attachment_extensions,
        "auth_results": auth_results,
        "source_type": "email",
        "link_urls": [
            (link.get("href", "") if isinstance(link, dict) else "")
            for link in links if (link.get("href", "") if isinstance(link, dict) else "")
        ],
    }


def _extract_evidence_from_text(sender: str, text: str) -> dict:
    """Extract structured evidence from a background text/SMS message."""
    from urllib.parse import urlparse
    import re as _re

    link_domains = []
    urls = _re.findall(r"(?i)\bhttps?://[^\s<>\]\[\"']+", text)
    for url in urls:
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            if host:
                link_domains.append(host)
        except Exception:
            pass

    # For SMS, sender is often a phone number or short code
    sender_domain = ""
    if "@" in sender:
        from services.mailbox_monitor import _extract_domain_from_email
        sender_domain = _extract_domain_from_email(sender) or ""

    return {
        "sender": sender,
        "sender_domain": sender_domain,
        "subject": "",  # SMS has no subject
        "reply_to_domain": "",
        "link_domains": link_domains,
        "attachment_names": [],
        "attachment_extensions": [],
        "auth_results": {},
        "text_preview": text[:300],  # First 300 chars for triage context
        "source_type": "text",
        "link_urls": urls,           # Full URLs for redirect expansion
        "sender_phone": sender if not "@" in sender else "",
    }


# ── Provider Evidence Gathering ─────────────────────────────────────────────
# Runs specialist providers ONCE. Results flow through Tier 0 → Tier 1 → Tier 2
# without re-querying. Provider failure is NEVER interpreted as SAFE.

async def gather_provider_evidence(evidence: dict) -> dict:
    """Run all applicable specialist providers and return structured results.

    Called ONCE before triage_item. Results are reused across all tiers and
    forwarded to Magnum DI if escalation occurs.

    Each provider entry includes:
      - status: "ok" | "unavailable" | "not_configured" | "not_applicable"
      - queried_at: ISO timestamp
      - data_class: "shareable_threat_intel" | "device_private"
      - data fields specific to the provider

    Provider failure → status="unavailable". Never treated as evidence of safety.

    Data classification:
      shareable_threat_intel: Non-user-specific reputation/threat data that may
        be reused across devices (e.g. domain reputation, URL safety, breach lists).
        Never contains user content, messages, screenshots, or private investigation context.
      device_private: Results that incorporate or reference user-specific content,
        device identity, or private investigation state. Never shared cross-device.
    """
    import asyncio
    pe: dict = {}
    providers_used: list[str] = []
    ts = now_utc().isoformat()

    link_domains = evidence.get("link_domains", [])
    link_urls = evidence.get("link_urls", [])
    sender_phone = evidence.get("sender_phone", "")
    source_type = evidence.get("source_type", "unknown")

    # ── 1. RDAP: domain registration intelligence ──
    if link_domains:
        rdap_results = {}
        unique_domains = list(set(d for d in link_domains if d and "." in d))[:10]
        for domain in unique_domains:
            try:
                from services.rdap import lookup_domain_cached
                domain_info = await asyncio.wait_for(lookup_domain_cached(domain), timeout=6.0)
                if domain_info:
                    rdap_results[domain] = {
                        "registrar": domain_info.registrar or "unknown",
                        "registration_date": domain_info.registration_date.isoformat() if domain_info.registration_date else "unknown",
                        "newly_registered": bool(domain_info.newly_registered),
                        "country": domain_info.country or "unknown",
                        "status": "ok",
                        "queried_at": ts,
                        "data_class": "shareable_threat_intel",
                    }
                    providers_used.append("rdap")
                else:
                    rdap_results[domain] = {"status": "unavailable", "detail": "No RDAP data returned", "queried_at": ts}
            except Exception as exc:
                rdap_results[domain] = {"status": "unavailable", "detail": type(exc).__name__, "queried_at": ts}
                _log.debug("rdap_lookup_failed domain=%s error=%s", domain, type(exc).__name__)
        if rdap_results:
            pe["rdap"] = {"domains": rdap_results}

    # ── 2. Redirect expansion + Safe Browsing on final destinations ──
    if link_urls:
        redirect_results = {}
        sb_results = {}
        unique_urls = list(dict.fromkeys(link_urls))[:10]  # preserve order, dedup
        for url in unique_urls:
            try:
                from services.intel import expand_redirects, run_intel_check
                chain = await asyncio.wait_for(expand_redirects(url), timeout=12)
                if len(chain) > 1:
                    redirect_results[url] = {
                        "chain": chain,
                        "final_url": chain[-1],
                        "hops": len(chain) - 1,
                        "status": "ok",
                        "queried_at": ts,
                    }
                    providers_used.append("redirect_expansion")
                    # Check final destination against Safe Browsing
                    try:
                        final_result = await asyncio.wait_for(
                            run_intel_check("url", chain[-1]), timeout=6.0
                        )
                        sb_results[chain[-1]] = {
                            "verdict": final_result.verdict,
                            "threat_types": list(final_result.threat_types),
                            "coverage": final_result.coverage,
                            "status": "ok",
                            "queried_at": ts,
                            "via_redirect_from": url,
                        }
                        providers_used.append("safe_browsing")
                    except Exception:
                        pass
                else:
                    redirect_results[url] = {"chain": chain, "final_url": url, "hops": 0, "status": "ok", "queried_at": ts}
            except Exception as exc:
                redirect_results[url] = {"status": "unavailable", "detail": type(exc).__name__, "queried_at": ts}
                _log.debug("redirect_expansion_failed url=%s error=%s", url[:60], type(exc).__name__)
        if redirect_results:
            pe["redirects"] = {"urls": redirect_results}
        if sb_results:
            pe.setdefault("safe_browsing", {})["urls"] = {**pe.get("safe_browsing", {}).get("urls", {}), **sb_results}

    # ── 3. IPQS: phone number fraud scoring (SMS/text only) ──
    if sender_phone:
        try:
            from services.phonerisk import check_phone_risk
            from core.config import IPQS_API_KEY
            if IPQS_API_KEY:
                ipqs_result = await asyncio.wait_for(check_phone_risk(sender_phone), timeout=8.0)
                if ipqs_result and ipqs_result.get("decision") != "error":
                    pe["ipqs"] = {"phones": {sender_phone: {
                        "fraud_score": ipqs_result.get("fraud_score"),
                        "recent_abuse": ipqs_result.get("recent_abuse", False),
                        "voip": ipqs_result.get("voip", False),
                        "carrier": ipqs_result.get("carrier", "unknown"),
                        "line_type": ipqs_result.get("line_type", "unknown"),
                        "country": ipqs_result.get("country", "unknown"),
                        "decision": ipqs_result.get("decision", "unknown"),
                        "status": "ok",
                        "queried_at": ts,
                    }}}
                    providers_used.append("ipqs")
                else:
                    pe["ipqs"] = {"phones": {sender_phone: {"status": "unavailable", "detail": "IPQS returned error", "queried_at": ts}}}
            else:
                pe["ipqs"] = {"phones": {sender_phone: {"status": "not_configured", "queried_at": ts}}}
        except Exception as exc:
            pe["ipqs"] = {"phones": {sender_phone: {"status": "unavailable", "detail": type(exc).__name__, "queried_at": ts}}}
            _log.debug("ipqs_lookup_failed phone=%s error=%s", sender_phone[:6], type(exc).__name__)

    # ── 4. Scam intel feed cross-reference ──
    try:
        scam_matches = await _match_scam_intel(evidence)
        if scam_matches:
            pe["scam_intel"] = {"matches": scam_matches}
            providers_used.append("scam_intel")
    except Exception as exc:
        _log.debug("scam_intel_match_failed error=%s", type(exc).__name__)

    # Deduplicate providers_used
    pe["_summary"] = {
        "providers_consulted": sorted(set(providers_used)),
        "total_lookups": len(providers_used),
        "gathered_at": ts,
    }

    # ── Data classification sweep ──
    # Tag all provider results with their privacy classification.
    # Providers that return public threat intelligence about indicators
    # (domains, URLs, phone reputation, breach lists) are shareable.
    # Results that incorporate user content are device_private.
    _SHAREABLE_SECTIONS = {"rdap", "safe_browsing", "redirects", "ipqs", "scam_intel"}
    for section_name, section in pe.items():
        if section_name.startswith("_") or not isinstance(section, dict):
            continue
        if section_name in _SHAREABLE_SECTIONS:
            for collection in section.values():
                if isinstance(collection, dict):
                    for key, item in collection.items():
                        if isinstance(item, dict) and "data_class" not in item:
                            item["data_class"] = "shareable_threat_intel"
                elif isinstance(collection, list):
                    for item in collection:
                        if isinstance(item, dict) and "data_class" not in item:
                            item["data_class"] = "shareable_threat_intel"
        else:
            # Unknown/future sections default to device_private
            for collection in section.values():
                if isinstance(collection, dict):
                    for key, item in collection.items():
                        if isinstance(item, dict) and "data_class" not in item:
                            item["data_class"] = "device_private"

    return pe


async def _match_scam_intel(evidence: dict) -> list[dict]:
    """Cross-reference incoming evidence against the scam intel learning feed.

    Matches on: sender domain patterns, link domain patterns, subject keywords
    from active advisories classified in the scam_intel feed.

    Returns compact match summaries, not full advisory bodies.
    """
    matches = []
    sender_domain = evidence.get("sender_domain", "")
    link_domains = set(evidence.get("link_domains", []))
    subject = evidence.get("subject", "").lower()
    text_preview = evidence.get("text_preview", "").lower()

    # Query recent active advisories from scam analysis results
    try:
        recent_advisories = await db.scam_analysis_results.find(
            {"is_relevant_to_australia": True},
            {"_id": 0, "feed_item_id": 1, "title": 1, "severity": 1, "tier": 1,
             "facts": 1, "scam_types": 1, "indicators": 1}
        ).sort("analysed_at", -1).limit(50).to_list(50)
    except Exception:
        return []

    for adv in recent_advisories:
        title = (adv.get("title") or "").lower()
        indicators = adv.get("indicators", {}) if isinstance(adv.get("indicators"), dict) else {}
        scam_types = adv.get("scam_types", []) if isinstance(adv.get("scam_types"), list) else []

        # Check domain indicators
        adv_domains = indicators.get("domains", []) if isinstance(indicators.get("domains"), list) else []
        matched_domain = None
        for d in adv_domains:
            d_lower = d.lower()
            if d_lower == sender_domain or d_lower in link_domains:
                matched_domain = d
                break

        # Check keyword patterns in subject/text
        keywords = indicators.get("keywords", []) if isinstance(indicators.get("keywords"), list) else []
        matched_keyword = None
        for kw in keywords:
            kw_lower = kw.lower()
            if kw_lower in subject or kw_lower in text_preview:
                matched_keyword = kw
                break

        if matched_domain or matched_keyword:
            matches.append({
                "advisory_id": adv.get("feed_item_id", "unknown"),
                "title": adv.get("title", "Unknown advisory"),
                "severity": adv.get("severity", "unknown"),
                "scam_types": scam_types[:3],
                "matched_on": f"domain: {matched_domain}" if matched_domain else f"keyword: {matched_keyword}",
            })

    return matches[:5]  # Cap at 5 most relevant matches


def _tier0_screen(evidence: dict, findings: list[str], provider_evidence: dict) -> Optional[TriageResult]:
    """Tier 0: Deterministic local screening WITH specialist provider evidence.

    Returns a TriageResult if the item can be resolved locally ($0).
    Returns None if escalation to Tier 1 is needed.

    Provider evidence is consumed here as additional signals:
    - RDAP newly_registered + any suspicious finding → SUSPICIOUS
    - Redirect chain to malicious destination → SUSPICIOUS
    - IPQS fraud_score ≥ 85 → SUSPICIOUS
    - Provider failure/unavailability is NEVER treated as SAFE.

    Rules:
    - Known malicious indicators → SUSPICIOUS (take existing action)
    - Deterministic security rule matches → SUSPICIOUS
    - No suspicious signals at all AND no risky provider signals → SAFE
    - If any ambiguity, returns None (→ Tier 1)
    """
    source_type = evidence.get("source_type", "unknown")
    providers_used: list[str] = []

    # ── Existing suspicious-pattern matching (ported from mailbox_monitor) ──
    SUSPICIOUS_PATTERNS = (
        "different domains",            # sender/link domain mismatch
        "different domain",             # reply-to mismatch
        "authentication failed",        # SPF/DKIM/DMARC failure
        "Risky attachment",             # dangerous file extension
        "listed as unsafe",             # Safe Browsing malicious hit
        "Malware detected",             # VirusTotal positive
        "Suspicious attachment",        # VirusTotal suspicious
    )

    suspicious_findings = [f for f in findings if any(p in f for p in SUSPICIOUS_PATTERNS)]

    # ── Known malicious: domain mismatch + auth failure is very strong signal ──
    auth = evidence.get("auth_results", {})
    auth_failed = any(auth.get(m) in ("fail", "softfail", "permerror") for m in ("spf", "dkim", "dmarc"))
    has_domain_mismatch = any("different domain" in f.lower() for f in findings)
    has_malware = any("Malware detected" in f for f in findings)
    has_unsafe_link = any("listed as unsafe" in f for f in findings)

    def _result(verdict, reason, escalation_reason=None, extra_providers=None):
        """Helper to build TriageResult with provider tracking."""
        all_providers = list(set(providers_used + (extra_providers or [])))
        return TriageResult(
            tier=Tier.LOCAL, verdict=verdict, reason=reason,
            escalation_reason=escalation_reason, cost_usd=0.0,
            source_type=source_type, provider_evidence=provider_evidence,
            providers_used=all_providers,
            gemini_calls_prevented=(verdict == Verdict.SAFE),
        )

    # Strong malicious signal: take action without Gemini
    if has_malware or has_unsafe_link:
        return _result(
            Verdict.SUSPICIOUS,
            "Known malicious indicator (malware or unsafe link detected by reputation service).",
            "Malware/unsafe link confirmed by existing reputation sources — Magnum DI for full corroboration.",
            extra_providers=["virustotal" if has_malware else "safe_browsing"],
        )

    if auth_failed and has_domain_mismatch:
        return _result(
            Verdict.SUSPICIOUS,
            "Authentication failure combined with sender/link domain mismatch — strong impersonation signal.",
            "Multiple independent suspicious indicators from deterministic checks.",
        )

    # ── Risky attachment types are a direct threat ──
    risky_ext = {".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".js", ".vbs", ".wsf",
                 ".msi", ".dll", ".hta", ".ps1", ".reg", ".lnk", ".iso", ".img", ".cab"}
    if any(ext in risky_ext for ext in evidence.get("attachment_extensions", [])):
        return _result(
            Verdict.SUSPICIOUS,
            "Risky executable attachment type detected.",
            "Attachment can execute code — requires Magnum DI analysis.",
        )

    # ── Provider evidence: RDAP newly-registered domain + any suspicious signal ──
    rdap_data = provider_evidence.get("rdap", {}).get("domains", {})
    newly_registered_domains = [
        d for d, info in rdap_data.items()
        if info.get("status") == "ok" and info.get("newly_registered")
    ]
    if newly_registered_domains and suspicious_findings:
        domains_str = ", ".join(newly_registered_domains[:3])
        return _result(
            Verdict.SUSPICIOUS,
            f"Newly registered domain(s) ({domains_str}, ≤30 days) combined with suspicious findings.",
            "RDAP newly-registered domain + suspicious signals is a strong impersonation indicator.",
            extra_providers=["rdap"],
        )

    # ── Provider evidence: Redirect chain to malicious destination ──
    redirect_data = provider_evidence.get("redirects", {}).get("urls", {})
    sb_data = provider_evidence.get("safe_browsing", {}).get("urls", {})
    malicious_redirect_found = False
    for url, rinfo in redirect_data.items():
        if rinfo.get("hops", 0) > 0:
            final = rinfo.get("final_url", "")
            final_sb = sb_data.get(final, {})
            if final_sb.get("verdict") == "malicious":
                malicious_redirect_found = True
                providers_used.extend(["redirect_expansion", "safe_browsing"])
                return _result(
                    Verdict.SUSPICIOUS,
                    f"Redirect chain from {url[:60]} resolves to a malicious destination ({final[:60]}).",
                    "Clean-looking URL redirects to a page flagged by Google Safe Browsing.",
                    extra_providers=["redirect_expansion", "safe_browsing"],
                )

    # ── Provider evidence: IPQS high fraud score ──
    ipqs_data = provider_evidence.get("ipqs", {}).get("phones", {})
    for phone, pinfo in ipqs_data.items():
        if pinfo.get("status") == "ok":
            fraud_score = pinfo.get("fraud_score", 0) or 0
            if fraud_score >= 85:
                providers_used.append("ipqs")
                return _result(
                    Verdict.SUSPICIOUS,
                    f"Sender phone number has IPQS fraud score {fraud_score}/100 (high risk).",
                    "Known fraud number flagged by IPQualityScore — requires Magnum DI investigation.",
                    extra_providers=["ipqs"],
                )

    # ── Provider evidence: Scam intel match (direct match on domain or keyword) ──
    scam_matches = provider_evidence.get("scam_intel", {}).get("matches", [])
    high_severity_match = [m for m in scam_matches if m.get("severity") in ("high", "critical")]
    if high_severity_match:
        match_info = high_severity_match[0]
        providers_used.append("scam_intel")
        return _result(
            Verdict.SUSPICIOUS,
            f"Matches active scam advisory: \"{match_info.get('title', '?')}\" (severity: {match_info.get('severity')}, {match_info.get('matched_on')}).",
            "Active scam campaign match from government advisory feed.",
            extra_providers=["scam_intel"],
        )

    # ── Provider evidence: RDAP newly-registered alone is a risk signal but not
    # sufficient for SUSPICIOUS without other suspicious findings. Send to Tier 1
    # so AI can assess.
    if newly_registered_domains and not suspicious_findings:
        # Ambiguous: newly-registered domain but no other local signals → Tier 1
        return None

    # ── Provider unavailability check: if critical providers were unavailable,
    # do NOT call SAFE just because we have no data. Send to Tier 1.
    any_provider_unavailable = False
    for prov_name in ["rdap", "safe_browsing", "ipqs"]:
        prov_section = provider_evidence.get(prov_name, {})
        for collection_name in ["domains", "urls", "phones"]:
            for _, item in prov_section.get(collection_name, {}).items():
                if isinstance(item, dict) and item.get("status") in ("unavailable", "not_configured"):
                    any_provider_unavailable = True
                    break

    # ── Authenticated sender with no suspicious signals → likely routine email ──
    auth_passed = any(auth.get(m) == "pass" for m in ("spf", "dkim", "dmarc"))

    # ── No suspicious findings at all → SAFE (Tier 0) ──
    if not suspicious_findings:
        # SPF/DKIM/DMARC pass is strong evidence from the email infrastructure itself.
        # An authenticated sender with zero suspicious findings is routine email —
        # marketing, receipts, newsletters, notifications, etc. Provider evidence
        # (RDAP, Safe Browsing) is supplementary but not required when authentication
        # passes and no local threat signals exist.
        if auth_passed:
            return _result(
                Verdict.SAFE,
                "Authenticated sender with no suspicious indicators. Routine email.",
            )

        # Unauthenticated sender + no suspicious findings + providers unavailable → Tier 1
        # Cannot call SAFE without either authentication or provider corroboration.
        if any_provider_unavailable:
            return None

        # Unauthenticated but no suspicious findings and all providers checked → SAFE
        return _result(
            Verdict.SAFE,
            "No suspicious indicators detected by deterministic screening or specialist providers.",
        )

    # ── Some suspicious findings but not clearly malicious → Tier 1 ──
    # Single domain mismatch or single auth failure alone is ambiguous
    return None


# ── Tier 1: Cheap AI triage ─────────────────────────────────────────────────

_TRIAGE_SYSTEM = """You are Apollo's email triage classifier. Your job is to separate genuinely suspicious communications from routine legitimate email. Classify as:

SAFE — Routine legitimate email or no credible threat indicators. No investigation needed.
SUSPICIOUS — Credible scam/phishing/threat indicators present. Needs investigation.
UNCERTAIN — Conflicting signals that genuinely require deeper analysis.

CRITICAL — most monitored email is legitimate. SAFE is the expected default, not the exception:
- Marketing, promotional offers, sales announcements, abandoned-cart reminders → SAFE
- Order confirmations, shipping notifications, delivery updates, receipts, invoices from authenticated senders → SAFE
- Newsletters, digests, product updates, release notes → SAFE
- Account notifications from authenticated senders (login alerts, password change confirmations, 2FA codes) → SAFE (the notification itself is legitimate; the EVENT it describes may matter but that is not this email's fault)
- Social media notifications, comment alerts, follower updates → SAFE
- Calendar invitations, meeting reminders → SAFE
- Subscription renewals, billing statements from known services → SAFE
- Commercial language (buy, sale, discount, offer, limited time, act now) is NORMAL in marketing — not a threat signal
- The presence of links in an email is NORMAL — not a suspicious indicator by itself
- An authenticated sender (SPF/DKIM/DMARC pass) with matching domains sending commercial content is SAFE

Only classify SUSPICIOUS when ACTUAL threat indicators exist:
- Sender authentication failure (SPF/DKIM/DMARC fail) combined with impersonation signals
- Sender domain does not match link destinations AND the mismatch is not explainable by normal tracking/CDN infrastructure
- Known malicious URLs, domains or phone numbers flagged by specialist providers
- Newly registered domains (≤30 days) used in links combined with urgency or credential requests
- Requests for passwords, verification codes, payment details to unexpected destinations
- Attachments with executable file extensions

Return JSON: {"verdict": "SAFE|SUSPICIOUS|UNCERTAIN", "reason": "...", "escalation_reason": "..."}"""


def _build_triage_prompt(evidence: dict, findings: list[str], provider_evidence: dict) -> str:
    """Build a minimal structured evidence summary for Tier 1 triage.

    Includes specialist provider findings alongside local evidence so the
    triage model can make a more informed decision.

    Target: ~300-500 input tokens total (system + user prompt).
    """
    parts = []

    sender_domain = evidence.get("sender_domain", "unknown")
    parts.append(f"Sender domain: {sender_domain}")

    subject = evidence.get("subject", "")
    if subject:
        parts.append(f"Subject: {subject[:100]}")

    # Key findings (already computed by local screening)
    if findings:
        parts.append("Findings:")
        for f in findings[:5]:  # Cap at 5 findings
            parts.append(f"  - {f[:150]}")

    # Link domains
    link_domains = evidence.get("link_domains", [])
    if link_domains:
        parts.append(f"Link destinations: {', '.join(link_domains[:5])}")

    # Auth
    auth = evidence.get("auth_results", {})
    if auth:
        auth_parts = [f"{k}={v}" for k, v in auth.items() if v and v != "unknown"]
        if auth_parts:
            parts.append(f"Authentication: {', '.join(auth_parts)}")

    # Text preview (for SMS)
    text_preview = evidence.get("text_preview", "")
    if text_preview:
        parts.append(f"Message preview: {text_preview[:200]}")

    # ── Specialist provider evidence (compact) ──
    provider_lines = []

    # RDAP newly-registered domains
    rdap_data = provider_evidence.get("rdap", {}).get("domains", {})
    for domain, info in rdap_data.items():
        if info.get("status") == "ok" and info.get("newly_registered"):
            provider_lines.append(f"RDAP: {domain} registered within last 30 days")
        elif info.get("status") == "ok":
            reg = info.get("registration_date", "unknown")
            provider_lines.append(f"RDAP: {domain} registered {reg}")

    # Redirect chains
    for url, rinfo in provider_evidence.get("redirects", {}).get("urls", {}).items():
        if rinfo.get("hops", 0) > 0:
            provider_lines.append(f"Redirect: {url[:50]} → {rinfo.get('final_url', '?')[:50]} ({rinfo['hops']} hops)")

    # IPQS phone risk
    for phone, pinfo in provider_evidence.get("ipqs", {}).get("phones", {}).items():
        if pinfo.get("status") == "ok":
            provider_lines.append(f"IPQS: phone fraud score {pinfo.get('fraud_score', '?')}/100")

    # Scam intel matches
    for match in provider_evidence.get("scam_intel", {}).get("matches", [])[:2]:
        provider_lines.append(f"Scam advisory: \"{match.get('title', '?')}\" ({match.get('severity', '?')}, {match.get('matched_on', '?')})")

    if provider_lines:
        parts.append("Specialist intelligence:")
        for line in provider_lines[:5]:
            parts.append(f"  - {line}")

    return "\n".join(parts)


async def _tier1_triage(
    evidence: dict,
    findings: list[str],
    device_id: str,
    correlation_id: str,
    provider_evidence: dict,
) -> TriageResult:
    """Tier 1: Cheap AI triage using the configured triage model.

    Sends minimal structured evidence (including specialist provider findings)
    and expects:
    {"verdict": "SAFE|SUSPICIOUS|UNCERTAIN", "reason": "...", "escalation_reason": "..."}

    No research, no tools, no multi-round — single call only.
    """
    from services.higgins import provider
    from services.higgins.llm_boundary import Purpose

    source_type = evidence.get("source_type", "unknown")
    prompt = _build_triage_prompt(evidence, findings, provider_evidence)

    try:
        result = await provider.generate(
            system=_TRIAGE_SYSTEM,
            contents=prompt,
            model=provider.TRIAGE_MODEL,
            capability="text",
            json_output=True,
            purpose=Purpose.TRIAGE,
            correlation_id=correlation_id,
            trigger_source="triage",
        )

        # Parse structured response
        data = result.object()
        verdict_str = data.get("verdict", "UNCERTAIN").upper().strip()
        reason = data.get("reason", "AI triage returned no reason.")
        escalation_reason = data.get("escalation_reason")

        # Validate verdict
        try:
            verdict = Verdict(verdict_str)
        except ValueError:
            _log.warning("triage_invalid_verdict verdict=%s, defaulting to UNCERTAIN", verdict_str)
            verdict = Verdict.UNCERTAIN
            reason = f"AI triage returned invalid verdict '{verdict_str}' — treated as UNCERTAIN."
            escalation_reason = "Invalid triage response requires full investigation."

        # Extract cost from usage
        usage = result.usage or {}
        tokens = {
            "input": usage.get("prompt_token_count") or usage.get("input_tokens"),
            "output": usage.get("candidates_token_count") or usage.get("output_tokens"),
        }
        from services.gemini_usage import estimate_cost_usd
        cost = estimate_cost_usd(provider.TRIAGE_MODEL, tokens)

        providers_from_pe = provider_evidence.get("_summary", {}).get("providers_consulted", [])

        return TriageResult(
            tier=Tier.AI_TRIAGE,
            verdict=verdict,
            reason=reason,
            escalation_reason=escalation_reason if verdict != Verdict.SAFE else None,
            cost_usd=cost,
            source_type=source_type,
            provider_evidence=provider_evidence,
            providers_used=providers_from_pe + ["gemini_triage"],
            gemini_calls_prevented=False,
        )

    except Exception as exc:
        _log.warning("triage_ai_failed error=%s, escalating to UNCERTAIN", type(exc).__name__)
        return TriageResult(
            tier=Tier.AI_TRIAGE,
            verdict=Verdict.UNCERTAIN,
            reason=f"AI triage failed ({type(exc).__name__}) — treating as UNCERTAIN to ensure investigation.",
            escalation_reason="Triage model failure — escalate for safety.",
            cost_usd=0.0,
            source_type=source_type,
            provider_evidence=provider_evidence,
            providers_used=provider_evidence.get("_summary", {}).get("providers_consulted", []),
        )


# ── Main triage entry point ────────────────────────────────────────────────

async def triage_item(
    device_id: str,
    evidence: dict,
    findings: list[str],
    correlation_id: str,
    *,
    bypass_cache: bool = False,
    provider_evidence: Optional[dict] = None,
) -> TriageResult:
    """Main triage entry point for automatic screening.

    Runs the 3-tier classification:
    1. Check cache → if hit, return cached result
    2. Gather specialist provider evidence (RDAP, redirects, IPQS, scam intel)
    3. Tier 0 → local deterministic screening + provider evidence
    4. Tier 1 → cheap AI triage with provider context (only if Tier 0 can't resolve)

    Tier 2 (Magnum DI) is NOT invoked here — the caller decides based on
    result.should_escalate. Provider evidence is forwarded to Magnum DI via
    result.provider_evidence and result.compact_evidence_for_magnum_di().

    Args:
        device_id: Device requesting triage
        evidence: Structured evidence dict (from _extract_evidence_from_*)
        findings: List of local finding strings (from deterministic checks)
        correlation_id: Case/correlation ID for usage tracking
        bypass_cache: If True, skip cache (e.g. user-initiated re-check)
        provider_evidence: Pre-gathered provider evidence (if already available)

    Returns:
        TriageResult with tier, verdict, reason, cost, and provider_evidence.
    """
    fingerprint = compute_fingerprint(evidence)
    source_type = evidence.get("source_type", "unknown")

    # ── Step 1: Cache lookup ──
    if not bypass_cache:
        cached = await _cache_lookup(fingerprint, device_id)
        if cached:
            result = TriageResult(
                tier=Tier(cached["tier"]),
                verdict=Verdict(cached["verdict"]),
                reason=f"[Cached] {cached.get('reason', 'Previously resolved.')}",
                escalation_reason=cached.get("escalation_reason"),
                cost_usd=0.0,
                cached=True,
                cache_key=fingerprint,
                source_type=source_type,
                providers_used=cached.get("providers_used", []),
                gemini_calls_prevented=True,
            )
            # SAFETY: Cached SUSPICIOUS must not suppress required action
            # The cache entry still carries the escalation flag
            await record_triage(device_id, fingerprint, result, evidence, cached=True)
            _log.info("triage_cache_hit device=%s fingerprint=%s verdict=%s",
                       device_id, fingerprint[:12], result.verdict.value)
            return result

    # ── Step 2: Gather specialist provider evidence (if not pre-supplied) ──
    if provider_evidence is None:
        provider_evidence = await gather_provider_evidence(evidence)

    # ── Step 3: Tier 0 — Local deterministic screening + provider evidence ──
    tier0_result = _tier0_screen(evidence, findings, provider_evidence)
    if tier0_result is not None:
        tier0_result.cache_key = fingerprint
        tier0_result.source_type = source_type
        await _cache_store(fingerprint, device_id, tier0_result, evidence)
        await record_triage(device_id, fingerprint, tier0_result, evidence)
        _log.info("triage_tier0 device=%s fingerprint=%s verdict=%s providers=%s reason=%s",
                   device_id, fingerprint[:12], tier0_result.verdict.value,
                   tier0_result.providers_used, tier0_result.reason[:80])
        return tier0_result

    # ── Step 4: Tier 1 — Cheap AI triage with provider context ──
    tier1_result = await _tier1_triage(evidence, findings, device_id, correlation_id, provider_evidence)
    tier1_result.cache_key = fingerprint
    tier1_result.source_type = source_type
    await _cache_store(fingerprint, device_id, tier1_result, evidence)
    await record_triage(device_id, fingerprint, tier1_result, evidence)
    _log.info("triage_tier1 device=%s fingerprint=%s verdict=%s cost=$%.6f providers=%s",
               device_id, fingerprint[:12], tier1_result.verdict.value, tier1_result.cost_usd,
               tier1_result.providers_used)
    return tier1_result


# ── Reporting aggregation ───────────────────────────────────────────────────

async def get_triage_stats(start: datetime | None = None, end: datetime | None = None) -> dict:
    """Aggregate triage statistics for the admin dashboard.

    Returns:
        items_screened, tier0_local, tier1_ai, tier2_escalations,
        total_cost, avg_cost_per_item, distribution percentages,
        provider utilisation metrics.
    """
    match: dict = {"record_type": "decision"}
    if start or end:
        ts_filter: dict = {}
        if start:
            ts_filter["$gte"] = start
        if end:
            ts_filter["$lte"] = end
        match["decided_at"] = ts_filter

    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {"tier": "$tier", "verdict": "$verdict"},
            "count": {"$sum": 1},
            "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
            "cached": {"$sum": {"$cond": ["$cached", 1, 0]}},
            "gemini_prevented": {"$sum": {"$cond": [{"$ifNull": ["$gemini_calls_prevented", False]}, 1, 0]}},
        }},
    ]
    rows = await db[COLLECTION].aggregate(pipeline).to_list(50)

    # Provider utilisation aggregation
    provider_pipeline = [
        {"$match": match},
        {"$unwind": {"path": "$providers_used", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$providers_used", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    provider_rows = await db[COLLECTION].aggregate(provider_pipeline).to_list(50)

    total_items = 0
    tier0_count = 0
    tier1_count = 0
    tier2_escalations = 0
    total_cost = 0.0
    cached_count = 0
    gemini_prevented_count = 0

    verdict_counts = {"SAFE": 0, "SUSPICIOUS": 0, "UNCERTAIN": 0}

    for r in rows:
        tier_val = r["_id"]["tier"]
        verdict_val = r["_id"]["verdict"]
        count = r["count"]
        cost = r["cost"]

        total_items += count
        total_cost += cost
        cached_count += r["cached"]
        gemini_prevented_count += r.get("gemini_prevented", 0)

        if verdict_val in verdict_counts:
            verdict_counts[verdict_val] += count

        if tier_val == 0:
            tier0_count += count
        elif tier_val == 1:
            tier1_count += count

        # Tier 2 escalations = SUSPICIOUS + UNCERTAIN
        if verdict_val in ("SUSPICIOUS", "UNCERTAIN"):
            tier2_escalations += count

    avg_cost = total_cost / total_items if total_items > 0 else 0.0
    kpi_met = avg_cost <= 0.001

    provider_utilisation = {r["_id"]: r["count"] for r in provider_rows}

    return {
        "items_screened": total_items,
        "tier0_local": tier0_count,
        "tier1_ai_triage": tier1_count,
        "tier2_escalations": tier2_escalations,
        "cached_resolutions": cached_count,
        "gemini_calls_prevented": gemini_prevented_count,
        "total_cost_usd": round(total_cost, 6),
        "avg_cost_per_item": round(avg_cost, 8),
        "kpi_target": 0.001,
        "kpi_met": kpi_met,
        "distribution": {
            "tier0_pct": round(tier0_count / total_items * 100, 1) if total_items else 0,
            "tier1_pct": round(tier1_count / total_items * 100, 1) if total_items else 0,
            "tier2_pct": round(tier2_escalations / total_items * 100, 1) if total_items else 0,
        },
        "verdicts": verdict_counts,
        "provider_utilisation": provider_utilisation,
    }
