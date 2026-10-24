"""Deterministic Higgins presentation — Higgins may change presentation, never meaning.

Every answer here is assembled from structured fields that Magnum DI, Patrol, the device or Apollo's
product knowledge already established, using fixed mappings and templates. No AI is called. When the
record doesn't hold the answer, Higgins says so instead of inferring one.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from services.higgins import app_knowledge
from services.higgins.knowledge import terms

ASSESSMENT_TEXT = {
    "concern_found": "Magnum DI found a concern.",
    "no_concern_found_within_scope": "Magnum DI found no concern within what it was able to check.",
    "uncertain": "Magnum DI couldn't reach a firm conclusion.",
}
ATTENTION_TEXT = {"none": "No action is needed.", "review": "It's worth reviewing.", "action_needed": "Action is needed.", "urgent": "This is urgent."}
BASIS_TEXT = {"observation": "observed in the evidence", "user_report": "from what you told Magnum DI", "inference": "Magnum DI's inference from the evidence"}
STATE_TEXT = {"resting": "all clear", "sniffing": "Apollo is looking closer", "ears_up": "worth a look", "growling": "possible concern",
              "barking": "significant concern", "biting": "Apollo blocked it", "unknown": "state not known"}
SEVERITY_TEXT = {"EXTREME": "Extreme", "HIGH": "High", "MODERATE": "Moderate", "LOW": "Low"}

OUT_OF_SCOPE = ("I specialise in helping you stay safe from scams and cyber threats through Apollo. For that question, a general "
                "assistant would be a better fit. Is there anything security-related I can help with?")

_FOLLOW_UP_INTENTS: list[tuple[str, re.Pattern]] = [(name, re.compile(pattern, re.I)) for name, pattern in [
    ("not_established", r"\b(?:wasn'?t|not|never|couldn'?t|didn'?t)\s+(?:established|found|checked|confirmed|able|cover(?:ed)?|look(?:ed)?)\b|\bunknown\b|\buncertain"
                        r"|\blimitations?\b|\bmissing\b|\bgaps?\b|\bscope\b|what (?:don'?t|didn'?t) (?:you|we|it) know"),
    ("sources", r"\bsources?\b|where did (?:this|that|the|you|it)\b.*\b(?:come from|get)|\breferences?\b|\bcitations?\b|\blinks?\b"),
    ("evidence", r"\bevidence\b|\bproof\b|\bsupport(?:s|ed|ing)?\b|\bbased on\b|how do (?:you|we) know|what shows"),
    ("confidence", r"\bconfiden|\bsure\b|\bcertain(?:ty)?\b|how likely|how accurate|\breliable\b"),
    ("watch", r"watch (?:out )?for|look out|warning signs|red flags|\bsigns\b|be careful of|what to look"),
    ("why", r"\bwhy\b|\bsuspicious\b|what makes|what'?s wrong"),
    ("meaning", r"mean(?:s)? for me|what does (?:this|it|that) mean|\bworr|am i (?:safe|at risk|ok)|is (?:this|it|that) (?:safe|a scam|dangerous|legit|real|ok)"),
    ("actions", r"what (?:should|can|do) i do|next steps?|what now|what next|how do i (?:fix|stop|protect)|\brecommend|\bshould i\b|\bactions?\b"),
    ("findings", r"what did (?:you|magnum(?: di)?|it|apollo) find|\bfindings?\b|what was found|\bsummar|\boverview\b|tell me (?:more|about)|\bexplain\b|what happened"),
]]
_WATCH_WORDS = re.compile(r"\b(watch|look out|be wary|be careful|beware|signs?|suspicious|unexpected)\b", re.I)


def _bullets(lines: list[str]) -> str:
    return "\n".join(f"• {line}" for line in lines if line)


def follow_up_intent(question: str) -> Optional[str]:
    return next((name for name, pattern in _FOLLOW_UP_INTENTS if pattern.search(question or "")), None)


def investigation_follow_up(response: dict[str, Any], sources: list[dict[str, Any]], question: str) -> dict[str, Any]:
    """Answer a follow-up from a completed Magnum DI result (camelCase wire shape). Never infers."""
    overview = str(response.get("overview") or "").strip()
    assessment = ASSESSMENT_TEXT.get(str(response.get("assessment") or ""), "")
    attention = ATTENTION_TEXT.get(str(response.get("attention") or ""), "")
    reason = str(response.get("attentionReason") or "").strip()
    findings = [f for f in response.get("findings") or [] if str(f.get("text") or "").strip()]
    actions = [a for a in response.get("actions") or [] if str(a.get("instruction") or a.get("label") or "").strip()]
    recommended = response.get("recommendedActionId")
    actions.sort(key=lambda a: a.get("id") != recommended)
    uncertainties = [str(u).strip() for u in response.get("uncertainties") or [] if str(u).strip()]
    scope = str(response.get("scope") or "").strip()
    by_source = {s.get("id"): s for s in sources}
    intent = follow_up_intent(question)
    limitation = False

    def finding_line(f: dict, *, detail: bool = False) -> str:
        line = f"{f['text']} ({BASIS_TEXT.get(f.get('basis'), 'basis not recorded')}; {f.get('confidence', 'unknown')} confidence"
        if detail:
            count = len(f.get("evidenceIds") or [])
            titles = [by_source[i].get("title") for i in f.get("sourceIds") or [] if by_source.get(i, {}).get("title")]
            line += f"; {count} evidence item{'s' if count != 1 else ''}" if count else "; no evidence item cited"
            line += f"; source: {', '.join(titles)}" if titles else ""
        return line + ")"

    if intent == "meaning":
        answer = "\n\n".join(part for part in [overview, " ".join(p for p in [assessment, attention, reason] if p)] if part)
    elif intent == "why":
        answer = "\n\n".join(part for part in [reason or assessment, "What Magnum DI found:\n" + _bullets([finding_line(f) for f in findings]) if findings else ""] if part)
        if not findings and not reason:
            answer, limitation = "Magnum DI's investigation doesn't record specific reasons beyond its overall result. " + overview, True
    elif intent == "evidence":
        answer = ("Each finding and what supports it:\n" + _bullets([finding_line(f, detail=True) for f in findings])) if findings else \
            "Magnum DI didn't record individual findings with supporting evidence for this investigation."
        limitation = not findings
    elif intent == "confidence":
        counts = {level: sum(1 for f in findings if f.get("confidence") == level) for level in ("high", "medium", "low")}
        parts = [f"Overall: {assessment}" if assessment else "",
                 "Confidence in the findings: " + ", ".join(f"{n} {level}" for level, n in counts.items() if n) if findings else "",
                 "What it couldn't establish:\n" + _bullets(uncertainties) if uncertainties else ""]
        answer = "\n\n".join(p for p in parts if p) or "Magnum DI didn't record a confidence level for this investigation."
    elif intent == "watch":
        watch = [a.get("instruction") or a.get("label") for a in actions if _WATCH_WORDS.search(f"{a.get('label', '')} {a.get('instruction', '')}")]
        if watch:
            answer = "What Magnum DI says to look out for:\n" + _bullets(watch)
        else:
            answer, limitation = "Magnum DI's investigation doesn't list specific warning signs to watch for.", True
            if actions:
                answer += " What it does recommend:\n" + _bullets([f"{a.get('label')}: {a.get('instruction')}" for a in actions])
    elif intent == "actions":
        answer = ("What Magnum DI recommends:\n" + _bullets([f"{a.get('label')}: {a.get('instruction')}" if a.get("label") else a.get("instruction") for a in actions])) \
            if actions else f"Magnum DI didn't recommend any action for this. {attention}".strip()
    elif intent == "not_established":
        answer = "\n\n".join(p for p in ["What Magnum DI couldn't establish:\n" + _bullets(uncertainties) if uncertainties else
                                          "Magnum DI didn't record anything it was unable to establish.",
                                          f"What it checked: {scope}" if scope else ""] if p)
    elif intent == "sources":
        listed = [f"{s.get('title') or s.get('url')} — {s.get('url')} ({s.get('authority', 'unknown')} source)" for s in sources if s.get("url")]
        answer = ("The sources Magnum DI used:\n" + _bullets(listed)) if listed else \
            "Magnum DI didn't use any outside sources for this; its findings come from the evidence you submitted."
    elif intent == "findings":
        answer = "\n\n".join(p for p in [overview, "Findings:\n" + _bullets([finding_line(f) for f in findings]) if findings else ""] if p)
    else:
        limitation = True
        answer = ("I can only answer from what Magnum DI's investigation established, and it doesn't answer that directly."
                  + (f" Here's what it did establish: {overview}" if overview else "")
                  + " If you have new information or something else to check, add it and Magnum DI will investigate it.")
    return {"answer": answer.strip(), "intent": intent or "unanswered", "limitation": limitation}


# ── Device / Apollo state ─────────────────────────────────────────────────────

_DEVICE_INTENTS: list[tuple[str, re.Pattern]] = [(name, re.compile(pattern, re.I)) for name, pattern in [
    ("permissions", r"\bpermission"),
    ("device_protections", r"\b(?:built[- ]in|device|phone|android|ios|iphone|samsung|google|apple)(?:'s)?\s+(?:own\s+)?(?:protection|security)|play protect|what does my (?:phone|device) protect"),
    ("capabilities", r"\bcapabilit|what can apollo (?:see|use|access|read)|allowed to (?:use|read|see)"),
    ("settings", r"settings? (?:should|to) (?:i )?(?:turn on|check|change)|recommended settings|what should i turn on"),
    ("threats", r"\bthreats?\b|\bissues?\b|\bproblems?\b|\bwarnings?\b|what'?s wrong|needs? attention|(?:barking|growling)"),
    ("network", r"\bwi-?fi\b|\bnetwork\b|\binternet\b|\bconnection\b|\bvpn\b"),
    ("calls", r"call screen|caller id|screen(?:ing)? (?:my )?calls"),
    ("email", r"email accounts?|\bgmail\b|\bmailbox"),
    ("alerts", r"\bnotifications?\b|quiet hours|\balerts? (?:on|off|working)"),
    ("protection", r"\bprotect(?:ed|ion|ions|ing)?\b|\bsafe\b|\bsecure\b|\bstatus\b|\brunning\b|\bgates?\b"),
]]


def device_intent(question: str) -> Optional[str]:
    return next((name for name, pattern in _DEVICE_INTENTS if pattern.search(question or "")), None)


def device_state(snapshot: Any, question: str, intent: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Answer from the phone's live, authoritative reading. None when the question isn't about device state."""
    intent = intent or device_intent(question)
    if not intent:
        return None
    if snapshot is None:
        return {"answer": "I don't have a live reading from this phone in this conversation, so I can't tell you its current state. "
                          "Open Your protections to see it.", "navigate": ["/(tabs)/guard"], "limitation": True}
    s = snapshot
    when = f" (read {s.checked_at})" if s.checked_at else ""
    missing = "Apollo doesn't have a reading for that on this phone."
    lines: list[str] = []
    navigate: list[str] = []
    if intent == "permissions":
        lines = ["Permissions on this phone:\n" + _bullets(s.permissions)] if s.permissions else [missing]
    elif intent == "device_protections":
        lines = ["Protection built into this device (provided by the device maker or operating system, not by Apollo):\n" + _bullets(s.device_protections)] \
            if s.device_protections else [missing]
        navigate = ["/device-protection"]
    elif intent == "capabilities":
        lines = [p for p in [s.capability_summary or "", "What Apollo is allowed to use:\n" + _bullets(s.capabilities) if s.capabilities else ""] if p] or [missing]
        navigate = ["/device-protection"]
    elif intent == "settings":
        lines = ["Apollo can't read these settings, so please check them yourself:\n" + _bullets(s.recommended_settings)] if s.recommended_settings else [missing]
        navigate = ["/device-protection"]
    elif intent == "threats":
        lines = [p for p in ["Threats recorded: " + "; ".join(s.threat_counts) if s.threat_counts else "",
                             "Open right now:\n" + _bullets(s.open_threats) if s.open_threats else "No threats are open on this phone right now."] if p]
        navigate = ["/(tabs)/patrol"]
    elif intent == "network":
        lines = [f"Internet connection: {s.network}"] if s.network else [missing]
        navigate = ["/network"]
    elif intent == "calls":
        lines = [f"Call screening: {s.call_screener}"] if s.call_screener else [missing]
        navigate = ["/call-guard"]
    elif intent == "email":
        lines = [f"Email accounts: {s.email_accounts}"] if s.email_accounts else [missing]
        navigate = ["/settings/email-accounts"]
    elif intent == "alerts":
        lines = [p for p in [f"Security alerts: {s.alerts}" if s.alerts else "", f"Quiet hours: {s.quiet_hours}" if s.quiet_hours else ""] if p] or [missing]
        navigate = ["/notification-check"]
    else:  # protection
        switched = "" if s.protection_on is None else ("Apollo protection is switched on." if s.protection_on else "Apollo protection is switched off.")
        gates = [f"{g.title}: {g.status}" + ("" if g.automatic else " (manual checks only)") for g in s.gates]
        lines = [p for p in [switched, "Your protections:\n" + _bullets(gates) if gates else "",
                             "Open right now:\n" + _bullets(s.open_threats) if s.open_threats else "",
                             "Apollo can't read these settings, so please check them yourself:\n" + _bullets(s.recommended_settings) if s.recommended_settings else "",
                             *s.notes] if p] or [missing]
        navigate = ["/(tabs)/guard"]
    return {"answer": f"Here's what Apollo reads on this phone right now{when}:\n\n" + "\n\n".join(lines), "navigate": navigate,
            "limitation": lines == [missing]}


# ── Patrol, investigations, scam alerts ───────────────────────────────────────

def patrol_findings(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {"answer": "Apollo has no recent findings recorded for this device.", "navigate": ["/(tabs)/patrol"], "limitation": False}
    lines = []
    for item in items[:5]:
        line = f"{item.get('headline') or 'Finding'} — {STATE_TEXT.get(item.get('effectiveState'), item.get('effectiveState') or 'state not known')}."
        if item.get("evidence_availability") == "limited_to_originating_device":
            line += " The details of this one stay on the phone that found it."
        elif item.get("summary"):
            line += f" {item['summary']}"
        lines.append(line)
    return {"answer": "Apollo's most recent findings:\n" + _bullets(lines), "navigate": ["/(tabs)/patrol"], "limitation": False}


def recent_investigations(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {"answer": "You don't have any recent Magnum DI investigations on this device.", "navigate": ["/saved-reports"], "limitation": False}
    lines = [f"{(item.get('gates') or ['Apollo'])[0].title()} check ({item.get('status')}): {item.get('summary')}" for item in items[:5]]
    return {"answer": "Your recent Magnum DI investigations, in Magnum DI's own words:\n" + _bullets(lines), "navigate": ["/saved-reports"], "limitation": False}


def scam_alerts(alerts: list[dict[str, Any]]) -> dict[str, Any]:
    if not alerts:
        return {"answer": "There are no current official scam alerts from the government sources Apollo follows.", "navigate": ["/(tabs)/scams"],
                "limitation": False, "sources": []}
    lines = [f"{a['title']} — {a['source']}, {a.get('dateLabel') or 'date not stated'}. Urgency: {SEVERITY_TEXT.get(a.get('severity'), 'not rated')}."
             for a in alerts[:5]]
    return {"answer": "The latest official scam alerts:\n" + _bullets(lines), "navigate": ["/(tabs)/scams"], "limitation": False,
            "sources": [{"title": a["title"], "publisher": a["source"], "url": a["url"], "route": None, "licence": None} for a in alerts[:5]]}


def scam_alert_explanation(alert: dict[str, Any]) -> dict[str, Any]:
    """One alert, section by section, in the source's own words. Empty sections say so."""
    h = alert.get("higgins") or {}
    not_said = "The source doesn't say."
    parts = [f"“{alert['title']}” — {alert['source']}, {alert.get('dateLabel') or 'date not stated'}.",
             f"What happened:\n{h.get('whatHappened') or not_said}",
             f"Where:\n{h.get('whereHappening') or not_said}",
             f"What to watch for:\n{h.get('whatToWatch') or not_said}",
             f"What to do:\n{h.get('whatToDo') or not_said}",
             f"Urgency: {SEVERITY_TEXT.get(alert.get('severity'), 'not rated')}. {alert.get('severityReason') or ''}".strip()]
    return {"answer": "\n\n".join(parts), "navigate": [], "limitation": False,
            "sources": [{"title": alert["title"], "publisher": alert["source"], "url": alert["url"], "route": None, "licence": None}]}


# ── Apollo product knowledge ──────────────────────────────────────────────────

_PRODUCT_TOPICS = {"privacy": "privacy", "flows": "flows", "call_screening": "call_screening", "settings_detail": "settings_detail"}
_HIGGINS_ONLY = re.compile(r"\s*[—-]?\s*(?:never offer[^.]*|Say this plainly; never imply parity|\(state accurately\))\.?", re.I)


def _display(module_text: str) -> tuple[str, list[str]]:
    """Product knowledge as the person should read it: heading and instructions-to-Higgins removed, routes as links."""
    routes = [r for r in re.findall(r"`([^`]+)`", module_text) if app_knowledge.valid_route(r)]
    body = "\n".join(module_text.splitlines()[1:])
    body = re.sub(r"\s*`[^`]+`", "", body)
    body = _HIGGINS_ONLY.sub("", body)
    return body.strip(), routes


def product_knowledge(question: str, modules: list[str]) -> Optional[dict[str, Any]]:
    """Apollo's own product knowledge, verbatim, plus the screens that do what was asked."""
    blocks: list[str] = []
    navigate: list[str] = []
    for module in modules:
        text = app_knowledge.KNOWLEDGE_MODULES.get(module)
        if text:
            body, routes = _display(text)
            blocks.append(body)
            navigate.extend(r for r in routes if r not in navigate)
    query_terms = terms(question)
    scored = []
    for group in app_knowledge.ROUTE_GROUPS.values():
        for route, description in group.items():
            have = set(terms(description))
            cover = sum(1 for t in query_terms if t in have) / len(query_terms) if query_terms else 0
            if cover >= 0.5:
                scored.append((cover, route, description))
    scored.sort(key=lambda item: -item[0])
    places = []
    for _cover, route, description in scored:
        if route not in [p[0] for p in places]:
            places.append((route, description))
        if len(places) == 2:
            break
    if places:
        blocks.append("You can do that here:\n" + _bullets([description for _route, description in places]))
        navigate = [route for route, _d in places] + [r for r in navigate if r not in [p[0] for p in places]]
    if not blocks:
        return None
    return {"answer": "\n\n".join(blocks), "navigate": navigate[:2], "limitation": False}
