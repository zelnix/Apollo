"""Preview Gemini simulator — the ONLY substitution Apollo makes in preview.

Apollo → Magnum DI → Gemini Simulator → Magnum DI → Higgins

Everything before this point is the real production pipeline: the real Magnum DI prompt, the real
investigation evidence, the real on-device privacy screening and redaction, and the real attachments
that would have been transmitted. This module replaces ONLY the external Gemini API call, and it
always succeeds.

The investigation result is derived from THE ACTUAL EVIDENCE that was sent (see preview_analysis):
the sender, the link, the amount, the request and the pressure present in the material are named, so
a preview investigation says something specific instead of a fixed paragraph. It is deterministic and
rule-based, it quotes only what the evidence contains, and it is labelled SIMULATED everywhere.

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


def _investigation_payload(blocks: list[EvidenceBlock]) -> dict:
    """The simulated result in the shape the real investigation contract expects, built from the
    evidence that was actually sent, so the real validator, commit and Higgins workflow process it
    unchanged."""
    return analyse(blocks)


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


def _chat_payload(blocks: list[EvidenceBlock] | None = None) -> dict:
    """An ordinary-chat reply in the shape `chat.ModelChatReply` requires.

    Preview replaces only the Gemini call, so the reply must still be valid for the
    real validator, and it must still exercise the real deep-link path — otherwise
    a preview build cannot show the navigation Higgins offers at all. The route is
    chosen deterministically from the words in the question against Apollo's own
    destination list; nothing is inferred and nothing is invented.
    """
    question = _preview_question(blocks)
    route = next((r for words, r in _PREVIEW_ROUTE_HINTS if all(word in question for word in words)), None)
    answer = (
        f"{SIMULATED_NOTE}. This is a preview build, so Higgins' wording is not generated — "
        "the question, Apollo's product knowledge and the live reading of this phone were all "
        "assembled and would have been sent to Gemini. "
        + ("The destination below is the one Apollo matched to your question." if route
           else "Install Apollo on the device for a real answer.")
    )
    return {
        "answer": answer,
        "evidenceBasis": ["preview_simulator"],
        "uncertainty": ["Preview build: the wording of this answer was not generated by Gemini."],
        "clarification": None,
        "recommendInvestigation": False,
        "destination": None,
        "navigate": [route] if route else [],
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


def simulated_text(purpose: Purpose, json_output: bool, blocks: list[EvidenceBlock] | None = None) -> str:
    """The material the simulator returns at the boundary, in the form the caller asked for."""
    name = purpose.value if hasattr(purpose, "value") else str(purpose)
    if not json_output and name not in ("investigation",):
        return FIXED_PREVIEW_RESPONSE
    if name == "investigation":
        return json.dumps(_investigation_payload(blocks or []), ensure_ascii=False)
    if name in ("ordinary_chat", "chat", "conversation", "assistant"):
        return json.dumps(_chat_payload(blocks), ensure_ascii=False)
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
    """Return the fixed response as a successful provider result. No external call is made."""
    from services.higgins.provider import GeminiResult  # local import: avoids a circular import

    started = time.monotonic()
    text = simulated_text(purpose, json_output, evidence_blocks(contents))
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
                   "note": SIMULATED_NOTE},
        )
    except Exception:
        pass

    return GeminiResult(
        text=text,
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        finish_reason="STOP",
        usage=usage,
        grounding=None,
        model=model,
    )
