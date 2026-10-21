"""A URL (item-counted) evidence row is examined by being sent — so an investigation can complete.

Regression. `model_parts` recorded an examination mark only for CHARACTER-counted evidence, so the
`URL from message` item every message/email check registers stayed `not_started` for ever. The
coordinator then reported it as unexamined material content and Apollo's own validator rejected
every answer that said `completion: "complete"` — the investigation failed with `response_invalid`
no matter what Gemini returned.

Run: cd /app/backend && python -m pytest tests/test_url_evidence_examined.py -q
"""
import uuid

import pytest

from services.higgins import coordinator
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.preview_simulator import simulated_text
from services.higgins.provider import GeminiResult, Purpose

pytestmark = pytest.mark.anyio


async def _progress(*_args):
    return None


async def test_sent_url_evidence_is_marked_examined():
    owner = f"url-cov-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "text", None)
    await ev.ingest_url(owner, case, "message-url-0", "https://commbank-secure-verify.co/login",
                        label="URL from message")
    rows = await repo.list_evidence(owner, case["case_id"])
    url_row = next(r for r in rows if r["client_item_id"] == "message-url-0")
    assert url_row["coverage"]["unit"] == "items"

    parts, marks, _words = await ev.model_parts(owner, case, rows)
    assert any(url_row["evidence_id"] in p.text for p in parts if getattr(p, "text", None)), "the URL was not sent"
    assert any(mark[0] == url_row["evidence_id"] for mark in marks), "sending the URL recorded no examination"

    for evidence_id, start, end, total in marks:
        await ev.mark_examined(owner, case["case_id"], evidence_id, start, end, total)

    after = await repo.get_evidence(owner, case["case_id"], url_row["evidence_id"])
    assert after["coverage"]["status"] == "examined"
    assert after["coverage"]["materialGap"] is False


async def test_investigation_with_a_url_item_can_complete():
    """The exact shape of a message check: the message text plus the URL taken out of it."""
    owner = f"url-turn-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "text", None)
    await ev.ingest_text(owner, case, "message-text",
                         "CommBank: unusual activity. Confirm at https://commbank-secure-verify.co/login",
                         kind="text", origin="user_submission", label="Submitted message text")
    await ev.ingest_url(owner, case, "message-url-0", "https://commbank-secure-verify.co/login",
                        label="URL from message")
    job = await repo.create_job(owner, await repo.get_case(owner, case["case_id"]), str(uuid.uuid4()),
                                repo.digest("ledger"), repo.digest("payload"), "turn",
                                {"message": "Is this message real?"})

    original = coordinator.provider.generate

    async def answer(system, contents, **kwargs):
        from google.genai import types
        from services.higgins.preview_simulator import evidence_blocks
        text = simulated_text(Purpose.INVESTIGATION, True, evidence_blocks(contents))
        return GeminiResult(text=text, content=types.Content(role="model", parts=[types.Part(text=text)]),
                            finish_reason="STOP", usage={"prompt_token_count": 1, "candidates_token_count": 1,
                                                         "total_token_count": 2}, grounding=None,
                            model=kwargs.get("model") or "gemini-3.1-flash-lite")

    coordinator.provider.generate = answer
    try:
        outcome = await coordinator.run_turn(owner, await repo.get_case(owner, case["case_id"]),
                                             await repo.get_job(owner, case["case_id"], job["job_id"]), _progress)
    finally:
        coordinator.provider.generate = original

    assert outcome.kind != "invalid", outcome.errors
    assert not any("unexamined material content" in e for e in outcome.errors)
