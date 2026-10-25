"""Investigation coordinator: Higgins Triage → TC FlyBy → Magnum DI.

On the first turn of a case, Higgins Triage decides what needs checking and TC FlyBy runs those checks the
cheapest reliable way (official sources → Apollo KB → one targeted, low-cost Google Search call). When TC FlyBy
reliably settles the case, its result is committed and Magnum DI is not called at all.

Otherwise Magnum DI makes its call with the existing configured model. The request contains exactly three
things:
  1. the person's question, once;
  2. the case evidence Magnum DI needs — the submitted material itself plus TC FlyBy's brief of what is
     still unresolved — each item labelled with its id and kind (raw lookups TC FlyBy already settled are not
     resent);
  3. the required response shape, as Gemini's structured-output schema (`response_schema.py`).
There is no system prompt. Google Search is attached only when a specific external fact is still missing.

MAGNUM DI MAKES ONE CALL. There are no tool rounds, no nested research calls, no model escalation, no Pro
fallback and no second call to present the answer: Higgins shows what this one call returned. The only
exception is a single retry after a failed call (`MAX_GEMINI_CALLS`), enforced atomically on the job record.
Follow-up turns go straight to Magnum DI with the complete case evidence.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from google.genai import types

from core.db import db, now_utc
from services.higgins import evidence as ev
from services.higgins import explain
from services.higgins import provider
from services.higgins import repository as repo
from services.higgins import teddy
from services.higgins.contracts import Coverage, HigginsResponse, ProviderResult, TurnCommit, Usage
from services.higgins.response_schema import response_schema
from services.higgins.tools import grounding_sources
from services.higgins.validation import validate

log = logging.getLogger("apollo.coordinator")

# Apollo's pre-gathered specialist intelligence (RDAP, Safe Browsing, IPQualityScore, HIBP) is
# evidence collected for this case. It is registered as evidence, verbatim, so it can be cited.
TRIAGE_EVIDENCE_ITEM_ID = teddy.PREGATHERED_ITEM_ID

# Magnum DI's one Gemini call, plus at most one retry if that call fails.
MAX_GEMINI_CALLS = 2


async def _register_triage_evidence(owner: str, case: dict) -> None:
    """Store the raw triage provider results as a case evidence item, once."""
    pre_gathered = case.get("triage_provider_evidence")
    # An empty envelope (no provider consulted, no lookups) is bookkeeping, not intelligence.
    if not pre_gathered or not ev.has_intelligence(pre_gathered):
        return
    existing = await repo.list_evidence(owner, case["case_id"])
    if any(row.get("client_item_id") == TRIAGE_EVIDENCE_ITEM_ID for row in existing):
        return
    text = json.dumps(pre_gathered, ensure_ascii=False, sort_keys=True, default=str)
    await ev.ingest_text(
        owner, case, TRIAGE_EVIDENCE_ITEM_ID, text,
        kind="observation", origin="apollo_inference",
        label="Higgins triage specialist intelligence",
        meta={"source": "apollo_triage"},
        coverage=Coverage(status="examined", unit="items", total=1, examined=1),
    )


def _json_object(text: str) -> Optional[dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else None
    except ValueError:
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                value = json.loads(match.group(0))
                return value if isinstance(value, dict) else None
            except ValueError:
                return None
    return None


def _material_gaps(rows: list[dict]) -> set[str]:
    return {row["evidence_id"] for row in rows if row["availability"] == "available" and row["origin"] != "apollo_inference"
            and (row["coverage"].get("materialGap") or row["coverage"].get("status") in ("not_started", "partial"))
            and row["kind"] in ("text", "document", "url", "image", "source_snapshot")}


class Outcome:
    def __init__(self, kind: str, *, commit: Optional[TurnCommit] = None, request: Optional[dict] = None, case: Optional[dict] = None,
                 errors: Optional[list[str]] = None, provider_text: Optional[str] = None, finish_reason: Optional[str] = None,
                 model: Optional[str] = None, evidence_words: Optional[int] = None):
        self.kind, self.commit, self.request, self.case, self.errors = kind, commit, request, case, errors or []
        # Set only for "evidence_too_large": the real word count, so Higgins can state it.
        self.evidence_words = evidence_words
        # Real provider output kept verbatim for the technical details — never reshaped into a result.
        self.provider_text, self.finish_reason, self.model = provider_text, finish_reason, model


async def _plain_english(owner: str, case: dict, response: HigginsResponse, answered_by: str) -> tuple[HigginsResponse, Optional[dict]]:
    """Higgins' plain English for the validated result, after its Fidelity Check (services/higgins/explain). It sits
    beside the result and changes nothing in it. A renderer error never fails the investigation: the person then sees
    Apollo's own wording."""
    by = explain.facts_mod.investigator(answered_by)
    try:
        doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0, "routing": 1}) or {}
        plain = explain.explain(response, answered_by=answered_by, routing=doc.get("routing") or {},
                                sources=await repo.sources(owner, case["case_id"]))
    except Exception as exc:  # noqa: BLE001 — presentation only; never logs case content
        log.warning("plain_english_renderer_error case=%s error=%s", case["case_id"], type(exc).__name__)
        return response, explain.renderer_error(by=by, revision=response.revision)
    return response.model_copy(update={"plain_english": plain}), explain.summary(plain, by=by, revision=response.revision)


async def _commit(owner: str, case: dict, job: dict, payload: dict, response: HigginsResponse, provider_result: ProviderResult,
                  evidence_ids: set[str], source_ids: set[str]) -> Outcome:
    response, fidelity = await _plain_english(owner, case, response, provider_result.answered_by)
    commit = TurnCommit(turn_id=job["turn_id"], case_id=case["case_id"], input_revision=job["input_revision"], committed_revision=response.revision,
                        question=payload["message"], answer_to_question_id=payload.get("answerToQuestionId"), response=response, provider=provider_result,
                        evidence_ids=sorted(evidence_ids), source_ids=sorted(source_ids), committed_at=now_utc())
    commit_id = await repo.stage_turn(owner, commit, job, repo.utc(case["expires_at"]))
    status = {"complete": "complete", "partial": "partial", "waiting_user": "waiting_user"}[response.completion]
    updated = await repo.accept_turn(owner, case, job, commit, commit_id, status, response.attention, response.question.wire() if response.question else None)
    if not updated:
        return Outcome("superseded")
    if response.revision == 1:
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case["case_id"]}, {"$set": {
            "routing.answeredBy": provider_result.answered_by, "routing.assessment": response.assessment,
            "routing.completion": response.completion, "routing.answeredAt": now_utc()}})
    if response.outcome:
        # Apollo's case outcome — the latest one, from whichever layer answered.
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case["case_id"]}, {"$set": {"routing.outcome": response.outcome}})
    if fidelity:
        # The Fidelity Check of the latest result's plain English, for the admin portal: PASS/FAIL and why, no content.
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case["case_id"]},
                                                {"$set": {"routing.fidelity": {**fidelity, "at": now_utc()}}})
    return Outcome("committed", commit=commit, case=updated)


async def _commit_teddy(owner: str, case: dict, job: dict, payload: dict, fly_by: teddy.TeddyOutcome,
                        capability_ids: set[str]) -> Optional[Outcome]:
    """TC FlyBy settled the case: its result passes the same validation as Magnum DI's, then commits.
    None when it doesn't validate — Magnum DI then takes the case."""
    rows = await repo.list_evidence(owner, case["case_id"])
    evidence_ids = {row["evidence_id"] for row in rows}
    source_ids = {s["id"] for s in await repo.sources(owner, case["case_id"])}
    response, errors = validate(fly_by.response, revision=(case.get("response_revision") or 0) + 1, evidence_ids=evidence_ids,
                                source_ids=source_ids, capability_ids=capability_ids, pending_question=None, provider_complete=True,
                                material_gaps=_material_gaps(rows))
    if response is None:
        log.warning("teddy_result_invalid case=%s errors=%s", case["case_id"], "; ".join(errors)[:300])
        return None
    provider_result = ProviderResult(provider="apollo", model="teddy-flyby" + (f" + {fly_by.model}" if fly_by.model else ""), api_version="",
                                     finish_reason="STOP", provider_complete=True, usage=Usage(**fly_by.usage),
                                     source_ids=sorted(response.source_ids), simulated=fly_by.simulated, answered_by=fly_by.answered_by)
    return await _commit(owner, case, job, payload, response, provider_result, evidence_ids, source_ids)


async def run_turn(owner: str, case: dict, job: dict, progress) -> Outcome:
    """First turn: Higgins Triage → TC FlyBy → (only if needed) Magnum DI's one call. Follow-ups: Magnum DI.

    Magnum DI flow: claim the call slot → send question and evidence → validate the schema-shaped response
    → commit. No autonomous tool rounds, reassessment cycles or repair loops; a retry is the caller's
    (jobs.py) single decision and claims its own slot.
    """
    payload = repo.dec_json(job["payload_ciphertext"])
    device = repo.device_profile(case)
    capability_ids = set((device or {}).get("capabilityIds", []))
    job_model = job.get("provider_model") or provider.TEXT_MODEL
    if not job.get("provider_model"):
        await repo.set_job(owner, job["job_id"], job["fence"], {"$set": {"provider_model": job_model}})

    # ── Step 1: Assemble the case evidence ──
    await progress("ingest", "Assembling the case evidence.")
    await _register_triage_evidence(owner, case)
    rows = await repo.list_evidence(owner, case["case_id"])
    first_turn = not case.get("response_revision") and not payload.get("answerToQuestionId")
    search_on = True

    # Too much written evidence for one investigation. Apollo sends NOTHING rather than quietly
    # shortening, sampling or dropping any of it, and no evidence is marked as examined — so this is
    # decided before TC FlyBy reads anything.
    _parts, _marks, evidence_words = await ev.model_parts(owner, case, rows)
    if evidence_words > ev.EVIDENCE_WORD_LIMIT:
        return Outcome("evidence_too_large", evidence_words=evidence_words,
                       errors=[f"written evidence is {evidence_words} words; Apollo's limit for one investigation is {ev.EVIDENCE_WORD_LIMIT}"])

    # ── Step 2: Higgins Triage → TC FlyBy (first turn only) ──
    if first_turn:
        fly_by = await teddy.investigate(owner, case, job, payload["message"], rows, progress)
        if fly_by.resolved:
            committed = await _commit_teddy(owner, case, job, payload, fly_by, capability_ids)
            if committed is not None:
                return committed
            await teddy.discard_response(owner, case)
            fly_by = await teddy.investigate(owner, case, job, payload["message"], rows, progress)
        rows, search_on = fly_by.rows, fly_by.magnum_search
        evidence_parts, pending_marks, evidence_words = await ev.model_parts(owner, case, rows)
    else:
        evidence_parts, pending_marks = _parts, _marks

    contents = [types.Content(role="user", parts=[types.Part(text=payload["message"]), *evidence_parts])]

    # Take a Gemini call slot before anything is sent. Refused = both attempts are already used:
    # nothing is sent and the person is asked to resubmit later.
    if await repo.claim_gemini_call(owner, job["job_id"], MAX_GEMINI_CALLS) is None:
        return Outcome("call_limit_reached", errors=[f"this investigation already made {MAX_GEMINI_CALLS} AI calls"])

    # Mark evidence as examined now that it has been sent to Gemini
    for evidence_id, start, end, total in pending_marks:
        await ev.mark_examined(owner, case["case_id"], evidence_id, start, end, total)

    # ── Step 3: Magnum DI's single Gemini call ──
    await progress("assess", "Magnum DI is examining what needs deeper analysis." if first_turn else "Magnum DI is examining the evidence.")
    job_source = job.get("source", "user_initiated")
    tools = [types.Tool(google_search=types.GoogleSearch())] if search_on else None
    # The schema lets Gemini cite only what is registered for this case; Gemini cannot know Apollo's ids.
    source_ids = {s["id"] for s in await repo.sources(owner, case["case_id"])}
    # The DI transaction record is device-scoped: tell the gateway who owns this correlation id.
    provider.register_di_owner(f"case-{case['case_id']}", owner)
    # No system prompt: the required response shape is carried by the schema alone.
    result = await provider.generate("", contents, model=job_model, tools=tools,
                                     capability="search" if search_on else "json", purpose=provider.Purpose.INVESTIGATION,
                                     json_output=True,
                                     response_schema=response_schema(evidence_ids=sorted(row["evidence_id"] for row in rows),
                                                                     source_ids=sorted(source_ids), capability_ids=sorted(capability_ids)),
                                     correlation_id=f"case-{case['case_id']}", trigger_source=job_source)
    if first_turn:
        usage = result.usage or {}
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case["case_id"]}, {"$set": {"routing.magnum": {
            "search": search_on, "searchQueries": provider.search_query_count(result.grounding) if search_on else 0,
            "itemsSent": len(rows), "inputTokens": usage.get("prompt_token_count"), "outputTokens": usage.get("candidates_token_count"),
            "simulated": result.simulated, "at": now_utc()}}})

    # ── Step 4: Parse and validate the response ──
    # Re-read the rows so coverage reflects the examination marks applied above.
    all_rows = await repo.list_evidence(owner, case["case_id"])
    evidence_ids = {row["evidence_id"] for row in all_rows}
    revision = (case.get("response_revision") or 0) + 1

    response, errors = None, ["no JSON object in the response"]
    data = _json_object(result.text)
    if data is not None:
        response, errors = validate(data, revision=revision, evidence_ids=evidence_ids, source_ids=source_ids, capability_ids=capability_ids,
                                    pending_question=None, provider_complete=result.finish_reason == "STOP", material_gaps=_material_gaps(all_rows))

    # An unvalidated answer is NOT an investigation result. Apollo never reshapes raw provider text
    # into findings, an assessment or a completion state — that would manufacture a conclusion Magnum DI
    # never reached. The real reply is passed on verbatim as provider output for the technical details,
    # and the turn fails honestly.
    if response is None:
        return Outcome("invalid", errors=errors, provider_text=result.text, finish_reason=result.finish_reason,
                       model=result.model)

    # ── Step 5: Commit the turn ──
    # Google Search's grounding is Gemini's own record of the web pages behind this answer. They are
    # registered as case sources (search results: leads, not verification) so the case shows them and
    # a follow-up turn can cite them by Apollo's id. Gemini's answer itself is not altered.
    grounded_ids = set((await repo.add_sources(owner, case["case_id"], grounding_sources(result.grounding))).values())
    usage = result.usage or {}
    provider_result = ProviderResult(model=result.model, finish_reason=result.finish_reason, provider_complete=result.finish_reason == "STOP",
                                     usage=Usage(input_tokens=usage.get("prompt_token_count"), output_tokens=usage.get("candidates_token_count"), total_tokens=usage.get("total_token_count")),
                                     source_ids=sorted(set(response.source_ids) | grounded_ids), simulated=result.simulated)
    return await _commit(owner, case, job, payload, response, provider_result, evidence_ids, source_ids | grounded_ids)
