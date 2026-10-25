"""TC FlyBy stage 3 — targeted Google Search.

Only checks that the direct sources and Apollo's KB could not settle reach this stage. All of them go in ONE
call to the low-cost Gemini model with Google Search grounding, each as a narrow factual question about an
exact value (a domain, a number, a company, a licence). The model is asked to look things up, never to judge
whether anything is a scam.

Provenance: an answer counts only when Google Search's grounding record ties it to the pages it came from.
An answer with no supporting page is recorded as unsourced and not used. Answers are cached for a week, so
the same lookup is never paid for twice.
"""
from __future__ import annotations

import hashlib
import re
from datetime import timedelta

from google.genai import types

from core.db import db, now_utc
from services import kb_sources
from services.higgins import provider
from services.higgins.llm_boundary import Purpose
from services.higgins.teddy.triage import Check

MAX_QUESTIONS = 6
CACHE_DAYS = 7
LINE_RE = re.compile(r"^\s*Q(\d+)\s*\|\s*([A-Z_]+)\s*\|\s*(.+?)\s*$")
NOT_FOUND = {"NO_WARNING_FOUND", "NO_RECORD_FOUND", "NOT_CONFIRMED"}
QUESTION_LINE = "Q{n} [statuses: {statuses}] [subject: {subject}] {question}"

INSTRUCTION = (
    "TC FlyBy fly-by lookup. Use Google Search to answer each question below with narrow, factual lookups only. "
    "Do not judge whether anything is a scam and do not investigate beyond the question.\n"
    "Reply with exactly one line per question, in this form:\n"
    "Q<number> | <STATUS> | <the fact found, quoting exact names, numbers and dates, and naming the publisher>\n"
    "Use only a STATUS listed for that question. If nothing reliable is found, use its NO_/NOT_ status and say what was searched.\n"
)

_indexed = False


def prompt(checks: list[Check]) -> str:
    lines = [QUESTION_LINE.format(n=n, statuses=", ".join(c.statuses), subject=c.subject[:120], question=c.question)
             for n, c in enumerate(checks, start=1)]
    return INSTRUCTION + "\n" + "\n".join(lines)


def _key(question: str) -> str:
    return hashlib.sha256(" ".join(question.lower().split()).encode()).hexdigest()


async def _ensure_index() -> None:
    global _indexed
    if not _indexed:
        await db.teddy_search_cache.create_index("key", unique=True)
        await db.teddy_search_cache.create_index("expires_at", expireAfterSeconds=0)
        _indexed = True


async def cached(question: str, simulated: bool) -> dict | None:
    await _ensure_index()
    row = await db.teddy_search_cache.find_one({"key": _key(question), "simulated": simulated, "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    return row["answer"] if row else None


async def store(question: str, answer: dict, simulated: bool) -> None:
    await _ensure_index()
    now = now_utc()
    await db.teddy_search_cache.update_one({"key": _key(question)}, {"$set": {
        "answer": answer, "simulated": simulated, "searched_at": now, "expires_at": now + timedelta(days=CACHE_DAYS)}}, upsert=True)


def authority(domain: str) -> tuple[str, str]:
    source = kb_sources.source_for(f"https://{domain}")
    if source and source.tier == kb_sources.TIER_1:
        return "official", f"Search result from {source.publisher}, an official government or regulator source"
    if source:
        return "independent", f"Search result from {source.publisher}"
    return "unknown", "Search result; publisher not independently verified"


def chunk_sources(grounding: dict | None) -> list[dict | None]:
    """Grounding chunks in their original order (supports refer to them by index)."""
    out: list[dict | None] = []
    for chunk in (grounding or {}).get("grounding_chunks") or (grounding or {}).get("groundingChunks") or []:
        web = chunk.get("web") or {}
        if not web.get("uri"):
            out.append(None)
            continue
        domain = (web.get("domain") or web.get("title") or "").lower().removeprefix("www.")
        level, basis = authority(domain)
        out.append({"url": web["uri"], "title": (web.get("title") or domain)[:200], "domain": domain, "authority": level, "basis": basis})
    return out


def line_supports(text: str, grounding: dict | None) -> dict[int, set[int]]:
    """Which grounding chunks support each answer line (segment offsets are UTF-8 byte offsets)."""
    supports = (grounding or {}).get("grounding_supports") or (grounding or {}).get("groundingSupports") or []
    spans: dict[int, tuple[int, int, str]] = {}
    offset = 0
    for raw in (text or "").encode("utf-8").split(b"\n"):
        line = raw.decode("utf-8", errors="replace")
        match = LINE_RE.match(line)
        if match:
            spans[int(match.group(1))] = (offset, offset + len(raw), line)
        offset += len(raw) + 1
    out: dict[int, set[int]] = {}
    for support in supports:
        segment = support.get("segment") or {}
        start = segment.get("start_index", segment.get("startIndex")) or 0
        end = segment.get("end_index", segment.get("endIndex")) or 0
        segment_text = (segment.get("text") or "").strip()
        indices = support.get("grounding_chunk_indices") or support.get("groundingChunkIndices") or []
        for number, (a, b, line) in spans.items():
            if (start < b and end > a) or (segment_text and segment_text in line):
                out.setdefault(number, set()).update(indices)
    return out


def parse(text: str, checks: list[Check], grounding: dict | None) -> dict[str, dict]:
    chunks = chunk_sources(grounding)
    supports = line_supports(text, grounding)
    lines: dict[int, tuple[str, str]] = {}
    for line in (text or "").splitlines():
        match = LINE_RE.match(line)
        if match:
            lines[int(match.group(1))] = (match.group(2), match.group(3))
    answers: dict[str, dict] = {}
    for number, check in enumerate(checks, start=1):
        status, fact = lines.get(number, ("UNANSWERED", ""))
        if status not in check.statuses:
            status = "UNANSWERED"
        sources = [chunks[i] for i in sorted(supports.get(number, ())) if i < len(chunks) and chunks[i]]
        if not sources and len(checks) == 1 and status not in NOT_FOUND:
            sources = [c for c in chunks if c]  # one question: every page behind the answer belongs to it
        if status not in NOT_FOUND and status != "UNANSWERED" and not sources:
            status = "UNSOURCED"
        answers[check.id] = {"status": status, "fact": fact[:600], "sources": sources[:4]}
    return answers


async def run(checks: list[Check], *, correlation_id: str, trigger_source: str | None) -> dict:
    """One grounded lookup call for every open factual question (cache first). Never raises."""
    pending = [c for c in checks if c.question][:MAX_QUESTIONS]
    out = {"answers": {}, "calls": 0, "queries": 0, "cacheHits": 0, "tokens": {"input": 0, "output": 0},
           "simulated": False, "model": None, "status": "skipped"}
    if not pending:
        return out
    simulated = provider.get_provider_mode() == "preview"
    to_ask: list[Check] = []
    for check in pending:
        hit = await cached(check.question, simulated)
        if hit:
            out["answers"][check.id] = {**hit, "cached": True}
            out["cacheHits"] += 1
        else:
            to_ask.append(check)
    if not to_ask:
        out["status"] = "cached"
        return out
    try:
        result = await provider.generate("", [types.Content(role="user", parts=[types.Part(text=prompt(to_ask))])],
                                         model=provider.TEDDY_MODEL, tools=[types.Tool(google_search=types.GoogleSearch())],
                                         capability="search", purpose=Purpose.TEDDY_SEARCH, json_output=False,
                                         correlation_id=correlation_id, trigger_source=trigger_source)
    except Exception as exc:  # noqa: BLE001 — an unavailable lookup is missing evidence, handed on as such
        for check in to_ask:
            out["answers"][check.id] = {"status": "UNAVAILABLE", "fact": "", "sources": [], "reason": type(exc).__name__}
        out["status"] = "unavailable"
        return out
    usage = result.usage or {}
    out.update(calls=1, status="ok", simulated=result.simulated, model=result.model, queries=provider.search_query_count(result.grounding),
               tokens={"input": usage.get("prompt_token_count") or 0, "output": usage.get("candidates_token_count") or 0})
    for check_id, answer in parse(result.text, to_ask, result.grounding).items():
        out["answers"][check_id] = answer
        if answer["status"] not in ("UNANSWERED", "UNSOURCED"):
            await store(next(c.question for c in to_ask if c.id == check_id), answer, result.simulated)
    return out
