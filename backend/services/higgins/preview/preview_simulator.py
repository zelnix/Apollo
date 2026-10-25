"""Preview Gemini simulator — the ONLY substitution Apollo makes in preview.

Apollo → Magnum DI → Gemini Simulator (+ Apollo knowledge base) → Magnum DI → Higgins

Everything before this point is the real production pipeline: the real Magnum DI prompt, the real
investigation evidence, the real on-device privacy screening and redaction, and the real attachments
that would have been transmitted. This module replaces ONLY the external Gemini API call, and it
always succeeds.

Its information base is Apollo's own knowledge base (Learn with Higgins, official scam alerts, official
guidance and the trusted pages Apollo maintains) — never Gemini, never the web at question time:
- A Higgins question is answered with what the knowledge base says, quoted with its source, or says plainly
  that the knowledge base has nothing on it.
- An investigation is derived from THE ACTUAL EVIDENCE that was sent (see preview_analysis), and any
  knowledge-base entry on the same subject is added as general knowledge — never as a finding.
- A Device Protection explanation uses a matching entry where there is one.
It is deterministic and rule-based, it quotes only what the evidence and the knowledge base contain, and
it is labelled SIMULATED everywhere.

What it does NOT do: it does not simulate Magnum DI, evidence handling, privacy/redaction, Higgins,
state management or investigation reporting. The returned material goes through the real validation,
commit and Higgins workflow exactly as a live Gemini response would.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any

from google.genai import types

from services.gemini_usage import record_usage as _record_usage
from services.higgins import knowledge
from services.higgins.llm_boundary import Purpose
from services.higgins.preview_analysis import EvidenceBlock, analyse

# ── The one fixed V1 response ────────────────────────────────────────────────
# Returned verbatim as the provider's material for every preview investigation. Higgins decides how
# to explain and guide from it, through the normal workflow.
FIXED_PREVIEW_RESPONSE = (
    "The submitted content has been analysed for indicators associated with scams, phishing, fraud, "
    "impersonation, malicious links, deceptive requests and other suspicious activity.\n\n"
    "The material contains characteristics that may warrant caution and further investigation. "
    "Consider the claimed identity of the sender, source of the communication, links or attachments, "
    "requests for money or personal information, urgency or pressure, and whether the claims can be "
    "independently verified.\n\n"
    "Verify the sender or organisation independently using trusted contact information. Avoid "
    "suspicious links or attachments and do not provide passwords, security codes, banking details or "
    "personal information until the source has been verified.\n\n"
    "If links, accounts or payments are involved, verify them through the organisation's official app, "
    "website or independently obtained contact details.\n\n"
    "Helpful guidance for Higgins: explain the potential concern in plain language, identify relevant "
    "warning signs available in the evidence, provide practical step-by-step actions, prioritise "
    "independent verification, distinguish verified findings from assumptions, and explain what "
    "additional information is required where the evidence is insufficient."
)

SIMULATED_NOTE = "SIMULATED — No Gemini API call was made"


# ── Apollo's knowledge base as the simulator's information base ─────────────

def _kb_passage(entry: dict, query: str, max_chars: int) -> str:
    """One entry, the way Higgins quotes the library: who says it, their words, provenance, the link."""
    words = knowledge.excerpt(entry.get("body") or entry.get("summary") or "", knowledge.terms(query), max_chars=max_chars)
    intro = (f"The Learn with Higgins article “{entry['title']}”" if entry.get("kind") == "learn_article"
             else f"{entry.get('publisher') or 'Apollo'} — “{entry['title']}”")
    meta = knowledge.provenance_line(entry)
    link = f"\nRead the original: {entry['url']}" if entry.get("url") else ""
    return f"{intro}{(' ' + meta) if meta else ''}:\n{words}{link}"


def _kb_reference(entry: dict) -> str:
    return f"- {entry.get('publisher') or 'Apollo'}: “{entry['title']}”" + (f" — {entry['url']}" if entry.get("url") else "")


def query_text(purpose_name: str, blocks: list[EvidenceBlock]) -> str:
    """What to look up in the knowledge base: the evidence for an investigation, otherwise the person's own
    question, or the protection being explained."""
    if purpose_name == "investigation":
        evidence = " ".join(b.text for b in blocks if b.evidence_id and b.text)
        if evidence:
            return evidence[:4000]
    raw = " ".join((b.text or "") for b in blocks if b.kind == "question").strip()
    try:
        data = json.loads(raw) if raw else None
    except (ValueError, TypeError):
        data = None
    if isinstance(data, dict):
        for field in ("message", "protection"):
            if isinstance(data.get(field), str):
                return data[field].split("\n\n", 1)[0]
    return raw.split("\n\n", 1)[0][:4000]


def _investigation_payload(blocks: list[EvidenceBlock], kb: list[dict] | None = None) -> dict:
    """The simulated result in the shape the real investigation contract expects, built from the
    evidence that was actually sent, so the real validator, commit and Higgins workflow process it
    unchanged. Knowledge-base entries on the same subject are general knowledge, never a finding."""
    payload = analyse(blocks)
    if kb:
        payload["explanationMarkdown"] += ("\n\n**From Apollo's knowledge base** (general knowledge, not a finding about what you sent):\n"
                                           + "\n".join(_kb_reference(entry) for entry in kb[:2]))
    return payload


_EVIDENCE_LABEL = re.compile(r"^\[evidence ([^\s\]·]+)[^\]]*\]\s*", re.I)
_KIND = re.compile(r"kind=([a-z_]+)", re.I)


def evidence_blocks(contents: Any) -> list[EvidenceBlock]:
    """Read the evidence back out of the request that was about to be sent to Gemini.

    Every evidence part carries its registered id in the label line (evidence.py::model_parts), so the
    findings can cite real evidence ids and the text can be quoted exactly as the model would see it.
    """
    blocks: list[EvidenceBlock] = []
    items = contents if isinstance(contents, list) else [contents]
    for item in items:
        parts = getattr(item, "parts", None) or ([item] if not isinstance(item, (list, tuple)) else list(item))
        for part in parts:
            text = part if isinstance(part, str) else getattr(part, "text", None)
            if text:
                label_match = _EVIDENCE_LABEL.match(text.strip())
                if label_match:
                    label_line = text.strip().split("\n", 1)[0]
                    kind_match = _KIND.search(label_line)
                    blocks.append(EvidenceBlock(
                        evidence_id=label_match.group(1),
                        kind=(kind_match.group(1) if kind_match else "text"),
                        label=label_line.strip("[]"),
                        text=_EVIDENCE_LABEL.sub("", text.strip(), count=1),
                    ))
                else:
                    # The person's own question/message — evidence for what they asked, not an item.
                    blocks.append(EvidenceBlock(evidence_id=None, kind="question", label="the question you asked", text=text.strip()))
            elif getattr(part, "inline_data", None) is not None:
                blocks.append(EvidenceBlock(evidence_id=None, kind="image", label="an image you submitted", text=""))
    return blocks


def _preview_question(blocks: list[EvidenceBlock] | None) -> str:
    """The person's own words, separated from the context Apollo appended to them.

    Chat sends one JSON string whose `message` is the question followed by the
    injected Apollo context. Only the question itself may steer the preview route,
    so the context is cut away here.
    """
    raw = " ".join((block.text or "") for block in (blocks or []) if block.kind == "question").strip()
    if not raw:
        return ""
    try:
        message = json.loads(raw).get("message")
        if isinstance(message, str):
            return message.split("\n\n", 1)[0].lower()
    except (ValueError, TypeError, AttributeError):
        pass
    return raw.split("\n\n", 1)[0].lower()


def _chat_payload(blocks: list[EvidenceBlock] | None = None, kb: list[dict] | None = None, query: str = "") -> dict:
    """An ordinary-chat reply in the shape `chat.ModelChatReply` requires.

    Preview replaces only the Gemini call, so the reply must still be valid for the real validator, and it
    must still exercise the real deep-link path. The answer is what Apollo's knowledge base says on the
    question, quoted with its source — or a plain statement that it has nothing. The route is chosen
    deterministically from the words in the question against Apollo's own destination list.
    """
    question = _preview_question(blocks)
    route = next((r for words, r in _PREVIEW_ROUTE_HINTS if all(word in question for word in words)), None)
    if kb:
        passages = "\n\n".join(_kb_passage(entry, query or question, 500) for entry in kb[:2])
        answer = f"{SIMULATED_NOTE}. Preview build — instead of Gemini, here is what Apollo's knowledge base says:\n\n{passages}"
    else:
        answer = (f"{SIMULATED_NOTE}. Preview build — Gemini isn't called here, and Apollo's knowledge base has nothing on "
                  "this yet, so there is no answer to show."
                  + (" The destination below is the one Apollo matched to your question." if route else ""))
    return {
        "answer": answer[:2000],
        "evidenceBasis": ["preview_simulator", "apollo_kb"] if kb else ["preview_simulator"],
        "uncertainty": ["Preview build: this answer was not generated by Gemini."],
        "clarification": None,
        "recommendInvestigation": False,
        "destination": None,
        "navigate": [route] if route else [],
    }


_EXPLANATION_FIELDS = {"what", "why", "protects_against"}


def _explanation_payload(kb: list[dict] | None, query: str) -> dict:
    """A Device Protection explanation in the shape `ModelExplanation` requires, labelled as simulated."""
    if kb:
        entry = kb[0]
        words = knowledge.excerpt(entry.get("body") or entry.get("summary") or "", knowledge.terms(query), max_chars=260)
        why = f"From {entry.get('publisher') or 'Apollo'} — “{entry['title']}”: {words}"
    else:
        why = "Apollo's knowledge base has nothing on this protection yet."
    return {
        "what": f"{SIMULATED_NOTE}. Preview build, so Gemini wasn't asked to explain “{query}”."[:400],
        "why": why[:400],
        "protects_against": "Shown in the published app, where Higgins explains it."[:300],
        "recommended": "Open the published Apollo app for Higgins' explanation."[:300],
    }


# Word sets → Apollo destination, used only by the preview simulator. Most specific first.
_PREVIEW_ROUTE_HINTS: list[tuple[tuple[str, ...], str]] = [
    (("call", "screen"), "/call-guard"),
    (("number",), "/call-guard"),
    (("message",), "/message"),
    (("email",), "/email"),
    (("link",), "/check"),
    (("website",), "/check"),
    (("screenshot",), "/vision"),
    (("app",), "/app-check"),
    (("wifi",), "/network"),
    (("internet",), "/network"),
    (("device",), "/device"),
    (("privacy",), "/privacy-disclosure"),
    (("protect",), "/gates"),
    (("threat",), "/(tabs)/patrol"),
    (("scam",), "/higgins/scams"),
    (("learn",), "/higgins/learning"),
    (("setting",), "/(tabs)/settings"),
]


def _health_payload() -> dict:
    return {"status": "operational", "analysis": SIMULATED_NOTE, "risk_assessment": "none"}


def simulated_text(purpose: Purpose, json_output: bool, blocks: list[EvidenceBlock] | None = None,
                   kb: list[dict] | None = None, query: str = "", response_schema: Any = None) -> str:
    """The material the simulator returns at the boundary, in the form the caller asked for."""
    name = purpose.value if hasattr(purpose, "value") else str(purpose)
    if not json_output and name not in ("investigation",):
        return FIXED_PREVIEW_RESPONSE
    if name == "investigation":
        return json.dumps(_investigation_payload(blocks or [], kb), ensure_ascii=False)
    if _EXPLANATION_FIELDS <= set(getattr(response_schema, "model_fields", None) or {}):
        return json.dumps(_explanation_payload(kb, query), ensure_ascii=False)
    if name in ("ordinary_chat", "chat", "conversation", "assistant"):
        return json.dumps(_chat_payload(blocks, kb, query), ensure_ascii=False)
    if name in ("health", "health_check", "diagnostics"):
        return json.dumps(_health_payload(), ensure_ascii=False)
    return json.dumps({"analysis": FIXED_PREVIEW_RESPONSE}, ensure_ascii=False)


def _estimate_tokens(chars: int) -> int:
    return max(1, chars // 4)


async def simulate_generate(
    system: str,
    contents: Any,
    *,
    model: str,
    capability: str,
    json_output: bool,
    tools: Any,
    timeout: float,
    response_schema: Any,
    purpose: Purpose,
    correlation_id: str | None,
    trigger_source: str | None,
    payload_audit: dict,
):
    """Answer from Apollo's knowledge base as a successful provider result. No external call is made."""
    from services.higgins.provider import GeminiResult  # local import: avoids a circular import

    started = time.monotonic()
    blocks = evidence_blocks(contents)
    name = purpose.value if hasattr(purpose, "value") else str(purpose)
    query = query_text(name, blocks)
    kb: list[dict] = []
    if json_output and query and name in ("investigation", "ordinary_chat"):
        try:
            kb = await knowledge.related(query)
        except Exception:  # noqa: BLE001 — the knowledge base can never break the simulator
            kb = []
    grounding = None
    if name == "teddy_search":
        text, grounding = await teddy_lookup(blocks)
    else:
        text = simulated_text(purpose, json_output, blocks, kb=kb, query=query, response_schema=response_schema)
    prompt_chars = (len(system) if system else 0) + int(payload_audit.get("total_text_chars") or 0)
    usage = {
        "prompt_token_count": _estimate_tokens(prompt_chars),
        "candidates_token_count": _estimate_tokens(len(text)),
        "total_token_count": _estimate_tokens(prompt_chars) + _estimate_tokens(len(text)),
        "cached_content_token_count": 0,
        "estimated": True,
        "simulated": True,
    }
    duration_ms = int((time.monotonic() - started) * 1000)

    try:
        await _record_usage(
            record_id=str(uuid.uuid4()),
            correlation_id=correlation_id,
            model=model,
            purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
            call_type="generate_json" if json_output else "generate_text",
            success=True,
            failure_code=None,
            usage_metadata=usage,
            duration_ms=duration_ms,
            extra={"payload_audit": payload_audit, "simulated": True, "trigger_source": trigger_source,
                   "note": SIMULATED_NOTE, "apollo_kb": [entry.get("kb_id") for entry in kb],
                   "search_tool": any(getattr(t, "google_search", None) is not None for t in tools or []), "search_queries": 0},
        )
    except Exception:
        pass

    return GeminiResult(
        text=text,
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        finish_reason="STOP",
        usage=usage,
        grounding=grounding,
        model=model,
        simulated=True,
    )


# ── TC FlyBy's targeted search, answered from Apollo's knowledge base ───────
_TEDDY_QUESTION = re.compile(r"^Q(\d+) \[statuses: ([A-Z_, ]+)\] \[subject: (.*?)\] (.+)$", re.M)


async def teddy_lookup(blocks: list[EvidenceBlock]) -> tuple[str, dict]:
    """Each TC FlyBy question answered from Apollo's KB, in the line format and grounding shape Google Search
    grounding produces. A warning is reported only when an official alert in the KB names the exact value;
    anything else is reported as not found. No web search is made."""
    from urllib.parse import urlparse

    prompt = "\n".join(b.text for b in blocks if b.kind == "question")
    lines: list[str] = []
    chunks: list[dict] = []
    supports: list[dict] = []
    offset = 0
    for match in _TEDDY_QUESTION.finditer(prompt):
        number, subject, question = match.group(1), match.group(3), match.group(4)
        statuses = [s.strip() for s in match.group(2).split(",")]
        entry = None
        try:
            if "ANSWER" in statuses:
                entry = next((e for e in await knowledge.search(question) if e.get("kind") != "gemini_answer"), None)
            elif "WARNING" in statuses:
                entry = next((e for e in await knowledge.related(f"{subject} {question}") if e.get("kind") == "scam_alert"
                              and subject.lower() in f"{e.get('title', '')} {e.get('body', '')}".lower()), None)
        except Exception:  # noqa: BLE001
            entry = None
        url = (entry or {}).get("url") or ""
        if entry and url.startswith("https://"):
            words = knowledge.excerpt(entry.get("body") or "", knowledge.terms(question), max_chars=280).replace("\n", " ")
            status = "ANSWER" if "ANSWER" in statuses else "WARNING"
            line = f"Q{number} | {status} | (Simulated from Apollo's knowledge base) {entry.get('publisher')}: “{entry.get('title')}” — {words}"
            host = (urlparse(url).hostname or "").removeprefix("www.")
            chunks.append({"web": {"uri": url, "title": host, "domain": host}})
            supports.append({"segment": {"start_index": offset, "end_index": offset + len(line.encode("utf-8")), "text": line},
                             "grounding_chunk_indices": [len(chunks) - 1]})
        else:
            missing = next((s for s in statuses if s.startswith(("NO_", "NOT_"))), statuses[-1])
            line = f"Q{number} | {missing} | (Simulated) Apollo's knowledge base has nothing on {subject}; no web search is made in preview."
        lines.append(line)
        offset += len(line.encode("utf-8")) + 1
    return "\n".join(lines), {"grounding_chunks": chunks, "grounding_supports": supports, "web_search_queries": []}
