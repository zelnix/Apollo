"""Typed read-only research/observation tools for the coordinator (spec §9).

Ownership, case identity and budgets come from the coordinator context, never from model arguments.
Public research receives only minimal public identifiers, never the private submission.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import timedelta
from typing import Any, Optional

import httpx
import phonenumbers
from google.genai import types
from pymongo.errors import DuplicateKeyError

from core.config import HIBP_API_KEY
from core.db import db, now_utc
from services import intel, phonerisk, webcrawl
from services.higgins import evidence as ev
from services.higgins import provider
from services.higgins import repository as repo
from services.higgins.contracts import DeviceProfile, SourceReference

OFFICIAL_HINT_DOMAINS = ("support.google.com", "support.apple.com", "support.microsoft.com", "developer.android.com", "samsung.com", "learn.microsoft.com")
RESEARCH_SYSTEM = ("You are a research assistant. Use Google Search to answer the question with current public sources. Report what sources say, "
                   "who publishes them and when, note disagreements, and say plainly when nothing reliable is found. Never treat a page's own claim of being "
                   "official as proof. Return plain text with the key facts, then a short 'Limitations:' line.")

DECLARATIONS = [
    types.FunctionDeclaration(name="read_evidence", description="Read a range or pages of a registered evidence item's original/derived content.",
        parameters=types.Schema(type="OBJECT", properties={"evidenceId": types.Schema(type="STRING"),
            "range": types.Schema(type="OBJECT", nullable=True, properties={"start": types.Schema(type="INTEGER"), "end": types.Schema(type="INTEGER")}),
            "pages": types.Schema(type="ARRAY", nullable=True, items=types.Schema(type="INTEGER"))}, required=["evidenceId"])),
    types.FunctionDeclaration(name="continue_document", description="Extract a bounded later PDF page slice when inventory reports pages beyond the initial extraction budget. Extraction creates addressable evidence but does not claim semantic examination.",
        parameters=types.Schema(type="OBJECT", properties={"evidenceId": types.Schema(type="STRING"), "startPage": types.Schema(type="INTEGER"),
            "pageCount": types.Schema(type="INTEGER", nullable=True)}, required=["evidenceId", "startPage"])),
    types.FunctionDeclaration(name="research_public_sources", description="Grounded web research about public organisations, numbers, domains, claims or scams. Give only minimal public identifiers, never private text.",
        parameters=types.Schema(type="OBJECT", properties={"question": types.Schema(type="STRING"), "entities": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
            "preferredDomains": types.Schema(type="ARRAY", items=types.Schema(type="STRING"))}, required=["question", "entities", "preferredDomains"])),
    types.FunctionDeclaration(name="inspect_url", description="Safely fetch a registered URL evidence item (including 'link clue' child items registered from messages/documents, and links discovered during research once registered via register_clue): redirect chain, final URL, title, visible text (paged), forms and links.",
        parameters=types.Schema(type="OBJECT", properties={"urlEvidenceId": types.Schema(type="STRING"), "purpose": types.Schema(type="STRING"),
            "cursor": types.Schema(type="STRING", nullable=True)}, required=["urlEvidenceId", "purpose"])),
    types.FunctionDeclaration(name="lookup_reputation", description="Configured reputation lookup for a url/domain/phone evidence item (clue items are listed in the inventory with their parent; `index` selects the nth link/number inside a larger item). No hit is not authentication.",
        parameters=types.Schema(type="OBJECT", properties={"evidenceId": types.Schema(type="STRING"), "kind": types.Schema(type="STRING", enum=["url", "domain", "phone"]),
            "index": types.Schema(type="INTEGER", nullable=True)}, required=["evidenceId", "kind"])),
    types.FunctionDeclaration(name="lookup_breach", description="Known-breach exposure check for an email identifier evidence item the person explicitly submitted for that purpose.",
        parameters=types.Schema(type="OBJECT", properties={"identifierEvidenceId": types.Schema(type="STRING")}, required=["identifierEvidenceId"])),
    types.FunctionDeclaration(name="research_application", description="Research an app's real identity: package/bundle, publisher, store listing, known abuse.",
        parameters=types.Schema(type="OBJECT", properties={"appEvidenceId": types.Schema(type="STRING"), "question": types.Schema(type="STRING")}, required=["appEvidenceId", "question"])),
    types.FunctionDeclaration(name="request_device_observation", description="Ask the app for a fresh supported device observation (only advertised capabilityIds).",
        parameters=types.Schema(type="OBJECT", properties={"capabilityId": types.Schema(type="STRING"), "fields": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
            "reason": types.Schema(type="STRING")}, required=["capabilityId", "fields", "reason"])),
    types.FunctionDeclaration(name="research_settings", description="Research official OEM/platform guidance for a settings target on the person's device profile.",
        parameters=types.Schema(type="OBJECT", properties={"target": types.Schema(type="STRING")}, required=["target"])),
    types.FunctionDeclaration(name="register_clue", description="Register a newly discovered link or phone number (e.g. from a fetched page or research) as addressable evidence so it can be inspected or looked up.",
        parameters=types.Schema(type="OBJECT", properties={"value": types.Schema(type="STRING"), "parentEvidenceId": types.Schema(type="STRING", nullable=True),
            "kind": types.Schema(type="STRING", enum=["url", "phone"])}, required=["value", "kind"])),
    types.FunctionDeclaration(name="ask_user", description="Only when no tool can establish a fact: record a question about the person's intent, actions or consent. Then return your final response with the question field set.",
        parameters=types.Schema(type="OBJECT", properties={"text": types.Schema(type="STRING"), "reasonNeeded": types.Schema(type="STRING")}, required=["text", "reasonNeeded"])),
]


class ToolContext:
    def __init__(self, owner: str, case: dict, job: dict, device: Optional[dict]):
        self.owner, self.case, self.job, self.device = owner, case, job, device
        self.sources: list[SourceReference] = []
        self.fingerprints: set[str] = set()
        self.pending_request: Optional[dict] = None
        self.tool_call_key: Optional[str] = None
        self.question: Optional[dict] = None
        self.research_calls = 0

    @property
    def case_id(self) -> str:
        return self.case["case_id"]


def _snippet(text: str) -> str:
    return re.sub(r"[^\x20-\x7E\n]", "", text)[:600]


async def _grounded(ctx: ToolContext, question: str, entities: list[str], preferred: list[str]) -> dict:
    if ctx.research_calls >= 6:
        return {"status": "budget_exhausted", "note": "research call budget for this turn reached"}
    ctx.research_calls += 1
    provider.require_capability(provider.TEXT_MODEL, "search")
    prompt = json.dumps({"question": question, "entities": entities[:32], "preferredDomains": preferred[:12]})
    try:
        result = await provider.generate(RESEARCH_SYSTEM, prompt, tools=[types.Tool(google_search=types.GoogleSearch())], capability="search")
    except provider.ProviderFailure as exc:
        return {"status": "unavailable", "failure": exc.code, "retryable": exc.retryable}
    registered = []
    for chunk in (result.grounding or {}).get("grounding_chunks", []) or (result.grounding or {}).get("groundingChunks", []):
        web = chunk.get("web") or {}
        if not web.get("uri"):
            continue
        host = re.sub(r"^https?://([^/]+).*$", r"\1", web["uri"]).lower()
        authority = "official" if any(host == d or host.endswith("." + d) for d in OFFICIAL_HINT_DOMAINS) else "unknown"
        source = SourceReference(id=str(uuid.uuid4()), url=web["uri"], title=(web.get("title") or host)[:200], retrieved_at=now_utc(), retrieval="search_result",
                                 authority=authority, authority_basis="Platform vendor support domain" if authority == "official" else "Search result; publisher not independently verified",
                                 evidence_ids=[])
        ctx.sources.append(source)
        registered.append({"sourceId": source.id, "title": source.title, "host": host, "authority": authority})
    mapping = await repo.add_sources(ctx.owner, ctx.case_id, ctx.sources)
    for entry in registered:
        entry["sourceId"] = mapping.get(entry["sourceId"], entry["sourceId"])
    # The complete research answer is retained as case evidence; the tool result carries a bounded view plus a read reference.
    snapshot = await ev.ingest_text(ctx.owner, ctx.case, f"research-{uuid.uuid4().hex[:12]}", result.text, kind="source_snapshot", origin="external_source",
                                    label=f"research: {question[:60]}", coverage=ev.Coverage(status="examined", unit="characters", total=len(result.text), examined=len(result.text)),
                                    meta={"sourceIds": [e["sourceId"] for e in registered]})
    return {"status": "ok", "answer": result.text[:8000], "answerEvidenceId": snapshot.id, "answerCharacters": len(result.text),
            "truncatedInline": len(result.text) > 8000, "sources": registered, "providerComplete": result.finish_reason == "STOP",
            "note": ("Full answer stored as evidence; use read_evidence for the rest. " if len(result.text) > 8000 else "") +
                    ("Search results are leads; a source's own claims are not verification. Authority labels are hints from the publisher domain, not conclusions." if registered else "No grounded sources were returned; treat the answer as model recollection only.")}


async def _url_text(ctx: ToolContext, evidence_id: str) -> str:
    row = await repo.get_evidence(ctx.owner, ctx.case_id, evidence_id)
    if row["kind"] != "url":
        raise ValueError("not_url")
    return (await repo.read_bytes(ctx.owner, ctx.case_id, evidence_id)).decode("utf-8", errors="replace").strip()


async def inspect_url(ctx: ToolContext, args: dict) -> dict:
    try:
        url = await _url_text(ctx, args["urlEvidenceId"])
    except ValueError:
        return {"status": "invalid", "note": "That evidence item is not a URL."}
    if re.search(r"(?i)[?&](token|code|otp|session|sig|signature|auth|key)=", url):
        return {"status": "blocked", "note": "This link carries a credential-like parameter; Apollo does not follow links whose retrieval may itself perform a sensitive action.", "url": url}
    try:
        chain = await intel.expand_redirects(url)
    except Exception:  # noqa: BLE001
        chain = [url]
    final = chain[-1] if chain else url
    try:
        page = await webcrawl.fetch_page(final)
        source = SourceReference(id=str(uuid.uuid4()), url=page.final_url, title=(page.title or final)[:200], retrieved_at=now_utc(), retrieval="fetched",
                                 authority="self_claimed", authority_basis="Content fetched from the destination itself", evidence_ids=[args["urlEvidenceId"]])
        ctx.sources.append(source)
        source.id = (await repo.add_sources(ctx.owner, ctx.case_id, [source])).get(source.id, source.id)
        offset = int(args.get("cursor") or 0)
        text = page.text or ""
        await ev.mark_examined(ctx.owner, ctx.case_id, args["urlEvidenceId"], 0, 1, 1)
        return {"status": "fetched", "sourceId": source.id, "originalUrl": url, "redirectChain": chain, "finalUrl": page.final_url, "title": page.title,
                "forms": page.forms, "buttons": page.buttons, "linkHosts": page.links_sample, "text": text[offset:offset + 6000],
                "nextCursor": str(offset + 6000) if len(text) > offset + 6000 else None, "coverage": page.coverage}
    except webcrawl.CrawlBlocked as exc:
        await repo.update_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"], {"$set": {"coverage.status": "unavailable", "coverage.reason": "fetch blocked by safety policy"}})
        return {"status": "blocked", "originalUrl": url, "redirectChain": chain, "note": f"Fetch refused by Apollo's safe-fetch policy ({exc}). This is a limitation, not proof of fraud or safety."}
    except Exception:  # noqa: BLE001 — DNS/HTTP errors are tool results
        await repo.update_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"], {"$set": {"coverage.status": "unavailable", "coverage.reason": "destination unreachable"}})
        return {"status": "unavailable", "originalUrl": url, "redirectChain": chain, "note": "The destination could not be fetched (DNS/connection/HTTP failure). Unavailable is not takedown, unauthorised ownership or safety."}


async def lookup_reputation(ctx: ToolContext, args: dict) -> dict:
    row = await repo.get_evidence(ctx.owner, ctx.case_id, args["evidenceId"])
    value = (await repo.read_bytes(ctx.owner, ctx.case_id, args["evidenceId"])).decode("utf-8", errors="replace").strip()
    selector = int(args.get("index") or 0)
    if args["kind"] == "phone":
        matches = list(ev.PHONE_RE.finditer(value))
        if not matches:
            return {"status": "invalid", "note": "No phone number found in that evidence item."}
        if selector >= len(matches):
            return {"status": "invalid", "note": f"Only {len(matches)} number(s) in this item.", "numbers": [m.group(0) for m in matches][:20]}
        number = re.sub(r"[\s().-]", "", matches[selector].group(0))
        region = None
        if not number.startswith("+"):
            locale = (ctx.device or {}).get("locale", "") or ""
            region = locale.split("-")[-1].upper() if "-" in locale else None
            if not region:
                return {"status": "unresolved", "number": number, "note": "Number has no international prefix and the device locale gives no region; ask for the country only if it changes the assessment."}
        try:
            parsed = phonenumbers.parse(number, region)
            e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except phonenumbers.NumberParseException:
            return {"status": "invalid", "number": number, "note": "Not a valid phone number for the inferred region."}
        result = await phonerisk.check_phone_risk(e164, phonenumbers.region_code_for_number(parsed))
        data = result.model_dump(mode="json", include={"number", "valid", "active", "fraud_score", "recent_abuse", "risky", "voip", "line_type", "carrier", "country", "source", "checked_at"})
        return {"status": "ok", **data, "note": "Caller-ID or a reputation score never authenticates who is calling."}
    if row["kind"] != "url" and args["kind"] in ("url", "domain"):
        matches = ev.URL_RE.findall(value)
        if not matches:
            return {"status": "invalid", "note": "No URL found in that evidence item."}
        if selector >= len(matches):
            return {"status": "invalid", "note": f"Only {len(matches)} link(s) in this item.", "links": matches[:25]}
        value = matches[selector]
    result = await intel.run_intel_check(args["kind"], value)
    return {"status": "ok", "verdict": result.verdict, "threatTypes": result.threat_types, "coverage": result.coverage,
            "sources": [s.model_dump(mode="json") for s in result.sources], "checkedAt": result.checked_at.isoformat(),
            "domainInfo": result.domain_info.model_dump(mode="json") if result.domain_info else None,
            "note": "A clear result means no listed match at this time, not that the destination is legitimate."}


async def lookup_breach(ctx: ToolContext, args: dict) -> dict:
    value = (await repo.read_bytes(ctx.owner, ctx.case_id, args["identifierEvidenceId"])).decode("utf-8", errors="replace").strip()
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", value)
    if not match:
        return {"status": "invalid", "note": "No email identifier in that evidence item."}
    if not HIBP_API_KEY:
        return {"status": "unconfigured", "note": "Breach intelligence is not configured on this server; do not infer exposure either way."}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(f"https://haveibeenpwned.com/api/v3/breachedaccount/{match.group(0).lower()}", params={"truncateResponse": "true"},
                                 headers={"hibp-api-key": HIBP_API_KEY, "user-agent": "Apollo-GuardDog"})
    except httpx.HTTPError:
        return {"status": "unavailable", "note": "Breach service did not answer."}
    if r.status_code == 404:
        return {"status": "clear", "note": "No known breach lists this identifier; unreported breaches and recent phishing will not appear."}
    if r.status_code != 200:
        return {"status": "unavailable", "httpStatus": r.status_code}
    return {"status": "listed", "breaches": [b.get("Name") for b in r.json()][:50], "note": "Historical exposure within scope; not proof of current account takeover."}


async def request_device_observation(ctx: ToolContext, args: dict) -> dict:
    capabilities = (ctx.device or {}).get("capabilityIds", [])
    if args["capabilityId"] not in capabilities:
        return {"status": "unavailable", "capabilityId": args["capabilityId"], "note": "This device profile does not advertise that capability. Explain what remains unknown; do not generate values.",
                "advertised": capabilities}
    fingerprint = f"device:{args['capabilityId']}"
    if fingerprint in ctx.fingerprints:
        return {"status": "duplicate", "note": "This observation was already requested in this turn."}
    if ctx.pending_request:
        return {"status": "deferred", "note": "One device observation is collected at a time. Request this capability again after the pending result arrives."}
    ctx.fingerprints.add(fingerprint)
    call_key = ctx.tool_call_key or f"legacy:{args['capabilityId']}"
    existing = await db.investigation_device_requests.find_one(
        {"owner_id": ctx.owner, "job_id": ctx.job["job_id"], "tool_call_key": call_key}, {"_id": 0}
    )
    if existing:
        ctx.pending_request = existing["request"]
        return {"status": "pending", "requestId": existing["request_id"], "note": "The existing durable observation request is still pending; the investigation remains paused."}
    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo:{ctx.owner}:{ctx.case_id}:{ctx.job['job_id']}:{call_key}"))
    request = {"id": request_id, "caseId": ctx.case_id, "caseRevision": ctx.case["revision"], "capabilityId": args["capabilityId"],
               "fields": [str(f) for f in args.get("fields", [])][:32], "reason": str(args.get("reason", ""))[:300],
               "expiresAt": min(repo.utc(ctx.case["expires_at"]), now_utc() + timedelta(seconds=120)).isoformat()}
    try:
        await db.investigation_device_requests.insert_one({"owner_id": ctx.owner, "case_id": ctx.case_id, "request_id": request["id"], "job_id": ctx.job["job_id"],
                                                            "tool_call_key": call_key, "request": request, "fulfilled": False, "submission": None, "created_at": now_utc()})
    except DuplicateKeyError:
        winner = await db.investigation_device_requests.find_one(
            {"owner_id": ctx.owner, "job_id": ctx.job["job_id"], "tool_call_key": call_key}, {"_id": 0}
        )
        if not winner:
            raise
        request = winner["request"]
    ctx.pending_request = request
    return {"status": "pending", "requestId": request["id"], "note": "The app is being asked for this observation. The investigation pauses until it returns."}


async def research_settings(ctx: ToolContext, args: dict) -> dict:
    device = DeviceProfile.model_validate(ctx.device) if ctx.device else None
    if not device:
        return {"status": "unresolved", "note": "No device profile; ask which platform/manufacturer if it changes the instructions."}
    entities = [device.platform, *(x for x in (device.manufacturer, device.model, device.os_version) if x)]
    result = await _grounded(ctx, f"Exact steps to {args['target']} on {' '.join(entities)}. Cite official manufacturer or platform support pages.", entities, list(OFFICIAL_HINT_DOMAINS))
    official = [s for s in result.get("sources", []) if s["authority"] == "official"]
    # "exact" requires the manufacturer AND the platform/OS to appear in the SAME source; an OEM name alone (e.g. a Samsung
    # page about a different OS version) is not an exact match. Otherwise a platform-wide official page is "platform_only".
    def _mentions(src: dict, token: str) -> bool:
        t = token.lower()
        return t in src.get("title", "").lower() or t in src.get("host", "").lower() or t in src.get("snippet", "").lower()
    os_tokens = [device.platform, *([device.os_version.split()[0]] if device.os_version else [])]
    exact = bool(device.manufacturer and any(_mentions(s, device.manufacturer) and any(_mentions(s, o) for o in os_tokens) for s in result.get("sources", [])))
    result["match"] = "exact" if exact else ("platform_only" if official else "unresolved")
    result["note"] = ("Manufacturer- and platform-matched guidance found." if exact
                      else "Instructions from a platform-wide source apply generally; a page matching both the manufacturer and this OS is required for an exact match.")
    return result


async def ask_user(ctx: ToolContext, args: dict) -> dict:
    ctx.question = {"id": str(uuid.uuid4()), "text": str(args["text"])[:600], "reasonNeeded": str(args["reasonNeeded"])[:300], "answerType": "text", "choices": []}
    return {"status": "recorded", "questionId": ctx.question["id"], "note": "Now return your final JSON response with completion 'waiting_user' and this question."}


async def execute(ctx: ToolContext, name: str, args: dict) -> dict:
    try:
        if name == "read_evidence":
            rng = args.get("range") or {}
            return await ev.read_text(ctx.owner, ctx.case_id, str(args["evidenceId"]), rng.get("start"), rng.get("end"), args.get("pages"))
        if name == "continue_document":
            return await ev.continue_document(ctx.owner, ctx.case, str(args["evidenceId"]), int(args["startPage"]), int(args.get("pageCount") or ev.MAX_PAGES))
        if name == "research_public_sources":
            return await _grounded(ctx, str(args["question"]), [str(e) for e in args.get("entities", [])], [str(d) for d in args.get("preferredDomains", [])])
        if name == "inspect_url":
            return await inspect_url(ctx, args)
        if name == "lookup_reputation":
            return await lookup_reputation(ctx, args)
        if name == "lookup_breach":
            return await lookup_breach(ctx, args)
        if name == "research_application":
            label = (await repo.get_evidence(ctx.owner, ctx.case_id, str(args["appEvidenceId"]))).get("label", "")
            text = (await repo.read_bytes(ctx.owner, ctx.case_id, str(args["appEvidenceId"]))).decode("utf-8", errors="replace")
            identifiers = re.findall(r"\b[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}\b", text)[:3]
            return await _grounded(ctx, f"{args['question']} Identify the real publisher, official store listing and any known abuse.", [*identifiers, label][:5], ["play.google.com", "apps.apple.com"])
        if name == "request_device_observation":
            return await request_device_observation(ctx, args)
        if name == "research_settings":
            return await research_settings(ctx, args)
        if name == "ask_user":
            return await ask_user(ctx, args)
        if name == "register_clue":
            value = str(args["value"]).strip()
            if args["kind"] == "url" and not ev.URL_RE.fullmatch(value):
                return {"status": "invalid", "note": "Not an http(s) URL."}
            parent = str(args.get("parentEvidenceId") or "")
            item = await (ev.ingest_url if args["kind"] == "url" else ev.ingest_text)(ctx.owner, ctx.case, f"clue-{uuid.uuid4().hex[:12]}", value, parent_id=parent or None,
                                                                                         label=("discovered link" if args["kind"] == "url" else "discovered number"))
            return {"status": "registered", "evidenceId": item.id, "kind": item.kind}
        return {"status": "unknown_tool"}
    except Exception as exc:  # noqa: BLE001 — a tool failure is evidence of a limitation, never a case failure
        from fastapi import HTTPException
        if isinstance(exc, HTTPException):
            return {"status": "unavailable", "error": exc.detail.get("error", {}).get("code") if isinstance(exc.detail, dict) else "not_found"}
        return {"status": "unavailable", "error": type(exc).__name__}
