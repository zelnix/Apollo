"""ApolloSG Settings → "Test this model": one safe sample check of a provider and model before an admin saves it.

The check is ONE call through the AI gateway (provider.generate), shaped exactly like a Magnum DI call: the same
fixed answer shape (response_schema) and web search attached. The evidence is a fixed, made-up sample message on a
reserved .invalid address — never anyone's data — so nothing personal leaves the server.

Nothing is sent when the model can't be used (not approved, provider not connected, no API key on the server): the
admin is told why. A pass is remembered (db `apollo_settings`, setting `ai_model_test`) and saving a different model
needs a pass of that exact provider and model within PASS_VALID_FOR. In the preview the simulator stands in for the
provider, as it does for every AI call there, and the result is tagged simulated.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import timedelta, timezone

from pydantic import ValidationError

from core.db import db, now_utc
from services.higgins import ai_settings, provider
from services.higgins.ai_request import Message, Part, ProviderFailure
from services.higgins.contracts import ModelResponse
from services.higgins.llm_boundary import Purpose
from services.higgins.response_schema import response_schema

SETTING = "ai_model_test"
PASS_VALID_FOR = timedelta(hours=1)
SAMPLE_ID = "model-test-sample"
SAMPLE_QUESTION = "Is this text message safe to act on?"
SAMPLE_MESSAGE = ("AusPost: Your parcel is on hold because of an unpaid $2.99 redelivery fee. "
                  "Pay within 24 hours at https://auspost-redelivery.example.invalid/pay or it will be returned.")
_running = asyncio.Lock()


def _check(label: str, ok: bool, detail: str = "") -> dict:
    return {"label": label, "ok": ok, "detail": detail}


async def run(provider_id: str, model: str) -> dict:
    """{ok, simulated, provider, model, message, checks, durationMs}. Never raises."""
    name = ai_settings.label(provider_id)
    out = {"ok": False, "simulated": False, "provider": provider_id, "model": model, "checks": [], "durationMs": 0}
    reasons = ai_settings.unavailable(provider_id, model)
    if reasons:
        no_key = f"no {name} API key is set on the server" in reasons
        out["checks"].append(_check("Ready to use", False, "; ".join(reasons)))
        out["message"] = (f"No {name} API key is set on the server. Add it in the server's secure settings, then test again. "
                          f"Nothing was sent." if no_key and len(reasons) == 1
                          else f"{model or 'That model'} can't be used — {'; '.join(reasons)}. Nothing was sent.")
        return out
    out["checks"].append(_check("Ready to use", True, f"Approved, {name} connected, API key set"))
    if _running.locked():
        out["message"] = "Another model test is running. Try again when it finishes."
        return out
    async with _running:
        started = time.monotonic()
        contents = [Message("user", [Part(text=SAMPLE_QUESTION),
                                     Part(text=f"[evidence {SAMPLE_ID} · kind=text]\n{SAMPLE_MESSAGE}")])]
        try:
            result = await provider.generate("", contents, model=model, capability="search", web_search=True, json_output=True,
                                             response_schema=response_schema(evidence_ids=[SAMPLE_ID]),
                                             purpose=Purpose.INVESTIGATION, correlation_id=f"model-test-{uuid.uuid4().hex[:12]}",
                                             trigger_source="model_test")
        except ProviderFailure as exc:
            out["durationMs"] = int((time.monotonic() - started) * 1000)
            status = f" (HTTP {exc.http_status})" if exc.http_status else ""
            out["checks"].append(_check("Answered", False, f"{exc.code}{status}" + (f": {exc.original_message}" if exc.original_message else "")))
            out["message"] = f"{name} didn't answer the sample check: {exc.code}{status}."
            return out
        out["durationMs"] = int((time.monotonic() - started) * 1000)
    out["simulated"] = result.simulated
    complete = result.finish_reason == "STOP"
    out["checks"].append(_check("Answered", complete, f"finish reason {result.finish_reason}"))
    searches = provider.search_query_count(result.grounding)
    out["checks"].append(_check("Accepted web search", True, f"{searches} search{'es' if searches != 1 else ''} run"))
    try:
        ModelResponse.model_validate(result.object())
        out["checks"].append(_check("Fixed answer shape", True, "The answer matches ApolloSG's investigation answer shape"))
        shaped = True
    except (ProviderFailure, ValidationError) as exc:
        detail = "; ".join(f"{e['loc']} {e['msg']}" for e in exc.errors()[:3]) if isinstance(exc, ValidationError) else "not a JSON object"
        out["checks"].append(_check("Fixed answer shape", False, detail))
        shaped = False
    out["ok"] = complete and shaped
    seconds = out["durationMs"] / 1000
    out["message"] = (f"Passed: {model} answered the sample check in ApolloSG's fixed answer shape ({seconds:.1f}s)."
                      if out["ok"] else f"Failed: {model} didn't return a complete answer in ApolloSG's fixed answer shape.")
    if out["ok"]:
        await db[ai_settings.COLLECTION].update_one({"setting": SETTING}, {"$set": {
            "provider": provider_id, "model": model, "simulated": result.simulated, "at": now_utc()}}, upsert=True)
    return out


async def passed_recently(provider_id: str, model: str) -> bool:
    doc = await db[ai_settings.COLLECTION].find_one({"setting": SETTING}, {"_id": 0})
    if not doc or (doc.get("provider"), doc.get("model")) != (provider_id, model):
        return False
    at = doc["at"] if doc["at"].tzinfo else doc["at"].replace(tzinfo=timezone.utc)
    return now_utc() - at <= PASS_VALID_FOR
