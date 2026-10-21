"""AI-grounded scam-report analysis.

Reads the FULL text of a single official advisory (fetched from its own source URL) and asks
Gemini 3.1 Pro to (1) classify it into one of three tiers, (2) extract only the facts that are
literally present in the source, (3) assign an evidence-backed severity with a cited reason, and
(4) write plain-English, scam-specific sections for Higgins. The model is told, hard, to never use
outside knowledge or invent any detail — missing facts come back empty, and thin/vague reports are
downgraded to general education. Each item is analysed once and the result cached on the feed item.
"""
from __future__ import annotations

import json
import logging
import os
import re
from html.parser import HTMLParser
from pathlib import Path

from dotenv import load_dotenv

from core.db import db, now_utc
from services.outbound import OutboundBlocked, public_get

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logger = logging.getLogger("apollo")

ANALYSIS_VERSION = 5
# Model is now configured via GEMINI_ADVISORY_MODEL env var in provider.py
_MAX_ARTICLE_CHARS = 14000

TIERS = {"specific_scam", "emerging_pattern", "general_education"}
SEVERITIES = {"LOW", "MODERATE", "HIGH", "EXTREME"}
RELEVANCES = {"confirmed", "potential", "overseas_only", "unknown"}
AUDIENCES = {"consumer", "organisation"}

SYSTEM = (
    "You classify scam/fraud alerts for Apollo, which protects ordinary people on their phones. "
    "You receive ONE article from an approved government/official cyber-security source. "
    "Extract ONLY facts explicitly stated in the supplied text.\n\n"
    "RULES:\n"
    "- Text-only: never use outside knowledge. Never invent names, dates, numbers, places, URLs or claims not in the text. Empty string if absent.\n"
    "- No filler: every sentence must be specific to THIS article. No generic advice.\n"
    "- Full names: write organisation names in full on first use, e.g. 'National Cyber Security Centre (NCSC)'. Never an unexplained acronym.\n\n"
    "AUDIENCE — set 'audience':\n"
    "- 'consumer': affects everyday people (phishing, impersonation, fake offers, investment/romance/job/refund scams, account-takeover, data breaches of consumer services, current scam trends).\n"
    "- 'organisation': enterprise/technical/infrastructure/national-security only — software patches, APT/state-sponsored activity, targeted surveillance of specific individuals. NOT consumer scams.\n"
    "Only 'consumer' items may be 'specific_scam' or 'emerging_pattern'. 'organisation' → 'general_education'.\n\n"
    "TIER — exactly one:\n"
    "- 'specific_scam': consumer warning about a scam, fraud, breach or threat. Any current consumer warning from a trusted source qualifies.\n"
    "- 'emerging_pattern': consumer-facing trend or rising pattern, not one specific incident.\n"
    "- 'general_education': NOT a current consumer threat — background tips, organisation-audience reports, nav/index pages, unrelated news. When uncertain vs 'emerging_pattern', prefer 'emerging_pattern'.\n\n"
    "SEVERITY (evidence-based only):\n"
    "- EXTREME: active + serious harm + explicit urgency/scale signals in text.\n"
    "- HIGH: active campaign or current warning with serious potential harm.\n"
    "- MODERATE: credible threat, limited evidence of severe/urgent harm.\n"
    "- LOW: general_education only.\n"
    "Do NOT assign HIGH/EXTREME from broad category alone. 'severityReason' must cite specific text evidence.\n\n"
    "AUSTRALIAN RELEVANCE: 'confirmed' (text names Australia or Australian source), 'potential' (technique could reach AU), 'overseas_only', or 'unknown'.\n\n"
    "Return a SINGLE JSON object:\n"
    "{\n"
    '  "tier": "specific_scam|emerging_pattern|general_education",\n'
    '  "audience": "consumer|organisation",\n'
    '  "severity": "LOW|MODERATE|HIGH|EXTREME",\n'
    '  "severityReason": "specific text evidence",\n'
    '  "confidence": "high|medium|low",\n'
    '  "australianRelevance": "confirmed|potential|overseas_only|unknown",\n'
    '  "australianRelevanceReason": "",\n'
    '  "reportedDate": "YYYY-MM-DD or YYYY-MM from text; empty if unstated",\n'
    '  "facts": {"who":"","what":"","how":"","where":"","when":"","whatCriminalsWant":"","evidence":""},\n'
    '  "sections": {\n'
    '     "whatHappened": "the reported fraudulent activity with identifiable details",\n'
    '     "whereHappening": "verified locations/dates from text only",\n'
    '     "whatItMeansForYou": "how this affects the reader; distinguish confirmed local vs possible overseas",\n'
    '     "whatToWatch": "exact messages/requests/sites/impersonations/warning signs from this report",\n'
    '     "whatToDo": "actions specific to this scam, incl. recovery steps if text provides them"\n'
    "  }\n"
    "}\n"
    "Plain Australian English. If the report lacks detail for a section, say so honestly — never generic filler."
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in ("script", "style", "noscript", "svg", "head"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg", "head") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip:
            text = data.strip()
            if text:
                self.parts.append(text)


def _html_to_text(raw: bytes) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(raw.decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001 — a malformed page must not crash analysis
        return ""
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


async def _fetch_article_text(url: str) -> str:
    try:
        response = await public_get(url, max_hops=3)
        if response.status_code != 200:
            return ""
        return _html_to_text(response.content)[:_MAX_ARTICLE_CHARS]
    except (OutboundBlocked, Exception):  # noqa: BLE001 — offline/blocked source is handled by the caller
        return ""


_DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


def _clean_date(value) -> str:
    value = str(value or "").strip()[:10]
    return value if _DATE_RE.match(value) else ""


def _coerce(parsed: dict) -> dict:
    """Validate and clamp the model output to Apollo's contract. Anything out of range falls back to the
    safest honest value so a malformed response can never fabricate a High-severity alert."""
    tier = parsed.get("tier") if parsed.get("tier") in TIERS else "general_education"
    audience = parsed.get("audience") if parsed.get("audience") in AUDIENCES else "consumer"
    # Apollo only surfaces consumer scams. An organisation-audience report (company data breach,
    # vulnerability advisory, enterprise incident) can never be a specific/emerging alert.
    if audience != "consumer":
        tier = "general_education"
    severity = parsed.get("severity") if parsed.get("severity") in SEVERITIES else "LOW"
    if tier == "general_education":
        severity = "LOW"
    relevance = parsed.get("australianRelevance") if parsed.get("australianRelevance") in RELEVANCES else "unknown"
    facts_in = parsed.get("facts") or {}
    facts = {k: str(facts_in.get(k, "") or "")[:600] for k in ("who", "what", "how", "where", "when", "whatCriminalsWant", "evidence")}
    sec_in = parsed.get("sections") or {}
    sections = {k: str(sec_in.get(k, "") or "")[:900] for k in ("whatHappened", "whereHappening", "whatItMeansForYou", "whatToWatch", "whatToDo")}
    return {
        "tier": tier,
        "audience": audience,
        "severity": severity,
        "severityReason": str(parsed.get("severityReason", "") or "")[:600],
        "confidence": parsed.get("confidence") if parsed.get("confidence") in ("high", "medium", "low") else "low",
        "australianRelevance": relevance,
        "australianRelevanceReason": str(parsed.get("australianRelevanceReason", "") or "")[:600],
        "reportedDate": _clean_date(parsed.get("reportedDate")),
        "facts": facts,
        "sections": sections,
        "analysisVersion": ANALYSIS_VERSION,
        "analyzedAt": now_utc(),
    }


def _parse_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        return None


async def _run_model(prompt: str) -> dict | None:
    """Route through Apollo's single authoritative Gemini gateway (provider.py).

    Uses the owner-managed GEMINI_API_KEY via provider.generate_json with explicit
    purpose=PUBLIC_ADVISORY_ANALYSIS. Privacy boundary enforcement (credential stripping,
    third-party PII controls) is applied by the gateway before transmission.
    """
    from services.higgins.provider import ProviderFailure, generate_json, ADVISORY_MODEL
    from services.higgins.llm_boundary import Purpose
    try:
        result, _metadata = await generate_json(
            SYSTEM, prompt,
            model=ADVISORY_MODEL,
            capability="text",
            purpose=Purpose.PUBLIC_ADVISORY_ANALYSIS,
            correlation_id="scam-analysis",
            trigger_source="scam_analysis",
        )
        return result
    except ProviderFailure as exc:
        logger.warning("scam_analysis: provider call failed (%s)", exc.code)
        return None
    except Exception as exc:  # noqa: BLE001 — provider/transport errors leave the item unanalysed for retry
        logger.warning("scam_analysis: model call failed (%s)", type(exc).__name__)
        return None


async def analyze_item(item: dict) -> dict | None:
    """Fetch + analyse one feed item. Returns the cached-shape analysis dict, or None if the model was
    unreachable (so the item stays unanalysed and is retried next cycle)."""
    article = await _fetch_article_text(item.get("url") or "")
    source_region = item.get("_source_region") or ""
    prompt = (
        f"SOURCE: {item.get('_source_name') or item.get('source_id')} ({source_region})\n"
        f"PUBLISHED: {item.get('published_at') or 'unknown'}\n"
        f"HEADLINE: {item.get('title') or ''}\n"
        f"SUMMARY: {item.get('summary') or ''}\n\n"
        f"ARTICLE TEXT (verbatim from the source; may be empty if the page could not be read):\n"
        f"{article or '(the full article could not be retrieved — rely only on the headline and summary above)'}"
    )
    parsed = await _run_model(prompt)
    if parsed is None:
        return None
    return _coerce(parsed)


_NOT_ALERT_TITLE = re.compile(r"\b(skip to (navigation|content|main)|browse news|news and alerts|search|sign in|log in|home page|menu|current page|next page|previous page|first page|last page|page \d+)\b|^[»«›‹\s\d]+$", re.I)


def _obviously_not_an_alert(row: dict) -> bool:
    """Cheap, no-cost filter for feed rows that are plainly navigation/index links (e.g. fragment URLs
    like '#megamenu-skip', or 'Skip to content'). These are classified as education without spending an
    AI call. It only ever downgrades — it can never promote anything to an alert."""
    url = row.get("url") or ""
    title = row.get("title") or ""
    if "#" in url:
        return True
    return bool(_NOT_ALERT_TITLE.search(title))


_SKIPPED_ANALYSIS = {
    "tier": "general_education", "audience": "consumer", "severity": "LOW",
    "severityReason": "This is a navigation or index link from the source site, not a report of a specific scam.",
    "confidence": "high", "australianRelevance": "unknown", "australianRelevanceReason": "", "reportedDate": "",
    "facts": {k: "" for k in ("who", "what", "how", "where", "when", "whatCriminalsWant", "evidence")},
    "sections": {k: "" for k in ("whatHappened", "whereHappening", "whatItMeansForYou", "whatToWatch", "whatToDo")},
    "analysisVersion": ANALYSIS_VERSION,
}


async def analyze_pending(limit: int = 8) -> int:
    """Analyse up to `limit` feed items that have no current analysis, caching the result on each item.
    Safe to call repeatedly; it only touches items missing ANALYSIS_VERSION."""
    query = {"$or": [{"scam_analysis": {"$exists": False}}, {"scam_analysis.analysisVersion": {"$ne": ANALYSIS_VERSION}}]}
    rows = await db.learning_feed_items.find(query).sort("published_at", -1).limit(max(1, limit) * 4).to_list(max(1, limit) * 4)
    if not rows:
        return 0
    from services import scam_intel
    source_ids = list({r["source_id"] for r in rows})
    sources = {s["source_id"]: s for s in await db.learning_sources.find({"source_id": {"$in": source_ids}}, {"_id": 0}).to_list(100)}
    done = 0
    for row in rows:
        if _obviously_not_an_alert(row):
            await db.learning_feed_items.update_one({"fingerprint": row["fingerprint"]}, {"$set": {"scam_analysis": {**_SKIPPED_ANALYSIS, "analyzedAt": now_utc()}}})
            continue  # free classification; does not count against the AI budget for this cycle
        src = sources.get(row["source_id"], {})
        row["_source_name"] = src.get("name") or row["source_id"]
        row["_source_region"] = scam_intel.region_for(row["source_id"])
        analysis = await analyze_item(row)
        if analysis is None:
            continue
        await db.learning_feed_items.update_one({"fingerprint": row["fingerprint"]}, {"$set": {"scam_analysis": analysis}})
        done += 1
        if done >= limit:
            break
    return done
