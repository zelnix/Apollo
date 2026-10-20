"""Preview Gemini simulator — the ONLY substitution Apollo makes in preview.

Apollo → Magnum DI → Gemini Simulator → Magnum DI → Higgins

Everything before this point is the real production pipeline: the real Magnum DI prompt, the real
investigation evidence, the real on-device privacy screening and redaction, and the real attachments
that would have been transmitted. This module replaces ONLY the external Gemini API call, and it
always succeeds, returning the one fixed V1 response for every investigation.

What it does NOT do: it does not simulate Magnum DI, evidence handling, privacy/redaction, Higgins,
findings, state management or investigation reporting. The returned material goes through the real
validation, commit and Higgins workflow exactly as a live Gemini response would.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from google.genai import types

from services.gemini_usage import record_usage as _record_usage
from services.higgins.llm_boundary import Purpose

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


def _investigation_payload() -> dict:
    """The fixed response in the shape the real investigation contract expects, so the real
    validator, the real commit and the real Higgins workflow process it unchanged."""
    return {
        "overview": "Magnum DI analysed the submitted content for scam, phishing, fraud, impersonation "
                    "and malicious-link indicators and reports characteristics that may warrant caution "
                    "and further investigation.",
        "explanationMarkdown": FIXED_PREVIEW_RESPONSE,
        "assessment": "uncertain",
        "attention": "review",
        "attentionReason": "The material contains characteristics that may warrant caution until the "
                           "sender or organisation has been independently verified.",
        "findings": [
            {
                "text": "The content was analysed for indicators associated with scams, phishing, fraud, "
                        "impersonation, malicious links and deceptive requests.",
                "basis": "inference",
                "confidence": "medium",
                "evidenceIds": [],
                "sourceIds": [],
                "supersedesFindingIds": [],
            },
            {
                "text": "Independent verification of the sender or organisation, using trusted contact "
                        "details, is required before passwords, security codes, banking details or "
                        "personal information are provided.",
                "basis": "inference",
                "confidence": "medium",
                "evidenceIds": [],
                "sourceIds": [],
                "supersedesFindingIds": [],
            },
        ],
        "uncertainties": [
            "Whether the claims in the content can be independently verified is not established by the "
            "evidence available in this investigation.",
        ],
        "scope": "Analysis of the submitted content for scam, phishing, fraud, impersonation and "
                 "malicious-link indicators.",
        "sourceIds": [],
        "remainingEvidenceIds": [],
        "actions": [],
        "recommendedActionIndex": None,
        "question": None,
        "completion": "complete",
    }


def _chat_payload() -> dict:
    return {"reply": FIXED_PREVIEW_RESPONSE, "actions": [], "suggested_followups": []}


def _health_payload() -> dict:
    return {"status": "operational", "analysis": SIMULATED_NOTE, "risk_assessment": "none"}


def simulated_text(purpose: Purpose, json_output: bool) -> str:
    """The material the simulator returns at the boundary, in the form the caller asked for."""
    name = purpose.value if hasattr(purpose, "value") else str(purpose)
    if not json_output and name not in ("investigation",):
        return FIXED_PREVIEW_RESPONSE
    if name == "investigation":
        return json.dumps(_investigation_payload(), ensure_ascii=False)
    if name in ("chat", "conversation", "assistant"):
        return json.dumps(_chat_payload(), ensure_ascii=False)
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
    text = simulated_text(purpose, json_output)
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
