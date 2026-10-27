"""One investigation = one Gemini call.

Every test drives the real durable job (`jobs.run`) with the gateway replaced, and counts the calls:
- a successful investigation makes exactly ONE call — no tool rounds, no nested research, no second
  "presentation" call;
- a failed call is retried exactly ONCE, then the person is asked to resubmit in about 5 minutes;
- a configuration failure is never retried;
- a job whose two call slots are used can make no further call (crash recovery, duplicate worker);
- resubmitting is refused until the pause is over, then starts one fresh call + one retry.

Run: cd /app/backend && python -m pytest tests/test_one_gemini_call.py -q -n 0
"""
import json
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from core.db import db, now_utc
from services.higgins import coordinator, jobs, provider
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.preview.preview_simulator import evidence_blocks, simulated_text
from services.higgins.provider import AIResult, ProviderFailure, Purpose


@pytest.fixture(autouse=True)
def _fast_retry(monkeypatch):
    monkeypatch.setattr(jobs, "RETRY_DELAY_SECONDS", 0)
    monkeypatch.setattr(jobs.random, "uniform", lambda _a, _b: 0.01)


def _gateway(monkeypatch, *script):
    """Replace the Gemini gateway. Each call consumes the next scripted step: "ok", "invalid" or a ProviderFailure."""
    calls: list[dict] = []

    async def fake(system, contents, **kwargs):
        calls.append({"system": system, "kwargs": kwargs})
        step = script[min(len(calls), len(script)) - 1]
        if isinstance(step, ProviderFailure):
            raise step
        text = "not json at all" if step == "invalid" else simulated_text(Purpose.INVESTIGATION, True, evidence_blocks(contents))
        return AIResult(text=text, finish_reason="STOP",
                            usage={"prompt_token_count": 1, "candidates_token_count": 1, "total_token_count": 2}, grounding=None,
                            model=kwargs.get("model") or "gemini-3.1-flash-lite")

    monkeypatch.setattr(provider, "generate", fake)
    return calls


async def _investigation(gemini_calls: int = 0):
    owner = f"one-call-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    # A request to send money to new bank details that nothing TC FlyBy established settles: Magnum DI's
    # analysis could change what to do, so it reaches Magnum DI's one call.
    await ev.ingest_text(owner, case, "message-text", "Hi, it's Sarah from accounts. Our bank details have changed, so please pay invoice 4471 "
                         "($1,240) to BSB 062-000 account 1234 5678 today.", kind="text", origin="user_submission", label="Submitted message text")
    case = await repo.get_case(owner, case["case_id"])
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest(turn_id), repo.digest("p"), "turn", {"message": "Is this real?", "turnId": turn_id})
    if gemini_calls:
        await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"gemini_calls": gemini_calls}})
    await repo.cas(owner, case["case_id"], {"revision": case["revision"]}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "queued"}})
    return owner, case["case_id"], job["job_id"]


async def _event_types(owner: str, job_id: str) -> list[str]:
    return [e["type"] for e in await repo.events_after(owner, job_id, 0)]


async def test_successful_investigation_makes_exactly_one_call(monkeypatch):
    calls = _gateway(monkeypatch, "ok")
    owner, case_id, job_id = await _investigation()
    await jobs.run(owner, case_id, job_id)
    assert len(calls) == 1
    assert calls[0]["kwargs"]["purpose"] == Purpose.INVESTIGATION
    job = await repo.get_job(owner, case_id, job_id)
    assert job["status"] in ("complete", "partial", "waiting_user") and job["gemini_calls"] == 1
    assert "completed" in await _event_types(owner, job_id)


async def test_a_failed_call_is_retried_exactly_once_then_succeeds(monkeypatch):
    calls = _gateway(monkeypatch, ProviderFailure("provider_unavailable", retryable=True), "ok")
    owner, case_id, job_id = await _investigation()
    await jobs.run(owner, case_id, job_id)
    assert len(calls) == 2
    kinds = await _event_types(owner, job_id)
    assert kinds.count("retry_scheduled") == 1 and "completed" in kinds


@pytest.mark.parametrize("second", ["provider", "invalid"])
async def test_two_failures_stop_and_ask_to_resubmit_in_five_minutes(monkeypatch, second):
    failure = ProviderFailure("rate_limited", retryable=True)
    calls = _gateway(monkeypatch, failure, failure if second == "provider" else "invalid", "ok", "ok")
    owner, case_id, job_id = await _investigation()
    before = now_utc()
    await jobs.run(owner, case_id, job_id)
    assert len(calls) == 2, "only one retry is allowed"
    job = await repo.get_job(owner, case_id, job_id)
    assert job["status"] == "failed" and job["gemini_calls"] == 2
    failure_wire = job["failure"]
    assert failure_wire["code"] == ("rate_limited" if second == "provider" else "response_invalid")
    assert failure_wire["retryable"] is True and failure_wire["retryAfterSeconds"] == 300
    assert "tried twice" in failure_wire["message"] and "resubmit in about 5 minutes" in failure_wire["message"]
    assert "No conclusion has been made up" in failure_wire["message"]
    pause = (repo.utc(job["resubmit_at"]) - before).total_seconds()
    assert 295 <= pause <= 310
    kinds = await _event_types(owner, job_id)
    assert kinds.count("retry_scheduled") == 1 and kinds[-1] == "failed"


async def test_configuration_failure_is_never_retried(monkeypatch):
    calls = _gateway(monkeypatch, ProviderFailure("provider_configuration", http_status=403), "ok")
    owner, case_id, job_id = await _investigation()
    await jobs.run(owner, case_id, job_id)
    assert len(calls) == 1
    job = await repo.get_job(owner, case_id, job_id)
    assert job["failure"]["code"] == "provider_configuration" and job["failure"]["retryable"] is False
    assert "retry_scheduled" not in await _event_types(owner, job_id)


async def test_used_call_slots_block_any_further_call(monkeypatch):
    """A relaunched job (crash recovery, duplicate worker) cannot exceed one call + one retry."""
    calls = _gateway(monkeypatch, "ok")
    owner, case_id, job_id = await _investigation(gemini_calls=coordinator.MAX_GEMINI_CALLS)
    await jobs.run(owner, case_id, job_id)
    assert calls == []
    job = await repo.get_job(owner, case_id, job_id)
    assert job["status"] == "failed" and "resubmit in about 5 minutes" in job["failure"]["message"]


async def test_call_slot_claim_is_atomic():
    owner, case_id, job_id = await _investigation()
    claims = [await repo.claim_gemini_call(owner, job_id, coordinator.MAX_GEMINI_CALLS) for _ in range(4)]
    assert claims == [1, 2, None, None]


def _request(owner: str) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.device = {"device_id": owner}
    return request


async def test_resubmit_waits_for_the_pause_then_starts_a_fresh_attempt(monkeypatch):
    from routers import investigations as inv
    from services.higgins.contracts import ExpectedRevision
    failure = ProviderFailure("provider_unavailable", retryable=True)
    _gateway(monkeypatch, failure, failure)
    owner, case_id, job_id = await _investigation()
    await jobs.run(owner, case_id, job_id)
    launched: list[str] = []
    monkeypatch.setattr(inv.jobs, "launch", lambda _o, _c, j: launched.append(j))

    case = await repo.get_case(owner, case_id)
    with pytest.raises(HTTPException) as early:
        await inv.resume_job(case_id, job_id, ExpectedRevision(expected_revision=case["revision"]), _request(owner), str(uuid.uuid4()))
    assert early.value.status_code == 429
    assert "resubmit in about 5 minutes" in early.value.detail["error"]["message"]
    assert launched == []

    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job_id}, {"$set": {"resubmit_at": now_utc() - timedelta(seconds=1)}})
    response = await inv.resume_job(case_id, job_id, ExpectedRevision(expected_revision=case["revision"]), _request(owner), str(uuid.uuid4()))
    assert response.status_code == 202 and launched == [job_id]
    job = await repo.get_job(owner, case_id, job_id)
    assert job["status"] == "queued" and job["gemini_calls"] == 0 and job["resubmit_at"] is None
    assert job["retry_history"][-1]["kind"] == "manual_retry"
    assert json.loads(response.body)["job"]["status"] == "queued"


async def test_settings_plan_makes_no_gemini_call(monkeypatch):
    from routers import investigations as inv
    from services.higgins.contracts import DeviceProfile, SettingsPlanRequest
    calls = _gateway(monkeypatch, "ok")
    owner, case_id, _job_id = await _investigation()
    case = await repo.get_case(owner, case_id)
    device = DeviceProfile(platform="android", manufacturer="Example", model="Phone", os_version="14", form_factor="phone", locale="en-AU",
                           evidence_origin="native", capability_ids=[])
    body = SettingsPlanRequest(expected_revision=case["revision"], target="Turn on Play Protect. Open Settings, then Security.", device=device,
                               capability_id=None, expected_field="state", expected_value=None)
    response = json.loads((await inv.settings_plan(case_id, body, _request(owner))).body)
    assert calls == []
    assert response["plan"]["instructions"] == ["Turn on Play Protect.", "Open Settings, then Security."]


def test_investigation_code_has_no_other_gemini_call_path():
    import inspect
    from services.higgins import tools
    assert "provider" not in inspect.getsource(tools), "observation tools must not reach the Gemini gateway"
    assert inspect.getsource(coordinator).count("provider.generate(") == 1
    from routers import analysis
    source = inspect.getsource(analysis.vision_investigate)
    assert "generate_json" not in source and "generate(" not in source, "the Vision Gate must not pre-analyse with Gemini"
