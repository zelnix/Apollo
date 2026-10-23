"""Investigation coordinator for Magnum DI.

The request sent to Gemini contains exactly three things:
  1. the person's question, once;
  2. the complete case evidence, each item labelled with its id and kind;
  3. the required response shape, as Gemini's structured-output schema (`response_schema.py`).

There is no system prompt, no investigation framework, no Higgins instruction and no Apollo
explanation in the request, and no summarised or duplicated representation of evidence Apollo is
already supplying. Google Search stays attached as a tool, which adds no prompt text.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from google.genai import types

from core.db import now_utc
from services.higgins import evidence as ev
from services.higgins import provider
from services.higgins import repository as repo
from services.higgins.contracts import Coverage, ProviderResult, TurnCommit, Usage
from services.higgins.response_schema import response_schema
from services.higgins.tools import grounding_sources
from services.higgins.validation import validate

# Apollo's pre-gathered specialist intelligence (RDAP, Safe Browsing, IPQualityScore, HIBP) is
# evidence collected for this case. It is registered as evidence, verbatim, so it is sent whole and
# can be cited — never summarised into the prompt.
TRIAGE_EVIDENCE_ITEM_ID = "apollo-triage-intelligence"


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
        label="Apollo triage specialist intelligence",
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



class Outcome:
    def __init__(self, kind: str, *, commit: Optional[TurnCommit] = None, request: Optional[dict] = None, case: Optional[dict] = None,
                 errors: Optional[list[str]] = None, provider_text: Optional[str] = None, finish_reason: Optional[str] = None,
                 model: Optional[str] = None, evidence_words: Optional[int] = None):
        self.kind, self.commit, self.request, self.case, self.errors = kind, commit, request, case, errors or []
        # Set only for "evidence_too_large": the real word count, so Higgins can state it.
        self.evidence_words = evidence_words
        # Real provider output kept verbatim for the technical details — never reshaped into a result.
        self.provider_text, self.finish_reason, self.model = provider_text, finish_reason, model


async def run_turn(owner: str, case: dict, job: dict, progress) -> Outcome:
    """One Gemini call: question + complete evidence + response schema, with Google Search attached.

    Flow: register triage intelligence as evidence → send question and evidence → validate the
    schema-shaped response → commit. No autonomous tool rounds, reassessment cycles or repair loops.
    """
    payload = repo.dec_json(job["payload_ciphertext"])
    device = repo.device_profile(case)
    job_model = job.get("provider_model") or provider.TEXT_MODEL
    if not job.get("provider_model"):
        await repo.set_job(owner, job["job_id"], job["fence"], {"$set": {"provider_model": job_model}})

    # ── Step 1: Assemble the request — the question, then the complete evidence ──
    await progress("ingest", "Assembling the case evidence.")
    await _register_triage_evidence(owner, case)
    rows = await repo.list_evidence(owner, case["case_id"])
    evidence_parts, pending_marks, evidence_words = await ev.model_parts(owner, case, rows)

    # Too much written evidence for one investigation. Apollo sends NOTHING rather than quietly
    # shortening, sampling or dropping any of it, and no evidence is marked as examined.
    if evidence_words > ev.EVIDENCE_WORD_LIMIT:
        return Outcome("evidence_too_large", evidence_words=evidence_words,
                       errors=[f"written evidence is {evidence_words} words; Apollo's limit for one investigation is {ev.EVIDENCE_WORD_LIMIT}"])

    contents = [types.Content(role="user", parts=[types.Part(text=payload["message"]), *evidence_parts])]

    # Mark evidence as examined now that it has been sent to Gemini
    for evidence_id, start, end, total in pending_marks:
        await ev.mark_examined(owner, case["case_id"], evidence_id, start, end, total)

    # ── Step 2: Single Gemini call with Google Search grounding ──
    await progress("assess", "Magnum DI is examining the evidence.")
    job_source = job.get("source", "user_initiated")
    search_tool = types.Tool(google_search=types.GoogleSearch())
    # The schema lets Gemini cite only what is registered for this case; Gemini cannot know Apollo's ids.
    source_ids = {s["id"] for s in await repo.sources(owner, case["case_id"])}
    capability_ids = set((device or {}).get("capabilityIds", []))
    # The DI transaction record is device-scoped: tell the gateway who owns this correlation id.
    provider.register_di_owner(f"case-{case['case_id']}", owner)
    # No system prompt: the required response shape is carried by the schema alone.
    result = await provider.generate("", contents, model=job_model, tools=[search_tool],
                                     capability="search", purpose=provider.Purpose.INVESTIGATION,
                                     json_output=True,
                                     response_schema=response_schema(evidence_ids=sorted(row["evidence_id"] for row in rows),
                                                                     source_ids=sorted(source_ids), capability_ids=sorted(capability_ids)),
                                     correlation_id=f"case-{case['case_id']}", trigger_source=job_source)

    # ── Step 3: Parse and validate the response ──
    # Re-read the rows so coverage reflects the examination marks applied above.
    rows = await repo.list_evidence(owner, case["case_id"])
    evidence_ids = {row["evidence_id"] for row in rows}
    gaps = {row["evidence_id"] for row in rows if row["availability"] == "available" and row["origin"] != "apollo_inference"
            and (row["coverage"].get("materialGap") or row["coverage"].get("status") in ("not_started", "partial")) and row["kind"] in ("text", "document", "url", "image", "source_snapshot")}
    revision = (case.get("response_revision") or 0) + 1

    response, errors = None, ["no JSON object in the response"]
    data = _json_object(result.text)
    if data is not None:
        response, errors = validate(data, revision=revision, evidence_ids=evidence_ids, source_ids=source_ids, capability_ids=capability_ids,
                                    pending_question=None, provider_complete=result.finish_reason == "STOP", material_gaps=gaps)

    # An unvalidated answer is NOT an investigation result. Apollo never reshapes raw provider text
    # into findings, an assessment or a completion state — that would manufacture a conclusion Magnum DI
    # never reached. The real reply is passed on verbatim as provider output for the technical details,
    # and the turn fails honestly.
    if response is None:
        return Outcome("invalid", errors=errors, provider_text=result.text, finish_reason=result.finish_reason,
                       model=result.model)

    # ── Step 4: Commit the turn ──
    # Google Search's grounding is Gemini's own record of the web pages behind this answer. They are
    # registered as case sources (search results: leads, not verification) so the case shows them and
    # a follow-up turn can cite them by Apollo's id. Gemini's answer itself is not altered.
    grounded_ids = set((await repo.add_sources(owner, case["case_id"], grounding_sources(result.grounding))).values())
    usage = result.usage or {}
    provider_result = ProviderResult(model=result.model, finish_reason=result.finish_reason, provider_complete=result.finish_reason == "STOP",
                                     usage=Usage(input_tokens=usage.get("prompt_token_count"), output_tokens=usage.get("candidates_token_count"), total_tokens=usage.get("total_token_count")),
                                     source_ids=sorted(set(response.source_ids) | grounded_ids), simulated=result.simulated)
    commit = TurnCommit(turn_id=job["turn_id"], case_id=case["case_id"], input_revision=job["input_revision"], committed_revision=revision, question=payload["message"],
                        answer_to_question_id=payload.get("answerToQuestionId"), response=response, provider=provider_result,
                        evidence_ids=sorted(evidence_ids), source_ids=sorted(source_ids | grounded_ids), committed_at=now_utc())
    commit_id = await repo.stage_turn(owner, commit, job, repo.utc(case["expires_at"]))
    status = {"complete": "complete", "partial": "partial", "waiting_user": "waiting_user"}[response.completion]
    updated = await repo.accept_turn(owner, case, job, commit, commit_id, status, response.attention, response.question.wire() if response.question else None)
    if not updated:
        return Outcome("superseded")
    return Outcome("committed", commit=commit, case=updated)
