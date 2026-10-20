"""The Gemini investigation request contains exactly three things: the person's question, the
complete case evidence (labelled with id and kind), and the response schema. No system prompt, no
framework, no summarised or duplicated representation of evidence Apollo already supplies.

Runs against the preview simulator: the request below is the real one; only the external call is
replaced. Run: cd /app/backend && python -m pytest tests/test_gemini_request_shape.py -q
"""
import uuid

import pytest

from core.db import db
from services.higgins import coordinator
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.preview_simulator import simulated_text
from services.higgins.provider import GeminiResult, Purpose
from services.higgins.response_schema import RESPONSE_SCHEMA

pytestmark = pytest.mark.anyio


async def _progress(*_args):
    return None


async def test_request_is_question_plus_complete_evidence_plus_schema():
    owner = f"req-shape-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "text", None)
    long_text = "Invoice 4471 must be paid to BSB 063-000 today. " * 200  # > the old 2000-char cut
    await ev.ingest_text(owner, case, "item-1", long_text, kind="text", origin="user_submission", label="the message")
    # Apollo's pre-gathered specialist intelligence, stored exactly as triage produced it.
    await db.investigation_cases.update_one(
        {"owner_id": owner, "case_id": case["case_id"]},
        {"$set": {"triage_provider_evidence": {"safe_browsing": {"verdict": "malicious", "threat": "SOCIAL_ENGINEERING"}}}})

    job = await repo.create_job(owner, await repo.get_case(owner, case["case_id"]), str(uuid.uuid4()),
                                repo.digest("ledger"), repo.digest("payload"), "turn", {"message": "Is this invoice a scam?"})

    # The bounded suite forbids provider calls, so the gateway is replaced with the SAME fixed
    # response the preview simulator returns — the request built above is the real one.
    captured: dict = {}
    original = coordinator.provider.generate

    async def capture(system, contents, **kwargs):
        from google.genai import types
        captured["system"], captured["contents"], captured["kwargs"] = system, contents, kwargs
        text = simulated_text(Purpose.INVESTIGATION, True)
        return GeminiResult(text=text, content=types.Content(role="model", parts=[types.Part(text=text)]),
                            finish_reason="STOP", usage={"prompt_token_count": 1, "candidates_token_count": 1,
                                                          "total_token_count": 2}, grounding=None,
                            model=kwargs.get("model") or "gemini-3.8-flash")

    coordinator.provider.generate = capture
    try:
        outcome = await coordinator.run_turn(owner, await repo.get_case(owner, case["case_id"]),
                                             await repo.get_job(owner, case["case_id"], job["job_id"]), _progress)
    finally:
        coordinator.provider.generate = original

    # 1. No system prompt, and the response shape comes from the schema alone.
    assert captured["system"] == ""
    assert captured["kwargs"]["response_schema"] is RESPONSE_SCHEMA
    assert captured["kwargs"]["json_output"] is True
    # Google Search stays attached (a tool, not prompt text).
    assert captured["kwargs"]["tools"]

    parts = captured["contents"][0].parts
    texts = [p.text for p in parts if getattr(p, "text", None)]

    # 2. The question is sent once, first.
    assert parts[0].text == "Is this invoice a scam?"
    assert sum(1 for t in texts if t == "Is this invoice a scam?") == 1

    # 3. Evidence follows, each item labelled with its id and kind, and nothing else.
    evidence_texts = texts[1:]
    assert evidence_texts, "the evidence was not sent"
    assert all(t.startswith("[evidence ") for t in evidence_texts)
    assert not any("INVESTIGATION BRIEF" in t or "evidenceInventory" in t for t in texts)
    assert not any("previousTurns" in t or "deviceProfile" in t for t in texts)

    # 4. Evidence is complete — the full text, not a 2000-character slice or a summary.
    message_part = next(t for t in evidence_texts if "Invoice 4471" in t)
    assert long_text in message_part
    assert "only the first 2000" not in message_part

    # 5. Pre-gathered triage intelligence is sent raw, as evidence, not summarised into the prompt.
    assert any("safe_browsing" in t and "SOCIAL_ENGINEERING" in t for t in evidence_texts)

    # 6. The schema-shaped response passes the real validator and is staged as a turn.
    #    (This job was never claimed by the worker, so the final case CAS reports "superseded";
    #     what matters here is that validation produced no errors and nothing was reshaped.)
    assert outcome.kind != "invalid", outcome.errors
    assert outcome.errors == []


async def test_evidence_appears_once_per_item():
    owner = f"req-once-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "text", None)
    await ev.ingest_text(owner, case, "item-1", "https://commbank-cancel.co/stop", kind="url", label="the link")
    rows = await repo.list_evidence(owner, case["case_id"])
    parts, _marks = await ev.model_parts(owner, await repo.get_case(owner, case["case_id"]), rows)
    ids = [row["evidence_id"] for row in rows]
    for evidence_id in ids:
        mentions = sum(1 for p in parts if getattr(p, "text", None) and evidence_id in p.text)
        assert mentions == 1, f"evidence {evidence_id} was sent {mentions} times"
