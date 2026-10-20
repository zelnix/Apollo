"""Apollo Triage — Tier 1 server-side entry point. ZERO Gemini calls, always.

Tier 1 (here): deterministic catalogue rules (services/triage) over normalised
    evidence plus specialist provider results. Outcome is one of
    NO THREAT IDENTIFIED / POSSIBLE THREAT IDENTIFIED / LIMITED-UNABLE TO DETERMINE.
Tier 2 (Magnum DI): started by the caller ONLY for POSSIBLE THREAT — one correlated
    case = exactly one Gemini call.

DESIGN PRINCIPLES:
    • No AI triage tier exists. There is no fallback that spends tokens on
      uncertainty, errors, timeouts or missing evidence.
    • Missing evidence is recorded as a Coverage Gap. It can prevent NO THREAT but
      can never create POSSIBLE THREAT, and never downgrades real threat evidence.
    • Cache uses risk-aware expiry (30d possible-threat, 7d no-threat). LIMITED is
      never cached — a transient gap must not suppress a later successful check.
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
from services.triage import Outcome, TriageInvestigation, evaluate, legacy_outcome, run_with_retries

_log = logging.getLogger("apollo.triage")

# ── Result data class ───────────────────────────────────────────────────────

@dataclass
class TriageResult:
    outcome: Outcome
    reason: str
    investigation: Optional[TriageInvestigation] = None
    cached: bool = False
    cache_key: Optional[str] = None
    source_type: str = ""            # "email", "text", etc.
    indicators_summary: dict = field(default_factory=dict)
    provider_evidence: dict = field(default_factory=dict)  # Specialist provider results with provenance
    providers_used: list = field(default_factory=list)      # Which providers contributed
    #: Triage never spends tokens. Kept explicit so cost reporting stays auditable.
    cost_usd: float = 0.0

    @property
    def should_escalate(self) -> bool:
        """Only a deterministic POSSIBLE THREAT may start one Magnum DI investigation."""
        return self.outcome is Outcome.POSSIBLE_THREAT

    @property
    def escalation_reason(self) -> Optional[str]:
        return self.reason if self.outcome is Outcome.POSSIBLE_THREAT else None

    @property
    def coverage_gaps(self) -> list:
        return list(self.investigation.coverage_gaps) if self.investigation else []

    def wire(self) -> dict:
        return {
            "outcome": self.outcome.value,
            "reason": self.reason,
            "cached": self.cached,
            "source_type": self.source_type,
            "providers_used": self.providers_used,
            "geminiCalls": 0,
            "investigation": self.investigation.wire() if self.investigation else None,
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
    await coll.create_index([("outcome", 1)])


# ── Cache TTL policy (risk-aware) ──────────────────────────────────────────

_CACHE_TTL = {
    Outcome.NO_THREAT: timedelta(days=7),         # Deterministically clean
    Outcome.POSSIBLE_THREAT: timedelta(days=30),  # Known-bad indicator
    # LIMITED is never cached — a transient gap must not suppress a later check.
}


def _cache_ttl(outcome: Outcome) -> Optional[timedelta]:
    """Return cache TTL or None if this result should not be cached."""
    return _CACHE_TTL.get(outcome)


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
    ttl = _cache_ttl(result.outcome)
    if ttl is None:
        # Don't cache (LIMITED — the gap may clear on the next check)
        return

    now = now_utc()
    doc = {
        "fingerprint": fingerprint,
        "device_id": device_id,
        "outcome": result.outcome.value,
        "reason": result.reason,
        "cost_usd": 0.0,
        "source_type": result.source_type,
        "providers_used": result.providers_used,
        "rules_met": [r.rule_id for r in result.investigation.met_rules] if result.investigation else [],
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
    investigation = result.investigation
    doc = {
        "record_type": "decision",
        "fingerprint": fingerprint,
        "device_id": device_id,
        "outcome": result.outcome.value,
        "reason": result.reason,
        "cost_usd": 0.0,
        "source_type": result.source_type,
        "cached": cached,
        "providers_used": result.providers_used,
        "gemini_calls": 0,
        "investigation": investigation.wire() if investigation else None,
        "decided_at": now,
    }
    await db[COLLECTION].insert_one(doc)


# ── Evidence extraction ─────────────────────────────────────────────────────

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


def _link_evidence_from_providers(evidence: dict, provider_evidence: dict) -> dict:
    """Normalise specialist provider output into the shared link-evidence shape."""
    sb = provider_evidence.get("safe_browsing", {}).get("urls", {})
    redirects = provider_evidence.get("redirects", {}).get("urls", {})
    rdap = provider_evidence.get("rdap", {}).get("domains", {})

    malicious = [url for url, info in sb.items() if info.get("verdict") == "malicious"]
    unavailable = [url for url, info in sb.items() if info.get("status") in ("unavailable", "not_configured", "error")]
    reputation: dict = {}
    if malicious:
        reputation = {"status": "ok", "verdict": "malicious", "source": "Google Safe Browsing",
                      "threat_types": sb[malicious[0]].get("threat_types", [])}
    elif unavailable:
        reputation = {"status": "unavailable", "verdict": "unknown"}
    elif sb:
        reputation = {"status": "ok", "verdict": "clean"}

    redirect: dict = {}
    for url, info in redirects.items():
        hops = info.get("hops", 0) or 0
        if hops:
            final = info.get("final_url", "")
            redirect = {"status": info.get("status", "ok"), "hops": hops, "final_url": final,
                        "final_verdict": sb.get(final, {}).get("verdict", "unknown")}
            break

    domain_age: dict = {}
    for domain, info in rdap.items():
        if info.get("status") == "ok":
            domain_age = {"status": "ok", "newly_registered": bool(info.get("newly_registered")), "domain": domain}
            if info.get("newly_registered"):
                break
        elif info.get("status") in ("unavailable", "error", "not_configured") and not domain_age:
            domain_age = {"status": "unavailable"}

    return {"reputation": reputation, "redirect": redirect, "domain_age": domain_age}


_CREDENTIAL_WORDS = ("password", "verify", "verification code", "security code", "one-time", "otp",
                     "log in", "login", "sign in", "card number", "cvv", "bank details", "account details")
_PAYMENT_WORDS = ("payid", "osko", "pay id", "transfer now", "immediate payment", "instant transfer")
_FORWARD_CODES = ("*21", "*67", "**21", "*72", "21#", "##21", "*#21")


def _rule_evidence(evidence: dict, findings: list[str], provider_evidence: dict,
                   correlation: Optional[dict] = None) -> dict:
    """Build the shared Triage evidence dict from server-side intake evidence."""
    source_type = evidence.get("source_type", "unknown")
    text = (evidence.get("text_preview") or "").lower()
    subject = (evidence.get("subject") or "").lower()
    blob = f"{subject} {text}"
    finding_blob = " ".join(findings).lower()

    providers = _link_evidence_from_providers(evidence, provider_evidence)
    sender_domain = (evidence.get("sender_domain") or "").lower()
    link_domains = [str(d).lower() for d in (evidence.get("link_domains") or [])]
    domain_mismatch = bool(sender_domain and link_domains and all(
        d != sender_domain and not d.endswith("." + sender_domain) and not sender_domain.endswith("." + d)
        for d in link_domains))

    credential_request = any(word in blob for word in _CREDENTIAL_WORDS) or "credential" in finding_blob
    code_request = any(word in blob for word in ("verification code", "security code", "one-time", "otp", "2fa"))
    attachments = [str(name) for name in (evidence.get("attachment_names") or [])]
    risky_attachment = any(("." + name.rsplit(".", 1)[-1].lower()) in _RISKY_ATTACHMENT_EXT
                          for name in attachments if "." in name)

    shared: dict = {
        "source_type": source_type,
        "sender_domain": sender_domain,
        "link_domains": link_domains,
        "findings": findings,
        "auth_results": evidence.get("auth_results") or {},
        "reply_to_mismatch": (bool(evidence.get("reply_to_domain")) and evidence.get("reply_to_domain") != sender_domain)
                             if evidence.get("auth_results") or evidence.get("reply_to_domain") else None,
        "sender_domain_mismatch": domain_mismatch,
        "claimed_brand": evidence.get("claimed_brand"),
        "brand_mismatch": domain_mismatch,
        "credential_request": credential_request,
        "credential_interaction": credential_request,
        "identity_request": any(word in blob for word in ("date of birth", "medicare", "passport", "licence", "tax file")),
        "banking_request": any(word in blob for word in ("bank details", "card number", "cvv", "bsb")),
        "payment_change": "changed" in finding_blob and "bank" in finding_blob,
        "consequential_action": credential_request or code_request or any(
            word in blob for word in ("pay", "transfer", "invoice", "refund", "confirm your")),
        "attachment_outcome": Outcome.POSSIBLE_THREAT.value if risky_attachment else None,
        "link_outcome": Outcome.POSSIBLE_THREAT.value if providers["reputation"].get("verdict") == "malicious" else None,
        "correlation": correlation or {},
        **providers,
    }

    if source_type in ("text", "sms", "message"):
        shared["signals"] = {
            "code_request": code_request,
            "login_request": any(word in blob for word in ("log in", "login", "sign in", "verify your account", "unlock your account")),
            "identity_request": shared["identity_request"] or shared["banking_request"],
            "safe_account": any(word in blob for word in ("safe account", "secure account", "protected account")),
            "gift_cards": "gift card" in blob or "itunes" in blob or "voucher code" in blob,
            "remote_access": any(word in blob for word in ("anydesk", "teamviewer", "remote access", "remote support")),
            "install_request": any(word in blob for word in ("install this", "download this app", "install our app")),
            "extortion": any(word in blob for word in ("hacked", "recorded you", "webcam", "expose")),
            "advance_fee": "release fee" in blob or "processing fee" in blob or "clearance fee" in blob,
            "fake_payment": any(word in blob for word in ("payment has been sent", "you've been paid", "already paid")),
            "family_claim": any(word in blob for word in ("hi mum", "hi mom", "hi dad", "it's me")),
            "new_number": any(word in blob for word in ("new number", "new phone", "lost my phone", "broke my phone")),
            "money_request": any(word in blob for word in ("send money", "transfer", "lend me", "pay the bill")),
            "payment_request": any(word in blob for word in ("pay", "payment", "invoice", "fee", "overdue")),
            "guaranteed_returns": "guaranteed" in blob or "risk-free" in blob or "passive income" in blob,
            "job_offer": "job" in blob or "hiring" in blob or "recruiter" in blob,
            "romance_escalation": any(word in blob for word in ("my love", "darling", "sweetheart")) and "money" in blob,
            "platform_switch": any(word in blob for word in ("telegram", "whatsapp", "signal", "wechat")),
            "urgency": any(word in blob for word in ("urgent", "immediately", "final notice", "expires", "act now")),
            "threat": any(word in blob for word in ("suspended", "locked", "penalty", "fine", "legal action", "arrest")),
            "unknown_sender": not sender_domain,
            "claimed_brand": evidence.get("claimed_brand"),
            "brand_kind": evidence.get("brand_kind"),
            "instant_payment": any(word in blob for word in _PAYMENT_WORDS),
            "payment_change": shared["payment_change"],
            "forwarding_code": any(code in blob for code in _FORWARD_CODES),
            "forwarding_intent": "divert" in blob or "forward your calls" in blob or "redirect your messages" in blob,
            "callback_request": any(word in blob for word in ("call us", "call this number", "contact us on", "fraud response")),
            "alleged_charge": any(word in blob for word in ("unauthorised charge", "unauthorized charge", "suspicious transaction", "merchant:")),
        }
        phones = provider_evidence.get("ipqs", {}).get("phones", {})
        for phone, info in phones.items():
            if info.get("status") == "ok":
                score = info.get("fraud_score") or 0
                shared["phone_reputation"] = {"status": "ok", "verdict": "malicious" if score >= 85 else "clean",
                                              "fraud_score": score, "number": phone}
            else:
                shared.setdefault("phone_reputation", {"status": "unavailable", "verdict": "unknown"})
            break

    if source_type == "email" and not evidence.get("auth_results"):
        shared["auth_results"] = {}

    scam_matches = provider_evidence.get("scam_intel", {}).get("matches", [])
    if any(m.get("severity") in ("high", "critical") for m in scam_matches):
        shared["indicator_match"] = True
        shared["local_level"] = "malicious"
        shared["local_signals"] = ["active_scam_advisory_match"]

    return shared


_RISKY_ATTACHMENT_EXT = {".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".js", ".vbs", ".wsf",
                         ".msi", ".dll", ".hta", ".ps1", ".reg", ".lnk", ".iso", ".img", ".cab"}


# ── Main triage entry point ────────────────────────────────────────────────

async def triage_item(
    device_id: str,
    evidence: dict,
    findings: list[str],
    correlation_id: str,
    *,
    bypass_cache: bool = False,
    provider_evidence: Optional[dict] = None,
    correlation: Optional[dict] = None,
) -> TriageResult:
    """Deterministic Triage Investigation. Makes ZERO Gemini calls.

    1. Cache lookup (an identical indicator already resolved deterministically).
    2. Gather specialist provider evidence, with bounded retries for transient failures.
    3. Evaluate the canonical rule catalogue.

    Tier 2 (Magnum DI) is NOT invoked here — the caller starts exactly one
    investigation per correlated case when result.should_escalate is True.
    """
    fingerprint = compute_fingerprint(evidence)
    source_type = evidence.get("source_type", "unknown")

    if not bypass_cache:
        cached = await _cache_lookup(fingerprint, device_id)
        if cached:
            outcome_value = cached.get("outcome")
            outcome = Outcome(outcome_value) if outcome_value in {o.value for o in Outcome} else legacy_outcome(cached.get("verdict", ""))
            result = TriageResult(
                outcome=outcome,
                reason=f"[Previously checked] {cached.get('reason', 'Resolved deterministically.')}",
                cached=True,
                cache_key=fingerprint,
                source_type=source_type,
                providers_used=cached.get("providers_used", []),
            )
            await record_triage(device_id, fingerprint, result, evidence, cached=True)
            _log.info("triage_cache_hit device=%s fingerprint=%s outcome=%s",
                      device_id, fingerprint[:12], result.outcome.value)
            return result

    retries: list = []
    if provider_evidence is None:
        provider_evidence, retry_record = await run_with_retries(
            "specialist_provider_evidence", lambda: gather_provider_evidence(evidence))
        retries.append(retry_record)
        if provider_evidence is None:
            provider_evidence = {}

    rule_evidence = _rule_evidence(evidence, findings, provider_evidence, correlation)
    investigation = evaluate(rule_evidence, investigation_id=correlation_id, retries=retries)

    result = TriageResult(
        outcome=investigation.outcome,
        reason=investigation.reason,
        investigation=investigation,
        cache_key=fingerprint,
        source_type=source_type,
        provider_evidence=provider_evidence,
        providers_used=provider_evidence.get("_summary", {}).get("providers_consulted", []),
    )
    await _cache_store(fingerprint, device_id, result, evidence)
    await record_triage(device_id, fingerprint, result, evidence)
    _log.info("triage_deterministic device=%s fingerprint=%s outcome=%s rules_met=%s gaps=%s",
              device_id, fingerprint[:12], result.outcome.value,
              [r.rule_id for r in investigation.met_rules],
              [g.code for g in investigation.coverage_gaps])
    return result


# ── Reporting aggregation ───────────────────────────────────────────────────

async def get_triage_stats(start: datetime | None = None, end: datetime | None = None) -> dict:
    """Aggregate Triage statistics for the admin dashboard.

    Triage spends nothing, so cost reporting exists only to prove that: every
    deterministic decision is $0 and Magnum DI escalations equal POSSIBLE THREAT count.
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
            "_id": {"outcome": {"$ifNull": ["$outcome", "$verdict"]}},
            "count": {"$sum": 1},
            "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
            "cached": {"$sum": {"$cond": ["$cached", 1, 0]}},
        }},
    ]
    rows = await db[COLLECTION].aggregate(pipeline).to_list(50)

    provider_pipeline = [
        {"$match": match},
        {"$unwind": {"path": "$providers_used", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$providers_used", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    provider_rows = await db[COLLECTION].aggregate(provider_pipeline).to_list(50)

    total_items = 0
    total_cost = 0.0
    cached_count = 0
    outcomes = {o.value: 0 for o in Outcome}

    for row in rows:
        raw = row["_id"]["outcome"] or ""
        value = raw if raw in outcomes else legacy_outcome(raw).value
        count = row["count"]
        total_items += count
        total_cost += row["cost"]
        cached_count += row["cached"]
        outcomes[value] += count

    escalations = outcomes[Outcome.POSSIBLE_THREAT.value]
    resolved_without_ai = total_items - escalations

    return {
        "items_screened": total_items,
        "triage_deterministic": total_items,
        "magnum_di_escalations": escalations,
        "resolved_without_ai": resolved_without_ai,
        "cached_resolutions": cached_count,
        "gemini_calls_prevented": resolved_without_ai,
        "total_cost_usd": round(total_cost, 6),
        "avg_cost_per_item": round(total_cost / total_items, 8) if total_items else 0.0,
        "kpi_target": 0.0,
        "kpi_met": total_cost == 0.0,
        "distribution": {
            "no_threat_pct": round(outcomes[Outcome.NO_THREAT.value] / total_items * 100, 1) if total_items else 0,
            "possible_threat_pct": round(escalations / total_items * 100, 1) if total_items else 0,
            "limited_pct": round(outcomes[Outcome.LIMITED.value] / total_items * 100, 1) if total_items else 0,
        },
        "outcomes": outcomes,
        "provider_utilisation": {row["_id"]: row["count"] for row in provider_rows},
    }
