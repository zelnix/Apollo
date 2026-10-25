"""Deterministic scam-report analysis — no AI.

Reads one official advisory (its headline, summary and, where reachable, the full article from its own
source URL) and applies fixed, reviewable rules to the source's own words:
  1. audience and tier (consumer scam warning, emerging pattern or general education);
  2. urgency from words the source itself uses ("urgent", "active", "warning", ...) or the source's own
     severity — the reason always quotes the sentence that triggered it;
  3. Australian relevance from the source's region or an explicit mention of Australia;
  4. Higgins' sections: every sentence is copied verbatim from the source. A section the source doesn't
     support stays empty, so the app says the source doesn't cover it rather than filling the gap.
Nothing is invented, summarised or rewritten, and no model is called. Each item is analysed once and the
result is cached on the feed item.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from html.parser import HTMLParser

from core.db import db, now_utc
from services.outbound import OutboundBlocked, public_get

logger = logging.getLogger("apollo")

ANALYSIS_VERSION = 6  # 6 = deterministic rules on the source's own words (no Gemini)
_MAX_ARTICLE_CHARS = 14000

TIERS = {"specific_scam", "emerging_pattern", "general_education"}
SEVERITIES = {"LOW", "MODERATE", "HIGH", "EXTREME"}
RELEVANCES = {"confirmed", "potential", "overseas_only", "unknown"}
AUDIENCES = {"consumer", "organisation"}

# ── Fixed vocabularies (small and legible on purpose) ─────────────────────────
_CONSUMER = re.compile(r"\b(scams?|scammers?|fraud|fraudsters?|phishing|smishing|vishing|impersonat\w*|fake|text messages?|sms|romance|investment|cryptocurrency|crypto|refund|parcel|deliver(?:y|ies)|toll|myGov|identity theft|gift cards?|remote access|tech support|sextortion|job (?:offers?|scams?)|online shopping|data breach(?:es)?|hacked|account takeover)\b", re.I)
_ORGANISATION = re.compile(r"\b(vulnerabilit(?:y|ies)|CVE-\d{4}-\d+|patch(?:es|ing)?|exploit(?:ed|ation)?|APT\d*|state[- ]sponsored|network defenders|critical infrastructure|zero[- ]day|indicators of compromise|IOCs?|TTPs|firmware|enterprise|operational technology|threat actors? targeting (?:organisations|networks|businesses))\b", re.I)
_TREND = re.compile(r"\b(on the rise|rise in|rising|increase in|increasing|surge|trends?|trending|growing|spike)\b", re.I)
_EDUCATION = re.compile(r"\b(tips?|how to|guide|guidance|learn|awareness week|basics|explained|what is|steps to|protect yourself|annual report|statistics|data shows?)\b", re.I)
_ALERT = re.compile(r"\b(warn(?:s|ing|ings)?|alert|beware|be on the lookout)\b", re.I)
_ACTIVE = re.compile(r"\b(active(?:ly)?|ongoing|currently|right now|circulating|targeting|being sent|being used)\b", re.I)
_URGENT = re.compile(r"\b(urgent(?:ly)?|immediately|critical|serious harm|significant losses)\b", re.I)
_AUSTRALIA = re.compile(r"\b(Australia|Australians?|New South Wales|NSW|Victoria|Queensland|Tasmania|South Australia|Western Australia|Northern Territory|myGov|Medicare|Centrelink|Scamwatch)\b")
_PLACES = re.compile(r"\b(Australia|New South Wales|NSW|Victoria|Queensland|Tasmania|South Australia|Western Australia|Northern Territory|Canberra|Sydney|Melbourne|Brisbane|Perth|Adelaide|Hobart|Darwin|United States|USA|United Kingdom|England|Scotland|Wales|Europe|European Union|New Zealand|Canada)\b")
_WATCH = re.compile(r"\b(be wary|beware|watch (?:out )?for|look out|be suspicious|signs? of|red flags?|may (?:claim|say|ask|pretend|appear)|pretend(?:s|ing)? to be|pos(?:e|es|ing) as|impersonat\w+|claim(?:s|ing)? to be|asks? you to|will ask|might ask|unexpected|out of the blue|too good to be true)\b", re.I)
_DO = re.compile(r"^(?:do not|don't|never|always|report|contact|call|visit|check|block|delete|change|stop|hang up|go to|if you(?:'ve| have| think| are)|protect|keep|use|turn on|enable|update|ignore|verify)\b|\b(you should|we recommend|we encourage|we urge|make sure)\b", re.I)


def _words(body: str) -> re.Pattern:
    """Whole words or phrases. Acronyms are matched as capitals only; anything inside (?i:…) in any case."""
    return re.compile(rf"(?<!\w)(?:{body})(?!\w)")


# ── Where an alert applies (no AI) ────────────────────────────────────────────
# An alert applies everywhere unless its headline or summary names something only its source's country has: a
# national agency, benefit, payment service, election, state or its people ("FTC" makes an FTC alert US-only).
_US_STATES = ("alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|"
              "kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|"
              "new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|"
              "south carolina|south dakota|tennessee|texas|utah|vermont|virginia|wisconsin|wyoming")
_LOCAL_TO = {
    "US": _words(r"FTC|IRS|SSA|SSN|FBI|USPS|USCIS|SNAP|FAFSA|DMV|U\.S\.|US|(?i:united states|americans?|federal trade commission|"
                 r"internal revenue service|social security|medicare|medicaid|postal service|justice department|department of justice|"
                 r"federal (?:jury|grand jury|court|prosecutors?|agents?|agency|charges)|grand jury|affordable care act|open enrollment|"
                 rf"student loans?|stimulus|zelle|venmo|cash app|e-?zpass|midterms?|green card|{_US_STATES})"),
    "UK": _words(r"HMRC|NHS|DVLA|DWP|(?i:hm revenue|national insurance|council tax|universal credit|tv licen[cs](?:e|ing)|royal mail|"
                 r"action fraud|gov\.uk|ofcom|ofgem|britons|british (?:people|public|residents|citizens|households|consumers)|in the uk|"
                 r"uk (?:residents|citizens|consumers|households|people|public|businesses|taxpayers)|england|scotland|wales|northern ireland)"),
    "AU": _words(r"ATO|NSW|(?i:australia|australians?|mygov|centrelink|medicare|services australia|australia post|linkt|superannuation|"
                 r"national anti-scam centre|new south wales|victoria|queensland|tasmania|south australia|western australia|northern territory)"),
    "NZ": _words(r"IRD|NZTA|(?i:new zealand(?:ers?)?|kiwis|inland revenue|nz post|waka kotahi|myir|realme)"),
    "CA": _words(r"CRA|SIN|(?i:canada|canadians?|canada revenue agency|service canada|canada post|interac)"),
    "EU": _words(r"(?i:eu (?:citizens|residents|consumers|member states)|in the eu|european (?:citizens|consumers)|sepa)"),
}
# Naming another country as well means the alert spans countries, so it isn't local to one.
_COUNTRY = {
    "AU": _words(r"(?i:australia|australians?)"), "US": _words(r"U\.S\.|(?i:united states|americans?)"),
    "UK": _words(r"(?i:united kingdom|britain|britons)"), "NZ": _words(r"(?i:new zealand)"),
    "CA": _words(r"(?i:canada|canadians?)"), "EU": _words(r"(?i:europe|european union)"),
}


def applies_in(title: str, summary: str, region: str) -> tuple[str, str]:
    """("everywhere", "") or (the source's country, the words that make it local to it)."""
    head = f"{title}. {summary}"
    local = _LOCAL_TO.get(region)
    found = local.search(head) if local else None
    if not found or any(pattern.search(head) for other, pattern in _COUNTRY.items() if other != region):
        return "everywhere", ""
    return region, found.group(0)


_SOURCE_SEVERITY = {"critical": "EXTREME", "extreme": "EXTREME", "high": "HIGH", "medium": "MODERATE", "moderate": "MODERATE", "low": "LOW"}
_MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
_DAY_DATE = re.compile(r"\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)\b")
_MONTH_DATE = re.compile(r"\b(January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)\b")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'‘“(])")


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


def _sentences(text: str) -> list[str]:
    """The source's sentences, verbatim (whitespace normalised). Fragments and menu runs are skipped."""
    return [part.strip() for part in _SENTENCE_END.split(re.sub(r"\s+", " ", text or "")) if 25 <= len(part.strip()) <= 400]


def _first(pattern: re.Pattern, sentences: list[str]) -> str:
    return next((sentence for sentence in sentences if pattern.search(sentence)), "")


def _matching(pattern: re.Pattern, sentences: list[str], limit: int, exclude: set[str]) -> list[str]:
    picked: list[str] = []
    for sentence in sentences:
        if sentence not in exclude and sentence not in picked and pattern.search(sentence):
            picked.append(sentence)
            if len(picked) == limit:
                break
    return picked


def _reported_date(published, text: str) -> str:
    if isinstance(published, datetime):
        return published.astimezone(timezone.utc).strftime("%Y-%m-%d") if published.tzinfo else published.strftime("%Y-%m-%d")
    day = _DAY_DATE.search(text)
    if day:
        return f"{day.group(3)}-{_MONTHS[day.group(2).lower()]:02d}-{int(day.group(1)):02d}"
    month = _MONTH_DATE.search(text)
    return f"{month.group(2)}-{_MONTHS[month.group(1).lower()]:02d}" if month else ""


def _classify(head: str, content_type: str | None) -> tuple[str, str]:
    consumer = len(_CONSUMER.findall(head))
    organisation = len(_ORGANISATION.findall(head))
    audience = "organisation" if organisation and organisation >= consumer else "consumer"
    if audience != "consumer" or not consumer:
        return audience, "general_education"
    if _TREND.search(head):
        return audience, "emerging_pattern"
    if not _ALERT.search(head) and (_EDUCATION.search(head) or content_type == "official_advice"):
        return audience, "general_education"
    return audience, "specific_scam"


_LABEL = {"EXTREME": "Extreme", "HIGH": "High", "MODERATE": "Moderate", "LOW": "Low"}


def _severity(tier: str, sentences: list[str], source_severity: str | None) -> tuple[str, str]:
    """Fixed rules on the source's own words; the reason quotes the sentence that triggered the rating."""
    if tier == "general_education":
        return "LOW", "This is general guidance from the source, not a warning about a current scam."
    mapped = _SOURCE_SEVERITY.get(str(source_severity or "").strip().lower())
    if mapped:
        return mapped, f'The source itself rates this "{source_severity}".'
    urgent, active, alert = _first(_URGENT, sentences), _first(_ACTIVE, sentences), _first(_ALERT, sentences)
    if tier == "specific_scam" and urgent and active:
        quoted = f'"{urgent}"' + (f' and "{active}"' if active != urgent else "")
        return "EXTREME", f"Rated Extreme because the source says {quoted}"
    if tier == "specific_scam" and (active or alert):
        return "HIGH", f'Rated High because the source says "{active or alert}"'
    return "MODERATE", "Rated Moderate: the source describes a scam but doesn't say it is active or urgent."


def analyse(item: dict, article: str = "") -> dict:
    """Deterministic analysis of one feed item. Every section sentence is a verbatim quote from the source."""
    title, summary = str(item.get("title") or "").strip(), str(item.get("summary") or "").strip()
    head = f"{title}. {summary}"
    sentences = _sentences(f"{head} {article}")
    source_name = item.get("_source_name") or item.get("source_id") or "the source"
    region = item.get("_source_region") or ""
    audience, tier = _classify(head, item.get("content_type"))
    severity, severity_reason = _severity(tier, sentences, item.get("source_severity"))
    australia = _first(_AUSTRALIA, sentences)
    if region == "AU":
        relevance, relevance_reason = "confirmed", f"Published by {source_name}, an Australian authority."
    elif australia:
        relevance, relevance_reason = "confirmed", f'The source says "{australia}"'
    elif tier != "general_education":
        relevance, relevance_reason = "potential", f"Reported overseas by {source_name}; it doesn't mention Australia."
    else:
        relevance, relevance_reason = "unknown", ""
    what_happened = summary or " ".join(sentences[:2])
    used = {what_happened}
    where = _matching(_PLACES, sentences, 2, used)
    watch = _matching(_WATCH, sentences, 4, used | set(where))
    todo = _matching(_DO, sentences, 4, used | set(where) | set(watch))
    if tier == "general_education":
        means = ""
    elif relevance == "confirmed":
        means = f"{source_name} has reported this for people in Australia."
    else:
        means = f"{source_name} reported this overseas. It doesn't say whether it has reached Australia."
    reported = _reported_date(item.get("published_at"), f"{head} {article}")
    return {
        "tier": tier, "audience": audience, "severity": severity, "severityReason": severity_reason,
        "confidence": "high" if article else ("medium" if summary else "low"),
        "australianRelevance": relevance, "australianRelevanceReason": relevance_reason, "reportedDate": reported,
        "facts": {"who": "", "what": what_happened[:600], "how": "", "where": " ".join(where)[:600], "when": reported,
                  "whatCriminalsWant": "", "evidence": ""},
        "sections": {"whatHappened": what_happened[:900], "whereHappening": " ".join(where)[:900], "whatItMeansForYou": means,
                     "whatToWatch": "\n".join(watch)[:900], "whatToDo": "\n".join(todo)[:900]},
        "method": "deterministic_source_rules", "analysisVersion": ANALYSIS_VERSION, "analyzedAt": now_utc(),
    }


async def analyze_item(item: dict) -> dict:
    """Fetch the article (when its source lets Apollo read it) and analyse it deterministically."""
    # Items from a relayed feed come from a source that blocks Apollo's servers; trying its article page
    # would only burn ~30 s of timeouts per item, so analysis uses the headline and summary.
    article = "" if item.get("_article_unreachable") else await _fetch_article_text(item.get("url") or "")
    return analyse(item, article)


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
    "method": "deterministic_source_rules", "analysisVersion": ANALYSIS_VERSION,
}


async def analyze_pending(limit: int = 60) -> int:
    """Analyse up to `limit` feed items that have no current analysis, caching the result on each item.
    Safe to call repeatedly; it only touches items missing ANALYSIS_VERSION."""
    query = {"$or": [{"scam_analysis": {"$exists": False}}, {"scam_analysis.analysisVersion": {"$ne": ANALYSIS_VERSION}}]}
    rows = await db.learning_feed_items.find(query).sort("published_at", -1).limit(max(1, limit) * 4).to_list(max(1, limit) * 4)
    if not rows:
        return 0
    from services import scam_intel
    source_ids = list({r["source_id"] for r in rows})
    sources = {s["source_id"]: s for s in await db.learning_sources.find({"source_id": {"$in": source_ids}}, {"_id": 0}).to_list(100)}
    relayed = {f["feed_id"] for f in await db.learning_feeds.find({"relay": {"$ne": None}}, {"_id": 0, "feed_id": 1}).to_list(100)}
    done = 0
    for row in rows:
        if _obviously_not_an_alert(row):
            await db.learning_feed_items.update_one({"fingerprint": row["fingerprint"]}, {"$set": {"scam_analysis": {**_SKIPPED_ANALYSIS, "analyzedAt": now_utc()}}})
            continue  # navigation link: classified without fetching anything
        src = sources.get(row["source_id"], {})
        row["_source_name"] = src.get("name") or row["source_id"]
        row["_source_region"] = scam_intel.region_for(row["source_id"])
        row["_article_unreachable"] = row.get("feed_id") in relayed
        analysis = await analyze_item(row)
        await db.learning_feed_items.update_one({"fingerprint": row["fingerprint"]}, {"$set": {"scam_analysis": analysis}})
        done += 1
        if done >= limit:
            break
    return done
