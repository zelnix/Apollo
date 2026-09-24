"""One fixed, server-owned Higgins probe. No user evidence, research tools or normal case history."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime

from google.genai import types

from core.config import GEMINI_API_KEY
from core.redaction import redact_investigation_secrets
from services.higgins import coordinator, provider, report_store
from services.higgins.validation import validate

EVIDENCE_ID = "health-fixture-observation"
PROMPT = ("HEALTH_CHECK (synthetic, not a user submission): A fictional practice appliance displays a "
          "routine reminder to check its batteries. There is no link, phone number, account, threat, "
          "real device observation, or protective action. Explain cautiously that a reminder alone "
          "cannot establish safety or risk. Give one harmless instructional next step, at least one "
          "inference finding, a nonempty uncertainty and a full explanation. "
          "Use only evidence ID health-fixture-observation for cited observations; no sources, "
          "capabilities, questions, URLs or external lookups. Return the full Higgins JSON contract, "
          "completion complete, attention none, assessment uncertain. Never claim Apollo blocked anything.")
SYSTEM = coordinator.SYSTEM + "\nHEALTH_CHECK: fixed synthetic input only. Do not call tools, fetch public sources, or claim an actual device observation."


class HealthFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _validate_synthetic(value: dict, *, provider_complete: bool) -> dict:
    response, errors = validate(value, revision=1, evidence_ids={EVIDENCE_ID}, source_ids=set(), capability_ids=set(),
                                pending_question=None, provider_complete=provider_complete)
    if errors or not response or response.completion != "complete" or response.question or not response.findings or not response.actions:
        raise HealthFailure("invalid_provider_response")
    if not response.explanation_markdown.strip() or not response.uncertainties or not response.scope.strip():
        raise HealthFailure("invalid_provider_response")
    if any(action.kind != "instruction" for action in response.actions):
        raise HealthFailure("invalid_provider_response")
    if response.attention != "none" or response.assessment != "uncertain":
        raise HealthFailure("invalid_provider_response")
    for text in _strings(response.wire()):
        if (redact_investigation_secrets(text) != text or re.search(r"https?://|\bBearer\s+|\bApollo is biting\b", text, re.I)):
            raise HealthFailure("invalid_provider_response")
    return response.wire()


async def investigate() -> dict:
    """Exactly one paid provider call, through the same Higgins client and validator as normal turns."""
    if not GEMINI_API_KEY:
        raise HealthFailure("provider_not_configured")
    try:
        result = await provider.generate(SYSTEM, [types.Content(role="user", parts=[types.Part(text=PROMPT)])],
                                         json_output=True, capability="json", model=provider.TEXT_MODEL)
    except provider.ProviderFailure as exc:
        code = "provider_timeout" if exc.code in ("timeout", "budget_exhausted") else "provider_unavailable"
        raise HealthFailure(code) from None
    data = coordinator._json_object(result.text)
    if data is None:
        raise HealthFailure("invalid_provider_response")
    return _validate_synthetic(data, provider_complete=result.finish_reason == "STOP")


def fixture(check_id: str) -> dict:
    """Safe, fixed report-shaped fixture; provider-generated words never persist after a run."""
    response = {"overview": "The health check completed using synthetic information.",
                "explanationMarkdown": "Higgins examined a fictional reminder, not an actual device or threat.",
                "assessment": "uncertain", "attention": "none", "scope": "Synthetic health check only.",
                "sourceIds": [], "findings": [], "uncertainties": ["No real device was assessed."], "actions": []}
    return report_store.build_report(response, case_id=f"health-{check_id}", gates=["device"],
                                     revision=1, sources=[], report_id=check_id, health_check=True)


async def report_round_trip(owner: str, check_id: str, response: dict, expires_at: datetime) -> dict:
    """Use production encrypted report code; always delete and confirm absence, even after failure."""
    report_id = str(uuid.uuid4())
    report = report_store.build_report(response, case_id=f"health-{check_id}", gates=["device"],
                                       revision=1, sources=[], report_id=report_id, health_check=True)
    digest = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).digest()
    failure: HealthFailure | None = None
    try:
        try:
            await report_store.write(owner, report, health_check=True, expires_at=expires_at)
        except Exception:
            raise HealthFailure("report_write_failed") from None
        try:
            reopened = await report_store.read(owner, report_id, health_check=True)
            if reopened is None or hashlib.sha256(json.dumps(reopened, sort_keys=True).encode()).digest() != digest:
                raise HealthFailure("report_read_failed")
        except HealthFailure:
            raise
        except Exception:
            raise HealthFailure("report_read_failed") from None
    except HealthFailure as exc:
        failure = exc
    finally:
        try:
            await report_store.delete(owner, report_id, health_check=True)
            if await report_store.read(owner, report_id, health_check=True) is not None:
                raise HealthFailure("cleanup_not_confirmed")
        except Exception:
            failure = HealthFailure("cleanup_not_confirmed")
    if failure:
        raise failure
    return fixture(check_id)