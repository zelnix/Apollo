"""Cost routing: Higgins Triage → TC FlyBy → Magnum DI.

- Triage extracts entities deterministically and plans only the relevant checks.
- TC FlyBy stops as soon as a check is reliably resolved: an official listing, an official domain, Apollo's
  KB or one targeted low-cost search — and then Magnum DI (Gemini) is never called.
- When Magnum DI is needed it receives the material plus Teddy's brief (not the raw lookups), with Google
  Search off unless a specific external fact is still missing. One Magnum call, no second model.
- Admin portal shows "Answered by" and the cost-routing measurements.

Run: cd /app/backend && python -m pytest tests/test_teddy_routing.py -q
"""
import uuid
from datetime import datetime

import pytest
from services.higgins.ai_request import Message, Part
from starlette.requests import Request

from core.db import db
from routers import admin_portal
from services.higgins import ai_settings, jobs, provider
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.preview.preview_simulator import evidence_blocks, simulated_text
from services.higgins.provider import AIResult, Purpose
from services.higgins.teddy import official, search, triage

pytestmark = pytest.mark.anyio
REAL_SEARCH = search.run   # captured before conftest's offline stub replaces it


# ── Triage ───────────────────────────────────────────────────────────────────
def test_triage_extracts_entities_and_plans_relevant_checks():
    text = ("Dear investor, Apex Horizon Capital Pty Ltd (ABN 51 824 753 556, AFSL 123456) offers guaranteed returns of 12% per month. "
            "Mr John Carter, our senior adviser, will call you on 0412 345 678. Join at https://apex-horizon.io/join or email "
            "support@apex-horizon.io. Reference 2026-06-05.")
    plan = triage.plan("Is this investment real?", [text])
    ent = plan.entities
    assert ent.hosts == ["apex-horizon.io"] and ent.emails == ["support@apex-horizon.io"]
    assert ent.abns == ["51824753556"] and ent.licences == [("AFSL", "123456")]
    assert ent.companies == ["Apex Horizon Capital Pty Ltd"] and ent.people == ["John Carter"]
    assert ent.phones == ["0412 345 678"], "dates, ABNs and licence numbers are not phone numbers"
    assert ent.claims and "guaranteed returns" in ent.claims[0]
    assert plan.message_type == "investment"
    kinds = [c.kind for c in plan.checks]
    for kind in ("link", "phone", "email", "company", "abn", "licence", "person", "claim", "scam_alerts", "message_analysis"):
        assert kind in kinds, kind
    assert all(c.question for c in plan.checks if c.kind in ("link", "phone", "email", "company", "abn", "licence", "person"))


def test_registration_number_check_digits():
    assert triage.abn_valid("51 824 753 556") and not triage.abn_valid("51 824 753 557")
    assert triage.acn_valid("004 085 616") and triage.acn_valid("010 499 966") and not triage.acn_valid("004 085 617")


def test_a_general_question_is_not_material_to_check():
    assert triage.plan("What is a PayID scam?", ["What is a PayID scam?"]).general
    assert not triage.plan("I got a text from my bank, is it real?", ["I got a text from my bank, is it real?"]).general
    assert not triage.plan("Check this", ["Pay $2.99 at https://auspost-redeliver.top now"]).general


# ── Harness ──────────────────────────────────────────────────────────────────
def _gateway(monkeypatch, teddy_text=None, teddy_grounding=None):
    """Gemini gateway replaced: Teddy's search purpose answers with `teddy_text`, Magnum's with the simulator."""
    calls: list[dict] = []

    async def fake(system, contents, **kwargs):
        calls.append(kwargs)
        if kwargs["purpose"] == Purpose.TEDDY_SEARCH:
            text, grounding = teddy_text or "", teddy_grounding
        else:
            text, grounding = simulated_text(Purpose.INVESTIGATION, True, evidence_blocks(contents)), None
        return AIResult(text=text, finish_reason="STOP",
                            usage={"prompt_token_count": 10, "candidates_token_count": 5, "total_token_count": 15}, grounding=grounding,
                            model=kwargs.get("model") or "gemini-3.1-flash-lite")

    monkeypatch.setattr(provider, "generate", fake)
    return calls


async def _case(items: list[tuple[str, str]], *, message="Is this real?", pregathered=None):
    owner = f"teddy-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    for n, (kind, value) in enumerate(items):
        if kind == "url":
            await ev.ingest_url(owner, case, f"item-{n}", value)
        else:
            await ev.ingest_text(owner, case, f"item-{n}", value, kind="text", origin="user_submission", label="Submitted message text")
    if pregathered:
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case["case_id"]}, {"$set": {"triage_provider_evidence": pregathered}})
    case = await repo.get_case(owner, case["case_id"])
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest(turn_id), repo.digest("p"), "turn", {"message": message, "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": case["revision"]}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "queued"}})
    await jobs.run(owner, case["case_id"], job["job_id"])
    events = await repo.events_after(owner, job["job_id"], 0)
    response = next((e["payload"]["response"] for e in events if e["type"] == "response"), None)
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0})
    return owner, stored, response, events


PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc"
       b"\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


async def _files_case(files: list[tuple[dict, bytes]], *, message="Is this real?"):
    """A case built from uploaded files (screenshots, documents), run through the real job."""
    owner = f"teddy-file-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "vision", None)
    for meta, data in files:
        await ev.ingest_file(owner, case, meta, data)
    case = await repo.get_case(owner, case["case_id"])
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest(turn_id), repo.digest("p"), "turn", {"message": message, "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": case["revision"]}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "queued"}})
    await jobs.run(owner, case["case_id"], job["job_id"])
    events = await repo.events_after(owner, job["job_id"], 0)
    response = next((e["payload"]["response"] for e in events if e["type"] == "response"), None)
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0})
    return owner, stored, response


def _spy(monkeypatch) -> list:
    """Captures what Magnum DI is sent (on top of _gateway)."""
    captured: list = []
    original = provider.generate

    async def spy(system, contents, **kwargs):
        if kwargs["purpose"] == Purpose.INVESTIGATION:
            captured.append([p for p in contents[0].parts])
        return await original(system, contents, **kwargs)

    monkeypatch.setattr(provider, "generate", spy)
    return captured


def _lookups(monkeypatch, *, verdict="clean", threats=(), age_days=4000):
    async def url(u):
        return {"verdict": verdict, "threatTypes": list(threats), "coverage": "full",
                "sources": [{"name": "google_safe_browsing", "status": "match" if verdict == "malicious" else "clear"}],
                "checkedAt": "2026-06-05T00:00:00+00:00"}

    async def domain(d):
        return {"registeredAt": "2015-01-01T00:00:00+00:00" if age_days > 365 else "2026-06-01T00:00:00+00:00",
                "ageDays": age_days, "registrar": "Example", "newlyRegistered": age_days < 30}

    monkeypatch.setattr(official, "lookup_url", url)
    monkeypatch.setattr(official, "lookup_domain", domain)


def _grounded(lines: list[str], urls: list[tuple[str, str]]) -> tuple[str, dict]:
    """Answer lines with each line supported by the matching (url, domain) chunk."""
    text = "\n".join(lines)
    supports, offset = [], 0
    for index, line in enumerate(lines):
        supports.append({"segment": {"start_index": offset, "end_index": offset + len(line.encode()), "text": line}, "grounding_chunk_indices": [index]})
        offset += len(line.encode()) + 1
    chunks = [{"web": {"uri": u, "title": d, "domain": d}} for u, d in urls]
    return text, {"grounding_chunks": chunks, "grounding_supports": supports, "web_search_queries": ["q"] * len(lines)}


# ── TC FlyBy settles it: Magnum DI is never called ──────────────────────────
async def test_an_official_listing_settles_the_case_without_gemini(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch, verdict="malicious", threats=["SOCIAL_ENGINEERING"])
    owner, case, response, _ = await _case([("text", "ANZ: your card is locked. Verify now at https://anz-verify.co/login")])
    assert calls == [], "a reliable official listing is not confirmed by Gemini"
    assert response["assessment"] == "concern_found" and response["attention"] == "action_needed"
    assert response["outcome"] == "confirmed_threat" and case["routing"]["outcome"] == "confirmed_threat"
    assert "Google Safe Browsing lists anz-verify.co" in response["overview"]
    assert response["findings"][0]["basis"] == "observation" and response["findings"][0]["evidenceIds"]
    assert any(a["label"] == "Don't open the link" for a in response["actions"])
    assert case["routing"]["answeredBy"] == "teddy_official" and case["routing"]["teddy"]["resolved"] is True
    assert case["routing"]["assessment"] == "concern_found" and "magnum" not in case["routing"]
    commit = await db.investigation_turn_commits.find_one({"owner_id": owner, "case_id": case["case_id"]})
    assert commit, "Teddy's result is committed through the same turn commit as Magnum DI's"


async def test_an_official_government_link_is_cleared_without_gemini(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch)
    _owner, case, response, _ = await _case([("url", "https://www.ato.gov.au/individuals/lodging-your-tax-return")], message="Is this link safe?")
    assert calls == []
    assert response["assessment"] == "no_concern_found_within_scope" and response["attention"] == "none"
    assert response["outcome"] == "no_scam_indicators"
    assert "Australian Taxation Office's official domain" in response["overview"]
    assert "That settles who the address belongs to" in response["overview"] and "nothing here needs action" not in response["overview"]
    assert case["routing"]["answeredBy"] == "teddy_official"


async def test_a_general_question_is_answered_from_apollo_kb(monkeypatch):
    from services.higgins import knowledge
    calls = _gateway(monkeypatch)
    await knowledge.ensure_indexes()
    await knowledge.upsert("official_guidance", f"test-payid-{uuid.uuid4().hex[:6]}", title="PayID scams: how they work",
                           body="PayID scams trick sellers into believing a payment is pending until they pay a fee.\n\nNever pay to receive money.",
                           publisher="Scamwatch (ACCC)", authority_tier="tier_1_authoritative", jurisdiction="AU",
                           url="https://www.scamwatch.gov.au/types-of-scams/payid-scams")
    _owner, case, response, _ = await _case([("text", "How do PayID scams work?")], message="How do PayID scams work?")
    assert calls == []
    assert case["routing"]["answeredBy"] == "teddy_kb"
    assert "PayID scams trick sellers" in response["explanationMarkdown"] and response["findings"] == []
    assert "general information, not a finding" in response["explanationMarkdown"]
    assert response["outcome"] is None, "a general question has no case outcome"


async def test_a_targeted_search_finding_an_official_warning_stops(monkeypatch):
    monkeypatch.setattr(search, "run", REAL_SEARCH)
    await db.teddy_search_cache.delete_many({})
    await db.reusable_intelligence.delete_many({"source_type": "tc_flyby_lookup"})
    text, grounding = _grounded(
        ["Q1 | WARNING | ASIC's Moneysmart lists Zenith Quantum Markets on its Investor Alert List (added March 2026)."],
        [("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", "moneysmart.gov.au")])
    calls = _gateway(monkeypatch, text, grounding)
    owner, case, response, _ = await _case([("text", "Zenith Quantum Markets offers 3% daily returns. Message us on WhatsApp to start.")])
    assert [c["purpose"] for c in calls] == [Purpose.TEDDY_SEARCH], "one low-cost search call, and no Magnum DI call"
    assert calls[0]["model"] == await ai_settings.investigation_model() and calls[0]["web_search"] is True
    assert response["assessment"] == "concern_found" and "Investor Alert List" in response["overview"]
    assert response["outcome"] == "confirmed_threat", "the planned search ran before Teddy settled the outcome"
    assert response["findings"][0]["sourceIds"], "the warning keeps its source"
    assert case["routing"]["answeredBy"] == "teddy_search"
    assert case["routing"]["teddy"]["searchCalls"] == 1 and case["routing"]["teddy"]["searchQueries"] == 1

    # The same lookup in another case is served from Teddy's cache: no second paid search.
    calls.clear()
    owner2, case2, response2, _ = await _case([("text", "Zenith Quantum Markets: 3% daily returns, guaranteed.")])
    assert calls == [] and case2["routing"]["teddy"]["cacheHits"] == 1
    assert response2["assessment"] == "concern_found"
    # The reused lookup's page is shown with the time Apollo last checked it, not as a new lookup.
    first, later = await repo.sources(owner, case["case_id"]), await repo.sources(owner2, case2["case_id"])
    searched = [s for s in first if "grounding-api-redirect" in s["url"]]
    reused = [s for s in later if "grounding-api-redirect" in s["url"]]
    assert searched and not any(s["reused"] for s in first)
    assert reused and all(s["reused"] for s in reused) and not any(s["reused"] for s in later if s not in reused)
    assert datetime.fromisoformat(reused[0]["retrievedAt"]) <= datetime.fromisoformat(searched[0]["retrievedAt"]), "when it was last checked"


# ── Magnum DI receives only the unresolved slice ────────────────────────────
INVOICE = ("Hi, it's Sarah from Brightline Accounts. Our bank details have changed, so please pay invoice 4471 ($1,240) to "
           "BSB 062-000 account 1234 5678 today. The invoice is at https://brightline-docs.net/inv/4471")


async def test_magnum_gets_only_the_unresolved_issue_and_teddys_brief_with_search_off(monkeypatch):
    monkeypatch.setattr(search, "run", REAL_SEARCH)
    await db.teddy_search_cache.delete_many({})
    await db.reusable_intelligence.delete_many({"source_type": "tc_flyby_lookup"})
    text, grounding = _grounded(
        ["Q1 | NO_WARNING_FOUND | No scam or security warning names brightline-docs.net."],
        [("https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", "example.com")])
    calls = _gateway(monkeypatch, text, grounding)
    _lookups(monkeypatch)
    captured = _spy(monkeypatch)
    pregathered = {"safe_browsing": {"urls": {"https://brightline-docs.net/inv/4471": {"verdict": "clean", "status": "ok", "queried_at": "2026-06-05"}}},
                   "_summary": {"providers_consulted": ["safe_browsing"], "total_lookups": 1}}
    _owner, case, response, _ = await _case([("text", INVOICE)], pregathered=pregathered)
    purposes = [c["purpose"] for c in calls]
    assert purposes == [Purpose.TEDDY_SEARCH, Purpose.INVESTIGATION], "Teddy's one search, then Magnum DI's one call"
    magnum = calls[1]
    assert magnum["web_search"] is False, "Teddy already has the external facts, so Magnum's Google Search is off"
    assert magnum["model"] == await ai_settings.investigation_model(), "the existing configured model — no escalation"
    assert "outcome" in magnum["response_schema"]["required"], "Magnum DI feeds the same outcome system"
    sent = [p.text for p in captured[0] if p.text]
    assert any("TC FlyBy fly-by results" in t and "For Magnum DI to settle" in t for t in sent)
    assert any("(reasoning) Message and deception analysis" in t and "payment details change" in t for t in sent), "only the unresolved issue"
    assert not any("apollo-triage-intelligence" in t or '"safe_browsing"' in t for t in sent), "raw lookups Teddy settled are not resent"
    assert any("please pay invoice 4471" in t for t in sent), "the material the issue is about is sent in full"
    teddy = case["routing"]["teddy"]
    assert [i["capability"] for i in teddy["issues"]] == ["reasoning"]
    assert {c["kind"]: c["status"] for c in teddy["checks"]}["message_analysis"] == "needs_reasoning"
    assert case["routing"]["answeredBy"] == "magnum_di" and case["routing"]["magnum"]["search"] is False
    assert response is not None and response["outcome"] and case["routing"]["outcome"] == response["outcome"]


async def test_a_newly_registered_link_is_a_weak_signal_never_concerning(monkeypatch):
    """No fixed list sends a message to Magnum DI, and a newly registered domain is a weak signal: alone it never makes
    a case Concerning. It is recorded, and the case is Unable to determine (rule book, TC FlyBy weak signals)."""
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch, age_days=6)
    _owner, case, response, _ = await _case([("text", "Hi, it's Sarah from the conference. Here are the slides you asked for: https://slides-deck.net/deck")])
    assert calls == [], "Magnum DI couldn't change the finding or what to do"
    assert response["outcome"] == "unable_to_determine"
    assert any("registered on 2026-06-01" in f["text"] for f in response["findings"]), "the weak signal is listed"
    assert "only a weak signal that isn't a concern on its own" in response["overview"]
    # Offline, the link's targeted search is unavailable: the gap and the weak signal are both named, nothing broader.
    assert {c["kind"]: c["status"] for c in case["routing"]["teddy"]["checks"]}["link"] == "unavailable"
    assert ("Some of what would settle this couldn't be checked and a weak signal can't settle it either way"
            in response["explanationMarkdown"])
    assert response["attentionReason"] == "Something ApolloSG couldn't fully check may still be unsafe."
    assert case["routing"]["teddy"]["issues"] == [] and case["routing"]["teddy"]["basis"] == "unknown"


async def test_a_plain_message_asking_nothing_is_settled_without_magnum(monkeypatch):
    calls = _gateway(monkeypatch)
    _owner, case, response, _ = await _case([("text", "Hey, are we still on for dinner on Friday? Let me know what time suits.")])
    assert calls == []
    assert response["outcome"] == "no_scam_indicators" and response["assessment"] == "no_concern_found_within_scope"
    assert "isn't proof it's genuine" in response["overview"] and "safe" not in response["overview"].lower()
    assert "Apollo found no links, numbers, addresses or names in it to look up" in response["explanationMarkdown"]
    teddy = case["routing"]["teddy"]
    assert teddy["resolved"] is True and teddy["issues"] == []
    assert {c["kind"]: c["status"] for c in teddy["checks"]}["message_analysis"] == "not_needed"
    assert (await repo.case_view(case)).wire()["answeredBy"] == teddy["answeredBy"] == "teddy_kb", "the app is told who settled it"
    assert (await repo.case_view(case)).wire()["simulated"] is False, "nothing outside was simulated"
    assert (await repo.case_view({**case, "routing": {**case["routing"], "teddy": {**teddy, "simulated": True}}})).wire()["simulated"] is True
    assert (await repo.case_view({**case, "routing": {**case["routing"], "magnum": {"simulated": True}}})).wire()["simulated"] is True


async def test_a_screenshot_is_investigated_through_the_text_triage_extracted(monkeypatch):
    calls = _gateway(monkeypatch)
    meta = {"clientItemId": "shot", "filename": "shot.png", "mediaType": "image/png", "kind": "image",
            "deviceExtractedText": "Hi Mum, I dropped my phone in the pool so this is my new number. Can you transfer $300 for the repair today?"}
    owner, case, response = await _files_case([(meta, PNG)])
    assert calls == [], "Triage extracted the screenshot's text; a full KB pattern match settles it"
    assert response["outcome"] == "likely_scam" and response["completion"] == "complete"
    teddy = case["routing"]["teddy"]
    assert teddy["gaps"] == [] and teddy["pattern"] == {"key": "family_new_number", "stage": "full"}
    image = next(r for r in await repo.list_evidence(owner, case["case_id"]) if r["kind"] == "image")
    assert image["coverage"]["status"] == "examined", "the image was examined through the text read from it"


async def test_a_document_is_investigated_through_its_text_layer(monkeypatch):
    import io
    import docx
    calls = _gateway(monkeypatch)
    document = docx.Document()
    document.add_paragraph("Hi Mum, I lost my phone so this is my new number. Could you please send $450 for the rent today?")
    buffer = io.BytesIO()
    document.save(buffer)
    meta = {"clientItemId": "letter", "filename": "letter.docx", "mediaType": DOCX, "kind": "document"}
    _owner, case, response = await _files_case([(meta, buffer.getvalue())])
    assert calls == [] and response["outcome"] == "likely_scam"
    assert case["routing"]["teddy"]["gaps"] == []


async def test_an_image_teddy_cannot_read_goes_to_magnum_with_search_on(monkeypatch):
    calls = _gateway(monkeypatch)
    captured = _spy(monkeypatch)
    _owner, case, _response = await _files_case([({"clientItemId": "shot", "filename": "shot.png", "mediaType": "image/png", "kind": "image"}, PNG)])
    assert [c["purpose"] for c in calls] == [Purpose.INVESTIGATION]
    assert calls[0]["web_search"], "Magnum DI reads the image for the first time, so external facts may be missing: Search on"
    teddy = case["routing"]["teddy"]
    assert teddy["magnumSearch"] is True and [i["capability"] for i in teddy["issues"]] == ["reading"]
    assert any(p.data is not None for p in captured[0]), "the image itself is what Magnum DI receives"


async def test_a_magnum_retry_reuses_teddys_record(monkeypatch):
    from services.higgins import teddy
    _lookups(monkeypatch)
    owner = f"teddy-retry-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "text", None)
    await ev.ingest_text(owner, case, "m", INVOICE, kind="text", origin="user_submission")
    case = await repo.get_case(owner, case["case_id"])
    job = {"job_id": "j", "source": "user_initiated"}

    async def progress(*_a):
        return None

    rows = await repo.list_evidence(owner, case["case_id"])
    first = await teddy.investigate(owner, case, job, "Is this real?", rows, progress)
    second = await teddy.investigate(owner, case, job, "Is this real?", rows, progress)
    assert not first.resolved and [r["evidence_id"] for r in first.rows] == [r["evidence_id"] for r in second.rows]
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0, "routing": 1})
    assert stored["routing"]["teddy"]["reusedOnRetry"] == 1
    briefs = [r for r in await repo.list_evidence(owner, case["case_id"]) if r["client_item_id"] == teddy.BRIEF_ITEM_ID]
    assert len(briefs) == 1


# ── Admin portal: Answered by + cost routing measurements ──────────────────
async def test_admin_report_shows_answered_by_and_routing(monkeypatch):
    _gateway(monkeypatch)
    _lookups(monkeypatch, verdict="malicious", threats=["MALWARE"])
    _owner, case, _response, _ = await _case([("text", "Your parcel is held: https://auspost-held.top/pay")])

    async def admin(_request):
        return {"email": "owner@example.com", "name": "Owner"}

    async def no_audit(*_a, **_k):
        return None

    monkeypatch.setattr(admin_portal, "_admin", admin)
    monkeypatch.setattr(admin_portal, "_audit_log", no_audit)
    request = Request({"type": "http", "method": "GET", "path": "/api/admin/investigations-cost", "query_string": b"period=all", "headers": []})
    page = await admin_portal.investigations_cost_report(request)
    assert "Answered By" in page and 'data-testid="answered-by-teddy_official"' in page and ">Official check</span>" in page
    assert 'data-testid="outcome-confirmed_threat"' in page and "Confirmed scam or threat" in page and "<th>Outcome</th>" in page
    assert 'data-testid="cost-routing-heading"' in page and "Resolved Without Magnum DI" in page and "Repeated Searches Avoided" in page
    drill = await admin_portal.investigation_drilldown(request, case["case_id"])
    assert "Cost Routing" in drill and ">Official check</span>" in drill and "Not called" in drill
    assert 'data-testid="outcome-confirmed_threat"' in drill


# ── When a case is resolved at TC FlyBy (Apollo's outcome criteria) ─────────
async def test_impersonation_with_a_brand_new_domain_is_concerning_without_gemini(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch, age_days=6)
    _owner, case, response, _ = await _case([("text", "CommBank: please read the notice about your account changes at https://commbank-notice.net/info")])
    assert calls == [], "Magnum DI couldn't change the finding or what to do"
    assert response["outcome"] == "concerning" and response["assessment"] == "concern_found"
    assert "isn't CommBank's domain" in response["overview"] and "registered on 2026-06-01" in response["overview"]
    assert "commbank-notice.net isn't one of CommBank's published domains" in response["explanationMarkdown"]
    assert "no reason to send you" not in response["explanationMarkdown"]
    assert response["attentionReason"] == ("Anything typed into that link goes to whoever runs commbank-notice.net, which isn't one of "
                                           "CommBank's published domains.")
    assert any(a["label"] == "Don't use the link" for a in response["actions"])
    assert any("Not taken further" in u and "deception analysis" in u for u in response["uncertainties"])
    assert case["routing"]["answeredBy"] == "teddy_official" and case["routing"]["teddy"]["basis"] == "impersonation"
    assert "magnum" not in case["routing"]


async def test_a_message_matching_a_kb_scam_pattern_is_likely_scam_without_gemini(monkeypatch):
    calls = _gateway(monkeypatch)
    _owner, case, response, _ = await _case([("text", "Hi Mum, I dropped my phone in the pool so this is my new number. "
                                                      "Can you transfer $300 for the repair today? I'll pay you back")])
    assert calls == []
    assert response["outcome"] == "likely_scam" and response["attention"] == "action_needed"
    assert "Scamwatch" in response["overview"] and "new number" in response["overview"]
    quoted = " ".join(f["text"] for f in response["findings"])
    assert "“Hi Mum”" in quoted and "$300" in quoted, "the findings are the material's own words"
    assert all(f["basis"] == "observation" and f["evidenceIds"] for f in response["findings"])
    assert "isn't proof that this particular sender is a scammer" in response["explanationMarkdown"]
    assert response["sourceIds"], "the KB pattern keeps its official source"
    assert any(a["label"] == "Call them on their usual number" for a in response["actions"])
    assert case["routing"]["answeredBy"] == "teddy_kb" and case["routing"]["teddy"]["pattern"] == {"key": "family_new_number", "stage": "full"}
    assert await db.higgins_knowledge.count_documents({"kind": "scam_pattern", "key": "family_new_number"}) == 1, "the pattern lives in Apollo's KB"


async def test_the_opening_of_a_kb_pattern_is_concerning(monkeypatch):
    calls = _gateway(monkeypatch)
    _owner, _case_doc, response, _ = await _case([("text", "Hi Mum, this is my new number. Save it and delete the old one x")])
    assert calls == [] and response["outcome"] == "concerning" and response["attention"] == "review"
    assert "hasn't asked for anything yet" in response["overview"]


async def test_an_unclear_pattern_match_goes_to_magnum(monkeypatch):
    calls = _gateway(monkeypatch)
    captured: list = []
    original = provider.generate

    async def spy(system, contents, **kwargs):
        captured.append(contents)
        return await original(system, contents, **kwargs)

    monkeypatch.setattr(provider, "generate", spy)
    _owner, case, response, _ = await _case([("text", "Hi Mum, can you send me $50 for lunch?")])
    assert [c["purpose"] for c in calls] == [Purpose.INVESTIGATION]
    sent = [p.text for p in captured[0][0].parts if p.text]
    assert any("partly matches the family member" in t for t in sent)
    assert case["routing"]["teddy"]["pattern"]["stage"] == "partial" and case["routing"]["answeredBy"] == "magnum_di"
    assert response["outcome"]


async def test_a_pattern_contradicted_by_official_links_is_settled_by_the_deciding_test(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch)
    _owner, case, response, _ = await _case([("text", "AusPost: your parcel is held. Pay the $2.50 redelivery fee at https://auspost.com.au/redeliver")])
    assert calls == [], "the request goes to AusPost's own domain: nothing Magnum DI could add changes what to do"
    assert response["outcome"] == "no_scam_indicators"
    pattern = case["routing"]["teddy"]["pattern"]
    assert pattern == {"key": "delivery_toll", "stage": "partial"}, "an impersonation pattern needs a link that isn't the organisation's own"

    calls.clear()   # the same wording, but the money goes somewhere nobody verified: Magnum DI's analysis could change the action
    _owner, case, _response, _ = await _case([("text", "AusPost: your parcel is held. Pay the $2.50 redelivery fee by PayID to 0412 345 678. "
                                                       "Track it at https://auspost.com.au/redeliver")])
    assert [c["purpose"] for c in calls] == [Purpose.INVESTIGATION]
    assert [i["capability"] for i in case["routing"]["teddy"]["issues"]] == ["reasoning"]


async def test_isolated_keywords_never_make_a_pattern_match():
    from services.higgins.teddy import patterns
    assert await patterns.best("Your parcel delivery is booked for Tuesday. Toll roads may be busy, so pay attention.", has_link=False,
                               has_brand=False, offsite=None) is None
    negated = await patterns.best("CommBank will never ask you to log in via a link to verify your account details. Your account is suspended "
                                  "only if you tell us.", has_link=True, has_brand=True, offsite=True)
    assert negated is None or negated.stage != "full", "a negated request is not a request"
    full = await patterns.best("Hi Dad, I broke my phone, this is my new number. Can you send me $200?", has_link=False, has_brand=False, offsite=None)
    assert full.stage == "full" and full.entry["pattern"]["key"] == "family_new_number"


async def test_a_lookalike_bare_link_follows_the_same_rule(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch)
    _owner, case, response, _ = await _case([("url", "https://commbank-secure-login.net/")], message="Is this link safe?")
    assert calls == [] and response["outcome"] == "concerning"
    assert "carries CommBank's name" in response["overview"]


async def test_a_bare_link_ends_concerning_or_unable_to_determine_without_gemini(monkeypatch):
    calls = _gateway(monkeypatch)
    _lookups(monkeypatch, age_days=6)
    _owner, case, response, _ = await _case([("url", "https://fresh-deals.shop/promo")], message="Is this link safe?")
    # A newly registered domain is a weak signal: recorded, never Concerning on its own.
    assert calls == [] and response["outcome"] == "unable_to_determine" and response["assessment"] == "uncertain"
    assert any("registered on 2026-06-01" in f["text"] for f in response["findings"])
    calls.clear()   # now nothing can be checked: every lookup and the search are unavailable
    from services.higgins.teddy import search as teddy_search

    async def unavailable(checks, **_k):
        return {"answers": {c.id: {"status": "UNAVAILABLE", "fact": "", "sources": []} for c in checks}, "calls": 0, "queries": 0,
                "cacheHits": 0, "tokens": {"input": 0, "output": 0}, "simulated": False, "model": None, "status": "unavailable"}

    async def none(*_a):
        return None

    monkeypatch.setattr(teddy_search, "run", unavailable)
    monkeypatch.setattr(official, "lookup_url", none)
    monkeypatch.setattr(official, "lookup_domain", none)
    _owner, case, response, _ = await _case([("url", "https://quietbrook-gardens.net/")], message="Is this link safe?")
    assert calls == [], "Magnum DI can't open the page either: nothing it could add"
    assert response["outcome"] == "unable_to_determine" and response["assessment"] == "uncertain"
    assert case["routing"]["outcome"] == "unable_to_determine" and case["routing"]["teddy"]["resolved"] is True
    assert "Some of what would settle this couldn't be checked" in response["explanationMarkdown"]
    assert response["attentionReason"] == "Something ApolloSG couldn't fully check may still be unsafe."


def test_magnums_outcome_must_agree_with_its_assessment():
    from services.higgins.validation import validate
    base = {"overview": "x", "explanationMarkdown": "y", "attention": "review", "attentionReason": None, "findings": [], "uncertainties": [],
            "scope": "", "sourceIds": [], "remainingEvidenceIds": [], "actions": [], "recommendedActionIndex": None, "question": None,
            "completion": "complete"}
    kwargs = {"revision": 1, "evidence_ids": set(), "source_ids": set(), "capability_ids": set(), "pending_question": None, "provider_complete": True}
    response, errors = validate({**base, "assessment": "uncertain", "outcome": "likely_scam"}, **kwargs)
    assert response is None and any("outcome 'likely_scam' requires assessment 'concern_found'" in e for e in errors)
    response, errors = validate({**base, "assessment": "uncertain", "outcome": "unable_to_determine"}, **kwargs)
    assert errors == [] and response.outcome == "unable_to_determine"
