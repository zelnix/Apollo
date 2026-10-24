"""Teddy DI — Apollo's fast, low-cost fly-by investigation.

    Input → Apollo Triage → only the relevant checks → for each check:
        1. direct / authoritative source (official.py)
        2. Apollo Knowledge Base — including the established scam patterns (patterns.py)
        3. targeted Google Search — one call, low-cost model (search.py)
    → an Apollo case outcome (outcomes.py) when further investigation couldn't change the finding or what
      Higgins tells the person, or hand Magnum DI only what Teddy could not settle.

Teddy never pays Gemini to confirm what a reliable source has already established, and Magnum DI never
rediscovers what Teddy found: it receives a short brief of the unresolved issues and the facts that bear on
them, with Google Search left off unless a specific external fact is still missing.

Evidence integrity: live evidence (facts about this case, each with its source), Apollo knowledge (general
context, never a finding) and AI reasoning (Magnum DI's inferences) are kept apart throughout. Anything a
lookup did not find stays missing.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field

from core.db import db, now_utc
from services import kb_sources
from services.higgins import evidence as ev
from services.higgins import knowledge
from services.higgins import repository as repo
from services.higgins.contracts import Coverage, SourceReference
from services.higgins.teddy import official, patterns, report, search
from services.higgins.teddy.official import fact
from services.higgins.teddy.triage import Check, Plan, digits, registrable
from services.higgins.teddy.triage import plan as triage_plan

log = logging.getLogger("apollo.teddy")

PREGATHERED_ITEM_ID = "apollo-triage-intelligence"   # what Apollo Triage gathered before the case started
CHECKS_ITEM_ID = "teddy-di-checks"                   # Teddy's full check record, with provenance
BRIEF_ITEM_ID = "teddy-di-brief"                     # the slice Magnum DI receives
_CORPORATE = re.compile(r"\b(pty|ltd|limited|inc|llc|plc|the|group|holdings)\b\.?", re.I)
_SEARCH_SIGNAL = {"WARNING": "concern", "OFFICIAL": "clear", "FOUND_ELSEWHERE": "anomaly"}


@dataclass
class TeddyOutcome:
    resolved: bool
    answered_by: str
    response: dict | None = None
    rows: list[dict] = field(default_factory=list)       # what Magnum DI receives when it is needed
    magnum_search: bool = False
    usage: dict = field(default_factory=dict)
    simulated: bool = False
    model: str | None = None


# ── Reading the submitted material ──────────────────────────────────────────
async def _material(owner: str, case: dict, rows: list[dict]) -> tuple[dict[str, str], list[str], list[dict]]:
    """Text and links Teddy can read, and the items it can't (images, documents with no extracted text)."""
    texts: dict[str, str] = {}
    unreadable: list[str] = []
    read: list[dict] = []
    parents_with_text = {r.get("parent_id") for r in rows if r["kind"] == "text" and r.get("parent_id")}
    for row in rows:
        if row["availability"] != "available" or row["origin"] in ("apollo_inference", "device_observation", "external_source"):
            continue
        if row["kind"] in ("text", "url"):
            text = (await repo.read_bytes(owner, case["case_id"], row["evidence_id"])).decode("utf-8", errors="replace")
            if text.strip() and not ev.is_workflow_metadata(text):
                texts[row["evidence_id"]] = text
                read.append(row)
        elif row["kind"] == "image" or (row["kind"] == "document" and row["evidence_id"] not in parents_with_text):
            unreadable.append(row["evidence_id"])
    return texts, unreadable, read


# ── Stage 2: Apollo Knowledge Base ──────────────────────────────────────────
def _current(entries: list[dict]) -> list[dict]:
    """Sourced, current KB entries only: saved AI answers and historical pages are not used."""
    return [e for e in entries if e.get("kind") != "gemini_answer" and e.get("status") != "historical"]


def _kb_fact(entry: dict, text: str) -> dict:
    level = "official" if entry.get("authority_tier") == kb_sources.TIER_1 else "independent"
    return fact(text, "context", kind="apollo_knowledge", source={
        "publisher": entry.get("publisher"), "url": entry.get("url"), "title": entry.get("title"), "authority": level,
        "basis": "Apollo Knowledge Base — general knowledge, not evidence about this case", "retrieval": "fetched", "kbId": entry.get("kb_id")})


async def _pattern_stage(plan_: Plan, text: str) -> None:
    """Compare the material with the established scam patterns in Apollo's KB (deterministic, no cost)."""
    if not plan_.has_message:
        return
    found = await patterns.best(text, has_link=bool(plan_.entities.hosts), has_brand=bool(plan_.entities.brands))
    if not found:
        return
    plan_.pattern = found.wire()
    entry = found.entry
    check = Check(id=f"c{len(plan_.checks) + 1}", kind="scam_pattern", subject=entry.get("title") or found.wire()["name"], route="apollo_kb",
                  facts=[_kb_fact(entry, f"{entry.get('publisher')}: “{entry.get('title')}”")])
    if found.stage == "partial":
        check.status = "needs_reasoning"
        check.open_issue = (f"Whether this is the {plan_.pattern['name']}: the material {', '.join(label for label, _ in found.found)}, "
                            f"but not that it {', '.join(found.missing)}.")
    else:
        check.status = "resolved"
    plan_.checks.append(check)


async def _kb_stage(plan_: Plan, text: str) -> None:
    await _pattern_stage(plan_, text)
    for check in plan_.checks:
        try:
            if check.kind == "general_question":
                hits = _current(await knowledge.search(check.subject))
                if hits:
                    check.facts += [_kb_fact(e, f"{e.get('publisher')}: “{e.get('title')}”") for e in hits]
                    check.status, check.route = "resolved", "apollo_kb"
                elif not check.question:
                    check.status, check.open_issue = "needs_reasoning", "A general question that needs reasoning rather than a lookup."
            elif check.kind == "claim":
                for entry in _current(await knowledge.related(check.subject))[:2]:
                    check.facts.append(_kb_fact(entry, f"{entry.get('publisher')} on claims like this: “{entry.get('title')}”"))
                check.status, check.route = "needs_reasoning", ("apollo_kb" if check.facts else None)
            elif check.kind == "scam_alerts":
                for entry in _current(await knowledge.related(text[:1500]))[:2]:
                    check.facts.append(_kb_fact(entry, f"{entry.get('publisher')}: “{entry.get('title')}”"))
                check.status, check.route = "resolved", "apollo_kb"
            elif check.kind == "company":
                for entry in _current(await knowledge.related(check.subject)):
                    if entry.get("kind") == "scam_alert" and check.subject.lower() in f"{entry.get('title', '')} {entry.get('body', '')}".lower():
                        check.facts.append(_kb_fact(entry, f"Apollo's library holds an official alert that mentions “{check.subject}” (“{entry.get('title')}”). "
                                                           "That is context, not proof about this case."))
        except Exception:  # noqa: BLE001 — the KB can never break an investigation
            log.warning("teddy_kb_stage_failed kind=%s", check.kind, exc_info=True)
        if check.kind in ("message_analysis", "image_analysis"):
            check.status = "needs_reasoning"


# ── Stage 3: applying targeted search answers ───────────────────────────────
def _names(check: Check, text: str) -> bool:
    """The warning is about this exact value, not a similar one."""
    if check.kind == "phone":
        return digits(check.subject)[-8:] in digits(text)
    return check.subject.lower() in (text or "").lower()


def _core(name: str) -> str:
    return " ".join(_CORPORATE.sub(" ", name.lower()).split())


def _apply(check: Check, answer: dict, plan_: Plan) -> None:
    status = answer.get("status")
    if status == "UNAVAILABLE":
        check.status = "unavailable"
        return
    check.route = "google_search"
    sources = answer.get("sources") or []
    lead = sources[0] if sources else None
    src = ({"publisher": lead["domain"] or lead["title"], "url": lead["url"], "title": lead["title"], "authority": lead["authority"],
            "basis": lead["basis"], "retrieval": "search_result", "all": sources} if lead else None)
    if status in ("UNANSWERED", "UNSOURCED"):
        check.status = "not_found"
        check.facts.append(fact(f"Teddy DI's search returned no sourced answer about {check.subject}.", "missing"))
        return
    if status in search.NOT_FOUND:
        check.status = "not_found"
        check.facts.append(fact(f"Teddy DI's search found no record for {check.subject}: {answer.get('fact', '')}".strip(), "missing", source=src))
        return
    decisive = (status == "WARNING" and check.kind in ("link", "phone", "email", "company")
                and any(s.get("authority") == "official" for s in sources) and _names(check, answer.get("fact", "")))
    check.facts.append(fact(answer.get("fact", ""), _SEARCH_SIGNAL.get(status, "neutral"), decisive=decisive, source=src))
    check.status = "resolved"
    if check.kind in ("abn", "acn", "licence") and plan_.entities.companies:
        named = plan_.entities.companies
        if any(_core(c) and _core(c) in answer.get("fact", "").lower() for c in named):
            check.facts.append(fact(f"The register entry for {check.subject} matches {named[0]}, the name in the material.", "clear", topic="name_match"))
        else:
            check.facts.append(fact(f"The register entry for {check.subject} does not match {', '.join(named)}, the name in the material.", "anomaly",
                                    topic="name_match"))
            check.status, check.open_issue = "needs_reasoning", f"Conflict: {check.subject} is registered to a different name than {named[0]}."


# ── Deciding: is the case resolved, or does Magnum DI get the unresolved slice? ──
# The deciding test: could Magnum DI's deeper investigation change Apollo's finding or Higgins' action?
#   No  → resolved: Teddy DI's outcome stands and Magnum DI is not called.
#   Yes → not resolved: only the unresolved part goes to Magnum DI.
# "Unable to determine" is a resolved outcome when Magnum DI has nothing further that could change it.
@dataclass
class Decision:
    answered_by: str
    outcome: str | None        # Apollo's case outcome (outcomes.py); None for a general question
    basis: str                 # threat | pattern | impersonation | link | knowledge


def _link_clear(check: Check) -> bool:
    if any(f["decisive"] and f["signal"] == "clear" for f in check.facts):
        return True
    topics = {f.get("topic"): f["signal"] for f in check.facts}
    return (topics.get("listing") == "clear" and topics.get("registration") == "neutral"
            and check.status == "not_found" and check.route == "google_search")


def _live(plan_: Plan) -> list[dict]:
    return [f for c in plan_.checks for f in c.facts if f["class"] == "live_evidence"]


def _conflicts(plan_: Plan) -> list[Check]:
    """Findings that disagree in a way that could change the outcome (e.g. a register entry under another name)."""
    return [c for c in plan_.checks if c.open_issue.startswith("Conflict")]


def _official_material(plan_: Plan) -> bool:
    """Every link and address in the material belongs to the organisation it names — which contradicts an
    impersonation pattern, so resolving it needs Magnum DI."""
    impersonation = [c for c in plan_.checks if c.kind == "impersonation"]
    return bool(impersonation) and all(c.status == "resolved" and not any(f["signal"] == "anomaly" for f in c.facts) for c in impersonation)


def corroborated_impersonation(plan_: Plan) -> list[dict]:
    """The material names an organisation, a link in it isn't that organisation's domain, and an independent
    fact about that same link backs it up (newly registered, flagged, redirected, a direct download)."""
    mismatched = [f for c in plan_.checks if c.kind == "impersonation" for f in c.facts if f.get("topic") == "impersonation"]
    places = {registrable(f["place"]) for f in mismatched if f.get("place")}
    support = [f for c in plan_.checks if c.kind == "link" and registrable(c.subject) in places
               for f in c.facts if f["class"] == "live_evidence" and f["signal"] in ("anomaly", "concern")]
    return mismatched + support if support else []


def _link_outcome(plan_: Plan) -> Decision:
    """A bare link, after every applicable Teddy DI resource: Magnum DI can't open the page either, so it has
    nothing further that could change the result."""
    links = [c for c in plan_.checks if c.kind == "link"]
    others = [c for c in plan_.checks if c.kind != "link"]
    route = "teddy_search" if any(c.route == "google_search" for c in links) else "teddy_official"
    if any(f["signal"] in ("anomaly", "concern") for f in _live(plan_)):
        return Decision(route, "concerning", "link")
    if links and all(c.status == "resolved" for c in others) and all(_link_clear(c) for c in links):
        return Decision(route, "no_scam_indicators", "link")
    return Decision(route, "unable_to_determine", "link")


def decide(plan_: Plan, *, final: bool) -> Decision | None:
    """Apollo's outcome criteria. Before the last stage only a decisive official result (or a general
    question already answered) stops Teddy DI; every other outcome waits until the checks Apollo Triage
    planned have run."""
    for check in plan_.checks:
        for f in check.facts:
            if f["class"] == "live_evidence" and f["signal"] == "concern" and f["decisive"]:
                return Decision("teddy_search" if check.route == "google_search" else "teddy_official", "confirmed_threat", "threat")
    if plan_.general:
        check = plan_.checks[0]
        if check.status == "resolved":
            return Decision("teddy_kb" if check.route == "apollo_kb" else "teddy_search", None, "knowledge")
        return None
    if not final or plan_.unreadable or _conflicts(plan_):
        return None   # content only Magnum DI can read, or a contradiction that could change the outcome
    pattern = plan_.pattern
    if pattern and pattern["stage"] in ("full", "opening") and not (pattern["impersonatesOrganisation"] and _official_material(plan_)):
        return Decision("teddy_kb", "likely_scam" if pattern["stage"] == "full" else "concerning", "pattern")
    if corroborated_impersonation(plan_):
        return Decision("teddy_official", "concerning", "impersonation")
    if plan_.link_only:
        return _link_outcome(plan_)
    return None       # the wording and tactics need Magnum DI's message analysis


def magnum_needs_search(plan_: Plan) -> bool:
    """Google Search stays OFF for Magnum DI unless a specific external fact is still missing: content Teddy
    couldn't read, a lookup that was unavailable, or a general question Teddy couldn't answer."""
    return bool(plan_.unreadable or any(c.status == "unavailable" for c in plan_.checks) or plan_.general)


# ── Persistence and provenance ──────────────────────────────────────────────
async def _register_sources(owner: str, case_id: str, checks: list[Check]) -> None:
    refs: list[SourceReference] = []
    for check in checks:
        for f in check.facts:
            src = f.get("source") or {}
            pages = [(s["url"], s.get("title"), s.get("authority"), s.get("basis"), "search_result") for s in src.get("all") or []]
            if not pages and (src.get("url") or "").startswith("https://"):
                pages = [(src["url"], src.get("title") or src.get("publisher"), src.get("authority"), src.get("basis"), src.get("retrieval"))]
            ids = []
            for url, title, authority, basis, retrieval in pages:
                ref = SourceReference(id=str(uuid.uuid4()), url=url, title=(title or url)[:200], retrieved_at=now_utc(),
                                      retrieval=retrieval if retrieval in ("fetched", "search_result") else "fetched",
                                      authority=authority if authority in ("official", "independent", "self_claimed") else "unknown",
                                      authority_basis=(basis or "")[:300])
                refs.append(ref)
                ids.append(ref.id)
            f["sourceIds"] = ids
    if not refs:
        return
    mapping = await repo.add_sources(owner, case_id, refs)
    for check in checks:
        for f in check.facts:
            f["sourceIds"] = list(dict.fromkeys(mapping.get(i, i) for i in f.get("sourceIds", [])))


async def _item(owner: str, case: dict, client_item_id: str, text: str, label: str) -> str:
    existing = next((r for r in await repo.list_evidence(owner, case["case_id"]) if r.get("client_item_id") == client_item_id), None)
    if existing:
        return existing["evidence_id"]
    item = await ev.ingest_text(owner, case, client_item_id, text, kind="observation", origin="apollo_inference", label=label,
                                meta={"source": "teddy_di"}, coverage=Coverage(status="examined", unit="items", total=1, examined=1))
    return item.id


async def _mark_read(owner: str, case_id: str, read: list[dict], texts: dict[str, str]) -> None:
    """Teddy read these items in full to triage them, so they are examined."""
    for row in read:
        coverage = row.get("coverage") or {}
        total = coverage.get("total") or (1 if coverage.get("unit") == "items" else len(texts[row["evidence_id"]]))
        await ev.mark_examined(owner, case_id, row["evidence_id"], 0, total, total)


async def _magnum_rows(owner: str, case: dict, brief_id: str) -> list[dict]:
    """Everything Magnum DI must see (the material itself), with Teddy's brief standing in for the raw lookups."""
    pe_values = {json.dumps(v, sort_keys=True, default=str) for v in (case.get("triage_provider_evidence") or {}).values()}
    rows = []
    for row in await repo.list_evidence(owner, case["case_id"]):
        cid = row.get("client_item_id") or ""
        if cid in (PREGATHERED_ITEM_ID, CHECKS_ITEM_ID):
            continue
        if cid.startswith("intel-") and pe_values:
            text = (await repo.read_bytes(owner, case["case_id"], row["evidence_id"])).decode("utf-8", errors="replace")
            try:
                if json.dumps(json.loads(text), sort_keys=True, default=str) in pe_values:
                    continue
            except ValueError:
                pass
        rows.append(row)
    return sorted(rows, key=lambda r: r["evidence_id"] != brief_id)


def _summary(plan_: Plan, decision: Decision | None, magnum_search: bool, searched: dict) -> dict:
    return {"ranAt": now_utc(), "answeredBy": decision.answered_by if decision else "magnum_di", "resolved": bool(decision),
            "outcome": decision.outcome if decision else None, "basis": decision.basis if decision else None, "messageType": plan_.message_type,
            "pattern": {"key": plan_.pattern["key"], "stage": plan_.pattern["stage"]} if plan_.pattern else None,
            "checks": [{"kind": c.kind, "status": c.status, "route": c.route} for c in plan_.checks],
            "searchCalls": searched["calls"], "searchQueries": searched["queries"], "cacheHits": searched["cacheHits"],
            "teddyTokens": searched["tokens"], "simulated": searched["simulated"], "searchModel": searched["model"],
            "magnumNeeded": not decision, "magnumSearch": magnum_search, "reusedOnRetry": 0}


# ── Entry point ─────────────────────────────────────────────────────────────
async def investigate(owner: str, case: dict, job: dict, question: str, rows: list[dict], progress) -> TeddyOutcome:
    """Triage → Teddy DI. Runs once per case: a retry of Magnum DI reuses this record and repeats no lookup."""
    case_id = case["case_id"]
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0, "teddy_ciphertext": 1})
    if stored and stored.get("teddy_ciphertext"):
        record = repo.dec_json(stored["teddy_ciphertext"])
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$inc": {"routing.teddy.reusedOnRetry": 1}})
    else:
        record = await _run(owner, case, job, question, rows, progress)
    usage = record["search"]["tokens"]
    common = {"usage": {"input_tokens": usage.get("input") or None, "output_tokens": usage.get("output") or None},
              "simulated": record["search"]["simulated"], "model": record["search"]["model"]}
    if record.get("response"):
        return TeddyOutcome(True, record["decision"]["answeredBy"], response=record["response"], **common)
    brief_id = record["items"]["brief"]
    return TeddyOutcome(False, "magnum_di", rows=await _magnum_rows(owner, case, brief_id), magnum_search=record["magnumSearch"], **common)


async def _run(owner: str, case: dict, job: dict, question: str, rows: list[dict], progress) -> dict:
    case_id = case["case_id"]
    await progress("observe", "Apollo Triage is working out what needs checking.")
    texts, unreadable, read = await _material(owner, case, rows)
    plan_ = triage_plan(question, list(texts.values()), unreadable=unreadable)
    combined = "\n".join(texts.values())

    await progress("observe", "Teddy DI is checking official sources first.")
    await official.run(plan_, case.get("triage_provider_evidence"), combined)
    decision = decide(plan_, final=False)
    searched = {"calls": 0, "queries": 0, "cacheHits": 0, "tokens": {"input": 0, "output": 0}, "simulated": False, "model": None, "status": "skipped"}
    if not decision:
        await progress("observe", "Teddy DI is checking Apollo's knowledge base.")
        await _kb_stage(plan_, combined)
        decision = decide(plan_, final=False)
    if not decision:
        open_checks = [c for c in plan_.checks if c.question and c.status == "open"]
        if open_checks:
            await progress("research", "Teddy DI is running a few targeted searches.")
            searched = await search.run(open_checks, correlation_id=f"case-{case_id}", trigger_source=job.get("source"))
            for check in open_checks:
                if check.id in searched["answers"]:
                    _apply(check, searched["answers"][check.id], plan_)
        decision = decide(plan_, final=True)
    magnum_search = False if decision else magnum_needs_search(plan_)

    await _register_sources(owner, case_id, plan_.checks)
    unread_sections = official.unread_sections(case.get("triage_provider_evidence"))
    checks_id = await _item(owner, case, CHECKS_ITEM_ID, json.dumps({
        "messageType": plan_.message_type, "entities": plan_.entities.wire(), "checks": [c.wire() for c in plan_.checks],
        "pattern": plan_.pattern, "search": {k: v for k, v in searched.items() if k != "answers"}}, ensure_ascii=False, default=str),
        "Teddy DI fly-by checks")
    await _mark_read(owner, case_id, read, texts)

    response = None
    if decision and decision.basis == "knowledge":
        check = plan_.checks[0]
        entries = [e for e in [await db.higgins_knowledge.find_one({"kb_id": (f.get("source") or {}).get("kbId")}, {"_id": 0})
                               for f in check.facts if (f.get("source") or {}).get("kbId")] if e]
        presented = knowledge.present(entries, check.subject)[0] if entries else ""
        response = report.knowledge_answer(check, decision.answered_by, presented, sorted({s for f in check.facts for s in f.get("sourceIds", [])}))
    elif decision:
        response = report.compose(decision.basis, decision.outcome, decision.answered_by, plan_, texts, checks_id, unreadable,
                                  corroborated_impersonation(plan_))
    brief_id = None
    if not decision:
        brief_id = await _item(owner, case, BRIEF_ITEM_ID, report.magnum_brief(plan_.checks, unread_sections, plan_.pattern), "Teddy DI brief for Magnum DI")

    record = {"version": 2, "ranAt": now_utc().isoformat(), "plan": {"messageType": plan_.message_type, "linkOnly": plan_.link_only,
              "general": plan_.general, "unreadable": plan_.unreadable}, "checks": [c.wire() for c in plan_.checks], "pattern": plan_.pattern,
              "decision": {"answeredBy": decision.answered_by, "outcome": decision.outcome, "basis": decision.basis} if decision else None,
              "response": response, "magnumSearch": magnum_search, "search": {k: v for k, v in searched.items() if k != "answers"},
              "items": {"checks": checks_id, "brief": brief_id}}
    summary = _summary(plan_, decision, magnum_search, searched)
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {
        "teddy_ciphertext": repo.enc_json(record), "routing.teddy": summary, "routing.answeredBy": summary["answeredBy"]}})
    return record


async def discard_response(owner: str, case: dict) -> None:
    """Teddy's composed result failed Apollo's validation: Magnum DI takes the case instead, with Teddy's
    brief and with Google Search on, since Teddy's conclusion can't be relied on."""
    case_id = case["case_id"]
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0, "teddy_ciphertext": 1})
    if not stored or not stored.get("teddy_ciphertext"):
        return
    record = repo.dec_json(stored["teddy_ciphertext"])
    checks = [Check.from_wire(c) for c in record["checks"]]
    brief = report.magnum_brief(checks, official.unread_sections(case.get("triage_provider_evidence")), record.get("pattern"))
    record["items"]["brief"] = await _item(owner, case, BRIEF_ITEM_ID, brief, "Teddy DI brief for Magnum DI")
    record.update(response=None, decision=None, magnumSearch=True)
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {
        "teddy_ciphertext": repo.enc_json(record), "routing.answeredBy": "magnum_di", "routing.teddy.resolved": False,
        "routing.teddy.magnumNeeded": True, "routing.teddy.magnumSearch": True, "routing.teddy.answeredBy": "magnum_di"}})
