"""Deterministic, auditable scam-advisory intelligence: region, severity, Australian relevance and a
structured Higgins explanation. Pure functions only — no AI, no network, no DB — so every High/Extreme
rating is explainable and testable. Apollo never independently invents evidence; it classifies the words
an official source actually published.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

# Region each recognised source reports from. The *source's* country is not necessarily where the scam
# originated — relevance is judged separately from the reporting authority's location.
SOURCE_REGION = {
    "scamwatch": "AU", "acsc": "AU", "esafety": "AU", "moneysmart": "AU",
    "ftc": "US", "ic3": "US",
    "europol": "EU", "enisa": "EU",
    "ncsc_uk": "UK",
}
REGION_LABEL = {"AU": "Australia", "US": "United States", "UK": "United Kingdom", "EU": "European Union", "GLOBAL": "Global"}

Severity = str  # "LOW" | "MODERATE" | "HIGH" | "EXTREME"
Relevance = str  # "confirmed" | "potential" | "overseas_only" | "unknown"

# Explicit, reviewable signal vocabularies. Kept small and legible on purpose.
_HARM = re.compile(r"\b(bank|money|transfer|wire|payment|invoice|ransom|identity theft|account takeover|credential|password|investment|crypto|remote access|gift card|superannuation|life ?savings)", re.I)
_URGENT = re.compile(r"\b(urgent|critical|emergency|immediately|actively exploit|active exploitation|widespread|rapidly|surge|spik|mass |zero[- ]day|escalat)", re.I)
_SCAM = re.compile(r"\b(scam|fraud|phish|smish|vish|impersonat|spoof|malicious|malware|deceptive|fake)", re.I)
_ADVICE_ONLY = re.compile(r"\b(tips?|how to|guide|advice|awareness|stay safe|protect yourself|learn)", re.I)
_AU = re.compile(r"\b(australia|australian|aussie|accc|scamwatch|acsc|centrelink|mygov|ato|au)\b", re.I)


def region_for(source_id: str) -> str:
    return SOURCE_REGION.get((source_id or "").lower(), "GLOBAL")


def _text(item: dict) -> str:
    return f"{item.get('title', '')} {item.get('summary', '')}"


def classify_severity(item: dict) -> tuple[Severity, str, str]:
    """Return (severity, explanation, confidence). Official 'advice' content is awareness, never urgent."""
    text = _text(item)
    harm = bool(_HARM.search(text)); urgent = bool(_URGENT.search(text)); scammy = bool(_SCAM.search(text))
    advice = bool(_ADVICE_ONLY.search(text))
    if item.get("content_type") == "official_advice" or (advice and not (harm and urgent)):
        return "LOW", "Official awareness or guidance, not a report of active scam activity.", "high"
    if harm and urgent and scammy:
        return "EXTREME", "An active scam with both serious-harm and urgency/scale signals in the official wording.", "high"
    if harm and scammy:
        return "HIGH", "An active scam with potential for substantial loss (money, identity or account compromise).", "high"
    if scammy and urgent:
        return "HIGH", "An active, urgent scam warning, though the specific harm is less explicit.", "medium"
    if scammy:
        return "MODERATE", "A credible scam warning without strong evidence of severe or urgent harm.", "medium"
    return "LOW", "General security information; no specific active-scam evidence found in the wording.", "low"


def australian_relevance(region: str, severity: Severity, item: dict) -> tuple[Relevance, str]:
    text = _text(item)
    if region == "AU" or _AU.search(text):
        return "confirmed", "An Australian authority reported this, or the advisory explicitly references Australia."
    if severity in ("HIGH", "EXTREME"):
        return "potential", "Not confirmed in Australia from this advisory, but the same technique could be used here."
    if severity == "MODERATE":
        return "unknown", "There isn't enough evidence to judge how relevant this is to Australian users."
    return "overseas_only", "Current evidence points to overseas activity without demonstrated Australian relevance."


def is_growling(severity: Severity, relevance: Relevance) -> bool:
    """High/Extreme may growl only when there's a real Australian exposure pathway (confirmed or potential)."""
    return severity in ("HIGH", "EXTREME") and relevance in ("confirmed", "potential")


def _aware(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return None


def is_fresh_advisory(item: dict, *, now: datetime, max_age_days: int = 21) -> bool:
    """A growling advisory must be recent; a stale overseas bulletin must not keep Apollo growling."""
    published = _aware(item.get("published_at") or item.get("publishedAt"))
    return bool(published and (now - published) <= timedelta(days=max_age_days))


def higgins_explanation(item: dict, *, severity: Severity, region: str, relevance: Relevance,
                        source_name: str, source_region: str) -> dict:
    """Plain Australian-English structure Higgins uses — built only from the advisory's own facts."""
    published = _aware(item.get("published_at") or item.get("publishedAt"))
    date_label = published.strftime("%-d %B %Y") if published else "an unspecified date"
    au = {
        "confirmed": "Australian activity has been reported or the advisory names Australia.",
        "potential": "This has not been confirmed in Australia from the information available, but the same technique could be used here.",
        "overseas_only": "Current evidence describes overseas activity; Australian relevance is not established.",
        "unknown": "There isn't enough evidence yet to say how much this affects Australia.",
    }[relevance]
    return {
        "whatHappened": (item.get("summary") or item.get("title") or "An official scam warning was published.")[:500],
        "whyGrowling": f"Apollo rates this {severity} because " + classify_severity(item)[1].lower(),
        "whereHappening": f"Reported by {source_name} ({REGION_LABEL.get(source_region, source_region)}). The reporting authority's location is not necessarily where the scam began.",
        "whatItMeansForAustralia": au,
        "whatToWatch": "Unexpected pressure to act fast, requests to move money or share codes, and messages or calls that impersonate a trusted organisation.",
        "whatToDo": "Don't act on the message. Contact the organisation yourself using a number or app you already trust. This is an early scam warning — Apollo has not detected this scam on your device.",
        "source": source_name,
        "publishedAt": published.isoformat() if published else None,
        "dateLabel": date_label,
        "url": item.get("url"),
    }


def enrich(item: dict, source_id: str, source_name: str) -> dict:
    """Attach region/severity/relevance/Higgins explanation to one snapshot item (non-destructive)."""
    region = region_for(source_id)
    severity, severity_reason, confidence = classify_severity(item)
    relevance, relevance_reason = australian_relevance(region, severity, item)
    return {
        "region": region, "regionLabel": REGION_LABEL.get(region, region),
        "severity": severity, "severityReason": severity_reason, "severityConfidence": confidence,
        "sourceSeverity": item.get("source_severity"),  # preserved separately if an official source ever supplies it
        "australianRelevance": relevance, "australianRelevanceReason": relevance_reason,
        "growling": is_growling(severity, relevance),
        "higgins": higgins_explanation(item, severity=severity, region=region, relevance=relevance,
                                       source_name=source_name, source_region=region),
    }
