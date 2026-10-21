"""Deterministic context readers for Higgins chat.

Each reader is an authoritative, owner-scoped, freshness-checked data source.
The readers themselves are unchanged from their original implementation — only the
SELECTION mechanism has changed: context is now chosen deterministically by the
question classifier rather than by asking Gemini to pick tools.

Learn with Higgins article access is added as a new read-only source.
"""
from __future__ import annotations

import re
import logging
from datetime import timedelta
from typing import Awaitable, Callable, Optional

from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services import capability_registry, government_alerts
from services import patrol_records, learning
from services.higgins import context as memory
from services.higgins import repository as repo

log = logging.getLogger("apollo.higgins.context")


# ── Authoritative context readers (unchanged) ────────────────────────────────

def _result(items: list[dict], provenance: list[str], *, observed_at=None, confidence: str = "high") -> dict:
    now = now_utc(); fresh = observed_at or now
    return {"status": "ok" if items else "none_found", "items": items, "provenance": provenance,
            "observedAt": fresh.isoformat() if hasattr(fresh, "isoformat") else str(fresh),
            "freshThrough": (now + timedelta(minutes=15)).isoformat(), "confidence": confidence,
            "note": "No matching owner-scoped record was found." if not items else "Secrets and raw evidence are excluded."}


async def protection(owner: str) -> dict:
    items = [item for item in await memory.current(owner) if item.category == "protection_state"][:3]
    return _result([{"summary": item.summary, "observedAt": item.observed_at.isoformat()} for item in items], ["device_observation"], observed_at=items[0].observed_at if items else None)


async def recent_cases(owner: str) -> dict:
    rows = await db.investigation_cases.find({"owner_id": owner, "deleted": False}, {"_id": 0, "case_id": 1, "status": 1, "gates": 1, "updated_at": 1, "accepted_commits": 1}).sort("updated_at", -1).limit(5).to_list(5)
    items = []
    for row in rows:
        turns = await repo.accepted_turns(owner, row); latest = max(turns, key=lambda turn: turn.committed_at) if turns else None
        items.append({"caseId": row["case_id"], "status": row["status"], "gates": row.get("gates", []), "updatedAt": row["updated_at"].isoformat(),
                      "summary": redact_investigation_secrets(latest.response.overview)[:400] if latest else "No completed answer yet."})
    return _result(items, ["investigation_case_store"], observed_at=rows[0]["updated_at"] if rows else None)


async def patrol(owner: str, *, one: bool = False) -> dict:
    limit = 1 if one else 5
    rows = [row for row in await patrol_records.current(owner, limit + 5) if row["category"] != "system"][:limit]
    items = []
    for row in rows:
        provenance = row.get("evidence_provenance", "")
        is_projected = provenance == "server_projected" or (not provenance and not (row.get("summary") or "").strip())
        effective_state = row["effectiveState"]
        has_block = row.get("observedBlockReference") is not None
        scenario_ctx = row.get("scenarioContext") or {}
        structured_facts = {
            "category": row["category"],
            "effectiveState": effective_state,
            "verifiedBlock": has_block,
            "indicatorHost": scenario_ctx.get("indicatorHost"),
            "claimedBrand": scenario_ctx.get("claimedBrand"),
            "occurredAt": row["occurredAt"].isoformat() if hasattr(row["occurredAt"], "isoformat") else str(row["occurredAt"]),
        }
        summary_text = row.get("summary") or ""
        items.append({
            "recordId": row["recordId"], "logicalIssueKey": row["logicalIssueKey"], "category": row["category"],
            "effectiveState": effective_state, "effectiveReason": row["effectiveReason"],
            "headline": redact_investigation_secrets(row["headline"])[:200],
            "summary": redact_investigation_secrets(summary_text)[:400] if not is_projected else "Detailed evidence is only available on the originating device.",
            "evidence_availability": "full" if not is_projected else "limited_to_originating_device",
            "evidence_provenance": provenance or ("local_device" if not is_projected else "server_projected"),
            "structuredFacts": structured_facts,
            "occurredAt": row["occurredAt"].isoformat() if hasattr(row["occurredAt"], "isoformat") else str(row["occurredAt"]),
            "observedBlockReference": row.get("observedBlockReference"),
        })
    observed = rows[0]["occurredAt"] if rows else None
    return _result(items, ["authoritative_patrol_record_store"], observed_at=observed)


async def saved_reports(owner: str) -> dict:
    """Server-side saved reports have been removed (Stage 11).  Returns empty result.
    The device owns completed investigation records locally."""
    return _result([], ["device_local_storage"], observed_at=None)


async def preferences(owner: str) -> dict:
    items = [item for item in await memory.current(owner) if item.category == "preference"][:10]
    learning_preferences = await db.learning_preferences.find_one({"owner_id": owner}, {"_id": 0, "owner_id": 0})
    values = [{"summary": item.summary, "observedAt": item.observed_at.isoformat()} for item in items]
    if learning_preferences: values.append({"learning": learning_preferences})
    return _result(values, ["owner_preference_store", "learning_preference_store"], observed_at=items[0].observed_at if items else learning_preferences.get("updatedAt") if learning_preferences else None)


async def scams(_owner: str) -> dict:
    value = await government_alerts.snapshot(5)
    items = [{"title": item["title"], "source": item["source"], "region": item.get("regionLabel"),
              "severity": item.get("severity"), "australianRelevance": item.get("australianRelevance"),
              "publishedAt": item["publishedAt"].isoformat() if item.get("publishedAt") else None, "url": item["url"]}
             for item in value["alerts"]]
    statuses = [feed["status"] for feed in value["feeds"].values()]
    return _result(items, ["recognised_government_feed_cache"], confidence="high" if "fresh" in statuses else "medium")


async def product_capabilities(owner: str) -> dict:
    value = await capability_registry.product_capabilities(owner)
    return _result([value], ["authoritative_capability_registry"], observed_at=value["generatedAt"])


async def gate_states(owner: str) -> dict:
    value = await capability_registry.gate_states(owner)
    return _result(value["items"], ["authoritative_gate_registry", "fresh_device_observation"], observed_at=value["generatedAt"])


# ── NEW: Learn with Higgins article search ────────────────────────────────────

async def learn_articles(query: str) -> dict:
    """Search published Learn with Higgins articles for content relevant to the query.

    Read-only access to the published catalogue. Never publishes or edits.
    """
    try:
        result = await learning.list_articles(
            category=None, audience=None, tag=None, risk_context=None,
            content_type=None, language=None, search=query[:80] if query else None,
            cursor=None, limit=5,
        )
        items = []
        for article_summary in result.get("items", []):
            # For matched articles, also fetch full content for Higgins to reference
            full = await learning.get_article(article_summary["slug"])
            if full:
                sections_text = ""
                for section in (full.get("sections") or [])[:4]:
                    heading = section.get("heading", "")
                    paragraphs = "\n".join(str(p) for p in (section.get("paragraphs") or []))
                    bullets = "\n".join(f"- {b}" for b in (section.get("bullets") or []))
                    sections_text += f"\n### {heading}\n{paragraphs}\n{bullets}" if heading else f"\n{paragraphs}\n{bullets}"
                items.append({
                    "slug": full["slug"],
                    "title": full["title"],
                    "summary": full.get("summary", ""),
                    "category": full.get("category", ""),
                    "content": redact_investigation_secrets(sections_text)[:2000],
                    "citations": [{"label": c.get("label", ""), "url": c.get("url", "")} for c in (full.get("citations") or [])[:4]],
                })
            else:
                items.append({
                    "slug": article_summary["slug"],
                    "title": article_summary["title"],
                    "summary": article_summary.get("summary", ""),
                })
        return _result(items, ["learn_with_higgins_catalogue"])
    except Exception:
        return _result([], ["learn_with_higgins_catalogue"], confidence="low")


async def learn_index() -> dict:
    """The Learn with Higgins catalogue as titles only.

    Supplied on every turn so Higgins knows which articles exist and can name and
    link the right one. Full article bodies are only fetched when the question is
    actually educational (see `learn_articles`).
    """
    try:
        result = await learning.list_articles(
            category=None, audience=None, tag=None, risk_context=None,
            content_type=None, language=None, search=None, cursor=None, limit=30,
        )
        items = [{"slug": item["slug"], "title": item["title"], "category": item.get("category", "")}
                 for item in result.get("items", [])]
        return _result(items, ["learn_with_higgins_catalogue"])
    except Exception:
        return _result([], ["learn_with_higgins_catalogue"], confidence="low")


# ── Deterministic context classifier ─────────────────────────────────────────

class ContextPlan:
    """Minimum set of context readers to call for a given question."""
    __slots__ = ("readers", "label", "learn_query")

    def __init__(self, readers: list[str], label: str, learn_query: Optional[str] = None):
        self.readers = readers
        self.label = label
        self.learn_query = learn_query

    def __repr__(self) -> str:
        return f"ContextPlan({self.label}, readers={self.readers})"


# Patterns for deterministic classification — ordered by specificity
_PROTECTION_RE = re.compile(
    r"(?i)\b(?:am i|is (?:my|the|this)|are (?:my|we))\s+(?:\w+ )?(?:protected|safe|secure)"
    r"|(?:protection|security)\s+(?:status|state|running|active|on|off|working)"
    r"|(?:is|are)\s+(?:apollo|protection)\s+(?:on|running|active|working|enabled|protecting)"
    r"|apollo\s+protecting"
)
_CURRENT_ISSUES_RE = re.compile(
    r"(?i)(?:why\s+(?:is|are|'s)\s+(?:apollo|it|you)\s+(?:barking|growling|warning|alerting))"
    r"|(?:what(?:'s| is)\s+wrong)"
    r"|(?:any|what|are there)\s+(?:issues?|problems?|warnings?|alerts?)"
    r"|(?:needs?|requires?)\s+attention"
)
_PATROL_HISTORY_RE = re.compile(
    r"(?i)(?:what\s+happened|what(?:'s| has)\s+been\s+(?:happening|going on))"
    r"|(?:recent|latest|last)\s+(?:findings?|events?|checks?|activity|results?|scans?)"
    r"|(?:show\s+me|tell\s+me\s+about)\s+(?:my\s+)?(?:recent|latest|patrol|history|findings)"
)
_SCAM_ALERTS_RE = re.compile(
    r"(?i)(?:scam|fraud|threat)\s+(?:alerts?|warnings?|advisories?|bulletins?|news)"
    r"|(?:latest|recent|new|current)\s+(?:scam|fraud|threat|phishing)s?"
    r"|(?:government|official)\s+(?:scam|fraud|threat)\s+(?:alerts?|warnings?)"
    r"|(?:what\s+scams?\s+(?:are|is)\s+(?:there|around|going|happening|active))"
)
_INVESTIGATION_EXPLAIN_RE = re.compile(
    r"(?i)(?:explain|tell me about|summarise|summarize|describe)\s+(?:this|that|the|my|an?)\s*(?:investigation|case|report|result|finding|assessment)"
    r"|(?:what\s+did\s+(?:magnum|apollo|it)\s+find)"
    r"|(?:what\s+(?:does|did)\s+(?:the|this|that|my)\s+(?:investigation|report|case)\s+(?:say|find|show|mean))"
)
_PRODUCT_INFO_RE = re.compile(
    r"(?i)(?:what\s+(?:does|can|is)\s+(?:apollo|higgins|magnum))"
    r"|(?:how\s+(?:does|do)\s+(?:apollo|higgins|magnum|protection|gates?))"
    r"|(?:features?|capabilities?|settings?)\s+(?:of|in|for)?\s*(?:apollo)?"
    r"|(?:what\s+(?:are|is)\s+(?:the\s+)?gates?)"
)
_LEARN_RE = re.compile(
    r"(?i)(?:how\s+(?:can i|do i|to)\s+(?:recognise|recognize|spot|identify|avoid|prevent|report|protect))"
    r"|(?:what\s+(?:is|are)\s+(?:a\s+)?(?:phishing|smishing|vishing|romance|investment|impersonation|identity|credential|social engineering))"
    r"|(?:teach|educate|learn|article|guide|tip|advice)\s+(?:me|about)"
    r"|(?:show\s+me\s+(?:what\s+you(?:'ve| have)\s+got|articles?|guides?|tips?))"
    r"|(?:tell\s+me\s+(?:about|how)\s+\w+\s+scam)"
    r"|(?:types?\s+of\s+(?:scam|fraud|phishing|attack))"
)
_DEVICE_INFO_RE = re.compile(
    r"(?i)(?:what\s+(?:version|os|android|ios|phone|device|model|build))"
    r"|(?:my\s+(?:device|phone|os|android|ios)\s+(?:version|info|details|model))"
    r"|(?:(?:device|phone|os)\s+(?:info|details|information))"
    r"|(?:what\s+(?:am i|phone am i)\s+(?:running|using))"
)


def classify_context(message: str, *, has_selected_report: bool = False,
                     has_selected_patrol_record: bool = False) -> ContextPlan:
    """Deterministically select the minimum Apollo context required for a Higgins question.

    This replaces the previous pattern of asking Gemini to choose from a toolbox
    of context functions.  The classification is fast, predictable and testable.
    """
    msg = message.strip()

    # If viewing a specific investigation report, no extra context needed —
    # the report content is injected directly by the caller.
    if has_selected_report:
        return ContextPlan([], "investigation_report_context")

    # If viewing a patrol record, supply that record's context
    if has_selected_patrol_record:
        return ContextPlan(["get_last_relevant_outcome"], "patrol_record_context")

    # Protection / device status
    if _PROTECTION_RE.search(msg):
        return ContextPlan(["get_protection_summary", "get_gate_states"], "protection_status")

    # Current issues / "Why is Apollo growling?"
    if _CURRENT_ISSUES_RE.search(msg):
        return ContextPlan(["get_last_relevant_outcome", "get_protection_summary"], "current_issues")

    # Device info (OS version, model, etc.)
    if _DEVICE_INFO_RE.search(msg):
        return ContextPlan(["get_product_capabilities"], "device_info")

    # Patrol history / recent activity (check BEFORE investigation explain)
    if _PATROL_HISTORY_RE.search(msg):
        return ContextPlan(["get_recent_patrol_outcomes"], "patrol_history")

    # Scam Alerts
    if _SCAM_ALERTS_RE.search(msg):
        return ContextPlan(["get_new_scams_digest"], "scam_alerts")

    # Investigation explanation (only when NOT already viewing a report)
    if _INVESTIGATION_EXPLAIN_RE.search(msg):
        return ContextPlan(["get_recent_cases", "get_saved_reports"], "investigation_explain")

    # Learn with Higgins / educational content
    if _LEARN_RE.search(msg):
        # Extract a search query from the message
        learn_query = msg[:80]
        return ContextPlan([], "learn_articles", learn_query=learn_query)

    # Product info / "What does Apollo do?"
    if _PRODUCT_INFO_RE.search(msg):
        return ContextPlan(["get_product_capabilities"], "product_info")

    # Default: no context needed (general security/scam question)
    return ContextPlan([], "general_knowledge")


# ── Reader registry (unchanged) ──────────────────────────────────────────────

READERS: dict[str, Callable[[str], Awaitable[dict]]] = {
    "get_protection_summary": protection, "get_recent_cases": recent_cases,
    "get_last_relevant_outcome": lambda owner: patrol(owner, one=True), "get_saved_reports": saved_reports,
    "get_recent_patrol_outcomes": patrol, "get_user_learning_preferences": preferences, "get_new_scams_digest": scams,
    "get_product_capabilities": product_capabilities, "get_gate_states": gate_states,
    "get_learn_catalogue": lambda _owner: learn_index(),
}

# Higgins is the savant of Apollo, so these are gathered on every turn rather than
# only when a question happens to match a pattern. Everything the service holds for
# this person is in front of him before he answers.
CORE_READERS: tuple[str, ...] = (
    "get_protection_summary",
    "get_gate_states",
    "get_recent_patrol_outcomes",
    "get_recent_cases",
    "get_new_scams_digest",
    "get_learn_catalogue",
)


def with_core_readers(plan: ContextPlan) -> ContextPlan:
    """Return the plan with the always-on Apollo readers merged in, order preserved."""
    merged = list(CORE_READERS)
    for reader in plan.readers:
        if reader not in merged:
            merged.append(reader)
    return ContextPlan(merged, plan.label, plan.learn_query)


async def execute(owner: str, name: str) -> dict:
    reader = READERS.get(name)
    if not reader:
        return {"status": "unknown_tool", "items": [], "provenance": [], "confidence": "low"}
    try:
        return await reader(owner)
    except Exception:  # noqa: BLE001 — context absence is explicit, never fabricated
        return {"status": "unavailable", "items": [], "provenance": [], "confidence": "low", "note": "This context source is unavailable."}


async def gather_context(owner: str, plan: ContextPlan) -> tuple[str, list[dict]]:
    """Execute the context plan and return (context_text, context_uses).

    This is the single entry point for all deterministic context gathering.
    Returns a formatted text block ready for injection into the Higgins prompt,
    plus structured metadata about what was consulted.
    """
    uses: list[dict] = []
    context_parts: list[str] = []

    # Fetch Learn articles if the plan requests it
    if plan.learn_query:
        learn_result = await learn_articles(plan.learn_query)
        uses.append({"source": "learn_articles", "status": learn_result.get("status", "unavailable"),
                      "provenance": learn_result.get("provenance", [])})
        if learn_result.get("items"):
            parts = ["--- LEARN WITH HIGGINS ARTICLES ---"]
            for article in learn_result["items"]:
                parts.append(f"\nArticle: {article.get('title', 'Untitled')}")
                if article.get("summary"):
                    parts.append(f"Summary: {article['summary']}")
                if article.get("content"):
                    parts.append(article["content"])
                if article.get("citations"):
                    parts.append("Sources: " + ", ".join(f"{c['label']} ({c['url']})" for c in article["citations"] if c.get("url")))
            parts.append("--- END LEARN ARTICLES ---")
            parts.append("Use the above articles to answer the person's question. Reference the article by name when relevant.")
            context_parts.append("\n".join(parts))

    # Fetch registered context readers
    for reader_name in plan.readers:
        result = await execute(owner, reader_name)
        uses.append({"source": reader_name, "status": result.get("status", "unavailable"),
                      "provenance": result.get("provenance", []),
                      "observedAt": result.get("observedAt")})
        if result.get("items"):
            context_parts.append(f"--- {reader_name.upper()} ---\n{_format_context_items(reader_name, result['items'])}\n--- END ---")

    context_text = "\n\n".join(context_parts) if context_parts else ""
    return context_text, uses


def _format_context_items(reader_name: str, items: list[dict]) -> str:
    """Format context items into a readable text block for the prompt."""
    if not items:
        return "No data available."
    limit = 30 if reader_name == "get_learn_catalogue" else 8
    parts = []
    for item in items[:limit]:
        if isinstance(item, dict):
            # Filter out internal fields and format compactly
            display = {k: v for k, v in item.items() if v is not None and k not in ("_id",)}
            parts.append(str(display))
        else:
            parts.append(str(item))
    return "\n".join(parts)
