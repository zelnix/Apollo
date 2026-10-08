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
MODEL = ("gemini", "gemini-3.1-pro-preview")
_MAX_ARTICLE_CHARS = 14000

TIERS = {"specific_scam", "emerging_pattern", "general_education"}
SEVERITIES = {"LOW", "MODERATE", "HIGH", "EXTREME"}
RELEVANCES = {"confirmed", "potential", "overseas_only", "unknown"}
AUDIENCES = {"consumer", "organisation"}

SYSTEM = (
    "You are Apollo's scam-intelligence analyst. Apollo protects ORDINARY MEMBERS OF THE PUBLIC (everyday "
    "people on their personal phones) from scams and fraud. You are given the text of ONE article published "
    "by an official government or cyber-security authority. Your job is to classify it and extract ONLY facts "
    "that are explicitly stated in the supplied text.\n\n"
    "ABSOLUTE RULES:\n"
    "- Use ONLY the supplied article text. Never use outside knowledge. Never invent or infer names, dates, "
    "numbers, places, URLs, or claims that are not written in the text.\n"
    "- If a fact is not in the text, return an empty string for that field. Do not guess.\n"
    "- Never pad with generic fraud advice (e.g. 'scammers may steal your money', 'fraudsters create fake "
    "websites'). Every sentence you write must be specific to THIS report or plainly say the report does not "
    "state it.\n"
    "- ACRONYMS: never use an abbreviation or acronym on its own. The first time you name any organisation or "
    "scheme, write its FULL name followed by the abbreviation in brackets, e.g. 'National Cyber Security "
    "Centre (NCSC)'. If the full name is not in the supplied text, write the name exactly as the text gives "
    "it and do not introduce an unexplained acronym.\n\n"
    "AUDIENCE — does this affect ORDINARY MEMBERS OF THE PUBLIC? Set 'audience' to:\n"
    "- 'consumer': relevant to everyday people — a scam or fraud aimed at the public (phishing texts/emails/"
    "calls, impersonation of a trusted brand, bank or government agency, fake websites/offers, investment/"
    "romance/job/remote-access/refund scams), OR a security incident or data breach of a consumer brand, shop, "
    "app or service that ordinary people use (their customers' accounts or personal details are affected). A "
    "breach of a well-known consumer retailer or app IS relevant because its customers are members of the "
    "public.\n"
    "- 'organisation': purely enterprise, technical, infrastructure or national-security matters that an "
    "ordinary member of the public cannot act on and that are NOT about everyday consumer fraud — e.g. a "
    "software vulnerability or patch advisory aimed at IT administrators, a business-to-business incident, an "
    "attack on critical infrastructure, or nation-state / state-sponsored / espionage / advanced-persistent-"
    "threat (APT) activity, INCLUDING targeted surveillance or spyware aimed at specific individuals such as "
    "activists, journalists, dissidents, politicians or officials. These are NOT consumer scams even though "
    "they involve cybercrime.\n"
    "Apollo ONLY shows items relevant to the public. If 'audience' is 'organisation', you MUST set tier to "
    "'general_education'. Only 'consumer' items may be 'specific_scam' or 'emerging_pattern'.\n\n"
    "CLASSIFY into exactly one tier:\n"
    "- 'specific_scam': a consumer-relevant article describing a particular, identifiable scam campaign with "
    "distinctive behaviour (a named impersonated organisation/person, a specific fraudulent offer or message, "
    "or a specific method against the public) OR a specific security incident or data breach of a named "
    "consumer brand, shop, app or service that directly affects its customers.\n"
    "- 'emerging_pattern': a consumer-facing article documenting several scam incidents forming a recognisable "
    "technique, but naming no single specific campaign.\n"
    "- 'general_education': background/explainer/awareness/tips about broad fraud types, OR an "
    "organisation-audience report, OR text without enough specific detail to describe a particular consumer "
    "incident. When in doubt, choose this.\n\n"
    "SEVERITY (justified ONLY by evidence in the text):\n"
    "- 'EXTREME': an active campaign with serious harm (money, identity, account/credential takeover) AND "
    "explicit urgency or scale signals.\n"
    "- 'HIGH': an active campaign with serious harm, without strong urgency/scale.\n"
    "- 'MODERATE': a credible described scam with limited evidence of severe or urgent harm.\n"
    "- 'LOW': use for general_education.\n"
    "Do NOT assign HIGH/EXTREME merely because a broad category (investment fraud, identity theft, etc.) can be "
    "harmful. 'severityReason' MUST cite the specific evidence from the text that supports the rating.\n\n"
    "AUSTRALIAN RELEVANCE: 'confirmed' (the text names Australia or is from an Australian authority), 'potential' "
    "(technique could reach Australia but the text doesn't say so), 'overseas_only' (text describes overseas "
    "activity only), or 'unknown'.\n\n"
    "Return a SINGLE JSON object and nothing else, with exactly these keys:\n"
    "{\n"
    '  "tier": "specific_scam|emerging_pattern|general_education",\n'
    '  "audience": "consumer|organisation",\n'
    '  "severity": "LOW|MODERATE|HIGH|EXTREME",\n'
    '  "severityReason": "cites the specific evidence in the text",\n'
    '  "confidence": "high|medium|low",\n'
    '  "australianRelevance": "confirmed|potential|overseas_only|unknown",\n'
    '  "australianRelevanceReason": "",\n'
    '  "reportedDate": "YYYY-MM-DD or YYYY-MM — the publication/report date of THIS specific scam as stated in the text; use the single most recent concrete date stated for this scam; empty string if the text states no date",\n'
    '  "facts": {"who":"","what":"","how":"","where":"","when":"","whatCriminalsWant":"","evidence":""},\n'
    '  "sections": {\n'
    '     "whatHappened": "the actual reported fraudulent activity, with the identifiable details",\n'
    '     "whereHappening": "only the verified locations/dates in the text",\n'
    '     "whatItMeansForYou": "how this specific report could affect the reader; distinguish confirmed local vs possible overseas",\n'
    '     "whatToWatch": "the exact messages/requests/sites/impersonations/warning signs in this report",\n'
    '     "whatToDo": "actions specific to this reported scam, incl. recovery steps if the text gives them"\n'
    "  }\n"
    "}\n"
    "Each 'sections' value must be plain Australian English. If the report lacks detail for a section, write a "
    "short honest sentence saying the report does not specify it — never generic filler."
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
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        logger.warning("scam_analysis: EMERGENT_LLM_KEY missing")
        return None
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=key, session_id="scam-analysis", system_message=SYSTEM).with_model(*MODEL)
    try:
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception as exc:  # noqa: BLE001 — provider/transport errors leave the item unanalysed for retry
        logger.warning("scam_analysis: model call failed (%s)", type(exc).__name__)
        return None
    return _parse_json(reply if isinstance(reply, str) else str(reply))


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
