"""Trusted-source hierarchy for the Apollo Knowledge Base.

Tier 1 — authoritative: government agencies, regulators, law enforcement, national cyber-security authorities.
Tier 2 — established security research: recognised research organisations and reputable security vendors.
Tier 3 — supporting: credible specialist or consumer-advocacy sources.
Anything not listed here never becomes Apollo knowledge. Tavily is how pages are found, never the source.

`republish` marks sources whose licence lets Apollo reproduce their words in a Learn with Higgins article;
every other source is quoted only briefly in Higgins' answers, with a link to read the rest.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

TIER_1 = "tier_1_authoritative"
TIER_2 = "tier_2_security_research"
TIER_3 = "tier_3_supporting"
TIER_LABEL = {TIER_1: "Official authority", TIER_2: "Established security research", TIER_3: "Supporting source",
              "apollo_curated": "Learn with Higgins", "ai_generated": "Written by AI (not verified by a source)"}
JURISDICTION_LABEL = {"AU": "Australia", "US": "United States", "UK": "United Kingdom", "EU": "European Union", "NZ": "New Zealand",
                      "CA": "Canada", "INTL": "International"}

_CC_BY_4 = "CC BY 4.0"
_US_GOV = "US Government work (public domain)"
_OGL = "Open Government Licence v3.0"


@dataclass(frozen=True)
class KbSource:
    domain: str
    publisher: str
    tier: str
    jurisdiction: str
    source_id: str = ""          # learning_sources id used for Scam Alerts and Learn citations (Tier 1 only)
    licence: str = ""
    attribution: str = ""
    republish: bool = False


SOURCES: tuple[KbSource, ...] = (
    # ── Tier 1 — Australia ──
    KbSource("cyber.gov.au", "Australian Cyber Security Centre", TIER_1, "AU", "acsc", _CC_BY_4,
             "© Commonwealth of Australia (Australian Signals Directorate), licensed under CC BY 4.0.", True),
    KbSource("scamwatch.gov.au", "Scamwatch (ACCC)", TIER_1, "AU", "scamwatch", "CC BY 3.0 AU",
             "© Commonwealth of Australia (ACCC), licensed under CC BY 3.0 AU.", True),
    KbSource("accc.gov.au", "Australian Competition and Consumer Commission", TIER_1, "AU", "kb-accc"),
    KbSource("esafety.gov.au", "eSafety Commissioner", TIER_1, "AU", "esafety"),
    KbSource("moneysmart.gov.au", "Moneysmart (ASIC)", TIER_1, "AU", "moneysmart"),
    KbSource("asic.gov.au", "Australian Securities and Investments Commission", TIER_1, "AU", "kb-asic"),
    KbSource("oaic.gov.au", "Office of the Australian Information Commissioner", TIER_1, "AU", "kb-oaic"),
    KbSource("afp.gov.au", "Australian Federal Police", TIER_1, "AU", "kb-afp"),
    KbSource("acma.gov.au", "Australian Communications and Media Authority", TIER_1, "AU", "kb-acma"),
    KbSource("ato.gov.au", "Australian Taxation Office", TIER_1, "AU", "kb-ato"),
    KbSource("servicesaustralia.gov.au", "Services Australia", TIER_1, "AU", "kb-servicesaustralia"),
    # ── Tier 1 — overseas ──
    KbSource("consumer.ftc.gov", "US Federal Trade Commission", TIER_1, "US", "ftc", _US_GOV, "US Federal Trade Commission.", True),
    KbSource("ftc.gov", "US Federal Trade Commission", TIER_1, "US", "ftc", _US_GOV, "US Federal Trade Commission.", True),
    KbSource("cisa.gov", "US Cybersecurity and Infrastructure Security Agency", TIER_1, "US", "kb-cisa", _US_GOV,
             "US Cybersecurity and Infrastructure Security Agency.", True),
    KbSource("ic3.gov", "FBI Internet Crime Complaint Center (IC3)", TIER_1, "US", "ic3", _US_GOV, "FBI Internet Crime Complaint Center.", True),
    KbSource("fbi.gov", "US Federal Bureau of Investigation", TIER_1, "US", "ic3", _US_GOV, "US Federal Bureau of Investigation.", True),
    KbSource("ncsc.gov.uk", "UK National Cyber Security Centre", TIER_1, "UK", "ncsc_uk", _OGL,
             "UK National Cyber Security Centre, licensed under the Open Government Licence v3.0.", True),
    KbSource("actionfraud.police.uk", "Action Fraud (UK)", TIER_1, "UK", "kb-actionfraud"),
    KbSource("fca.org.uk", "UK Financial Conduct Authority", TIER_1, "UK", "kb-fca"),
    KbSource("ncsc.govt.nz", "New Zealand National Cyber Security Centre", TIER_1, "NZ", "kb-ncsc-nz"),
    KbSource("cyber.gc.ca", "Canadian Centre for Cyber Security", TIER_1, "CA", "kb-cccs"),
    KbSource("antifraudcentre-centreantifraude.ca", "Canadian Anti-Fraud Centre", TIER_1, "CA", "kb-cafc"),
    KbSource("enisa.europa.eu", "European Union Agency for Cybersecurity (ENISA)", TIER_1, "EU", "enisa"),
    KbSource("europol.europa.eu", "Europol", TIER_1, "EU", "europol"),
    # ── Tier 2 — established security research ──
    KbSource("welivesecurity.com", "ESET WeLiveSecurity", TIER_2, "INTL"),
    KbSource("malwarebytes.com", "Malwarebytes", TIER_2, "INTL"),
    KbSource("sophos.com", "Sophos", TIER_2, "INTL"),
    KbSource("securelist.com", "Kaspersky Securelist", TIER_2, "INTL"),
    KbSource("proofpoint.com", "Proofpoint", TIER_2, "INTL"),
    KbSource("unit42.paloaltonetworks.com", "Palo Alto Networks Unit 42", TIER_2, "INTL"),
    KbSource("microsoft.com", "Microsoft Security", TIER_2, "INTL"),
    KbSource("security.googleblog.com", "Google Security Blog", TIER_2, "INTL"),
    KbSource("research.checkpoint.com", "Check Point Research", TIER_2, "INTL"),
    KbSource("trendmicro.com", "Trend Micro", TIER_2, "INTL"),
    KbSource("bitdefender.com", "Bitdefender", TIER_2, "INTL"),
    # ── Tier 3 — supporting ──
    KbSource("idcare.org", "IDCARE", TIER_3, "AU"),
    KbSource("choice.com.au", "CHOICE", TIER_3, "AU"),
    KbSource("which.co.uk", "Which?", TIER_3, "UK"),
    KbSource("consumer.org.nz", "Consumer NZ", TIER_3, "NZ"),
    KbSource("krebsonsecurity.com", "Krebs on Security", TIER_3, "INTL"),
)


def domains(tier: str) -> tuple[str, ...]:
    return tuple(source.domain for source in SOURCES if source.tier == tier)


def source_for(url: str) -> KbSource | None:
    """The listed source a URL belongs to (most specific domain wins), or None when it isn't trusted."""
    parsed = urlparse(url or "")
    if parsed.scheme != "https":
        return None
    host = (parsed.hostname or "").lower()
    matches = [s for s in SOURCES if host == s.domain or host.endswith("." + s.domain)]
    return max(matches, key=lambda s: len(s.domain)) if matches else None


def source_regions() -> dict[str, str]:
    """learning_sources id → jurisdiction, for the Tier 1 sources Apollo adds itself."""
    return {s.source_id: s.jurisdiction for s in SOURCES if s.source_id.startswith("kb-")}


def learning_source_docs() -> list[dict]:
    """learning_sources rows for Tier 1 publishers that don't have a government feed of their own yet."""
    rows: dict[str, dict] = {}
    for s in SOURCES:
        if s.tier == TIER_1 and s.source_id.startswith("kb-") and s.source_id not in rows:
            rows[s.source_id] = {"sourceId": s.source_id, "name": s.publisher, "organisation": s.publisher,
                                 "canonicalBaseUrls": [f"https://www.{s.domain}"], "sourceType": "official_guidance",
                                 "governmentAuthority": True, "allowedHosts": [s.domain, f"www.{s.domain}"],
                                 "citationDisplay": s.publisher, "active": True, "country": s.jurisdiction, "region": s.jurisdiction}
    return list(rows.values())
