"""What a push notification actually says.

Two jobs, both at the notification boundary only:
1. A purpose-built short summary of a Patrol event ("Higgins: The Instagram link you sent has signs that need
   checking. Open ApolloSG to see what I found.") — never the full Higgins explanation, which stays in the
   Threat Case untouched.
2. present_push(): decode HTML entities (&quot; &amp; &#39; &lt; …) exactly once, tidy whitespace and fit the
   OS limits, just before the text is handed to the relay (Android/iOS). Stored investigations and evidence
   are never altered.

Mirror of frontend src/push/notificationText.ts.
"""
from __future__ import annotations

import html
import re
from typing import Any

TITLE_MAX, MESSAGE_MAX, SUBTEXT_MAX = 65, 178, 110
_MAX_NAME = 42


def decode_entities(text: str) -> str:
    """One pass: "&amp;quot;" becomes "&quot;", never '"'."""
    return html.unescape(text)


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit * 0.6 else cut).rstrip(" ,.;:—–-") + "…"


def _present(text: Any, limit: int) -> Any:
    if not isinstance(text, str):
        return text
    return _clip(re.sub(r"\s+", " ", decode_entities(text)).strip(), limit)


def present_push(data: dict) -> dict:
    """The push presentation boundary — applied once, in send_push, to every notification."""
    out = dict(data)
    for key, limit in (("title", TITLE_MAX), ("message", MESSAGE_MAX), ("subtext", SUBTEXT_MAX)):
        if key in out:
            out[key] = _present(out[key], limit)
    return out


# ── The short summary ────────────────────────────────────────────────────────

_NOUN = {"link": "link", "website": "website", "connection": "website", "known_threat": "website", "message": "text",
         "email": "email", "call": "call", "app": "app", "file": "file", "account": "account alert"}
_SENT_TO_CHECK = {"link", "message", "email", "file"}
_RECEIVED = {"message", "email"}
_SITES = {"website", "connection", "known_threat"}
_OPEN = "Open ApolloSG to see what I found."


def _named(value: Any) -> str:
    v = (value or "").strip() if isinstance(value, str) else ""
    return v[: _MAX_NAME - 1] + "…" if len(v) > _MAX_NAME else v


def _host(value: Any) -> str:
    raw = _named(value)
    host = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", raw).split("/")[0].split("?")[0].split("#")[0]
    host = re.sub(r"^www\.", "", host, flags=re.I)
    return host.lower() if re.fullmatch(r"[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", host) else ""


def notification_subject(event: Any) -> str:
    category = event.category
    noun = _NOUN.get(category, "item")
    brand = _named(event.claimed_brand)
    if event.background:
        yours = " you received" if category in _RECEIVED else ""
    else:
        yours = " you sent" if category in _SENT_TO_CHECK else ""
    if category == "call":
        return f"The {brand} call" if brand else "The call"
    if brand:
        return f"The {brand} {noun}{yours}"
    host = _host(event.indicator_host)
    if host and category == "link":
        return f"The {host} link{yours}"
    if host and category in _SITES:
        return f"The website {host}"
    return f"The {noun}{yours}"


def owner_alert_summary(event: Any) -> str:
    subject = notification_subject(event)
    in_sentence = re.sub(r"^The ", "the ", subject)
    open_lower = _OPEN[0].lower() + _OPEN[1:]
    if event.state == "biting":
        return f"Higgins: Apollo blocked {in_sentence}. {_OPEN}"
    if event.state == "barking":
        return f"Higgins: {subject} looks like a scam. Don't act on it — {open_lower}"
    if event.state == "growling":
        return f"Higgins: {subject} has signs that need checking. {_OPEN}"
    if ((event.triage_investigation or {}).get("outcome")) == "LIMITED_UNABLE_TO_DETERMINE":
        return f"Higgins: I couldn't fully check {in_sentence}. Treat it with caution — {open_lower}"
    return f"Higgins: {subject} needs a closer look. {_OPEN}"
