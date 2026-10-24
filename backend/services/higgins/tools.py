"""Typed read-only observation tools kept for the investigation case (spec §9).

None of these calls Gemini: a Magnum DI investigation makes exactly one Gemini call (coordinator.py),
so there is no function-calling dispatcher, no nested research call and no tool round.
Ownership and case identity come from the coordinator context, never from model arguments.
"""
from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Optional

from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from services import intel, webcrawl
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.contracts import SourceReference

OFFICIAL_HINT_DOMAINS = ("support.google.com", "support.apple.com", "support.microsoft.com", "developer.android.com", "samsung.com", "learn.microsoft.com")


def grounding_sources(grounding: Optional[dict]) -> list[SourceReference]:
    """The web pages Google Search grounded a Gemini answer on, as case sources. Search results are
    leads, not verification; the authority label is only a hint from the publisher domain."""
    sources = []
    for chunk in (grounding or {}).get("grounding_chunks", []) or (grounding or {}).get("groundingChunks", []):
        web = chunk.get("web") or {}
        if not web.get("uri"):
            continue
        host = re.sub(r"^https?://([^/]+).*$", r"\1", web["uri"]).lower()
        authority = "official" if any(host == d or host.endswith("." + d) for d in OFFICIAL_HINT_DOMAINS) else "unknown"
        sources.append(SourceReference(id=str(uuid.uuid4()), url=web["uri"], title=(web.get("title") or host)[:200], retrieved_at=now_utc(), retrieval="search_result",
                                       authority=authority, authority_basis="Platform vendor support domain" if authority == "official" else "Search result; publisher not independently verified",
                                       evidence_ids=[]))
    return sources


class ToolContext:
    def __init__(self, owner: str, case: dict, job: dict, device: Optional[dict]):
        self.owner, self.case, self.job, self.device = owner, case, job, device
        self.sources: list[SourceReference] = []
        self.fingerprints: set[str] = set()
        self.pending_request: Optional[dict] = None
        self.tool_call_key: Optional[str] = None

    @property
    def case_id(self) -> str:
        return self.case["case_id"]


async def _url_text(ctx: ToolContext, evidence_id: str) -> str:
    row = await repo.get_evidence(ctx.owner, ctx.case_id, evidence_id)
    if row["kind"] != "url":
        raise ValueError("not_url")
    return (await repo.read_bytes(ctx.owner, ctx.case_id, evidence_id)).decode("utf-8", errors="replace").strip()


async def inspect_url(ctx: ToolContext, args: dict) -> dict:
    url_row = await repo.get_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"])
    try:
        url = await _url_text(ctx, args["urlEvidenceId"])
    except ValueError:
        return {"status": "invalid", "note": "That evidence item is not a URL."}
    if re.search(r"(?i)[?&](token|code|otp|session|sig|signature|auth|key)=", url):
        return {"status": "blocked", "note": "This link carries a credential-like parameter; Apollo does not follow links whose retrieval may itself perform a sensitive action.", "url": url}
    url_meta = await repo.evidence_meta(url_row)
    offset = int(args.get("cursor") or 0)
    snapshot_id = url_meta.get("sourceSnapshotId")
    if snapshot_id:
        try:
            snapshot = await repo.get_evidence(ctx.owner, ctx.case_id, snapshot_id)
            snapshot_meta = await repo.evidence_meta(snapshot)
            text = (await repo.read_bytes(ctx.owner, ctx.case_id, snapshot_id)).decode("utf-8", errors="replace")
            end = min(len(text), offset + 4000)
            return {"status": "fetched", "sourceId": snapshot_meta.get("sourceId"), "sourceSnapshotId": snapshot_id,
                    "originalUrl": url, "redirectChain": snapshot_meta.get("redirectChain", [url]), "finalUrl": snapshot_meta.get("finalUrl", url),
                    "title": snapshot_meta.get("title"), "forms": snapshot_meta.get("forms", []), "buttons": snapshot_meta.get("buttons", []),
                    "linkHosts": snapshot_meta.get("linkHosts", []), "text": text[offset:end], "nextCursor": str(end) if end < len(text) else None,
                    "coverage": snapshot_meta.get("fetchCoverage"), "_pendingMark": [snapshot_id, offset, end, len(text)]}
        except Exception:  # a missing committed snapshot is an explicit failure; never silently refetch changed content
            return {"status": "unavailable", "originalUrl": url, "note": "The retained source snapshot is unavailable; this continuation was not refetched from a potentially changed page."}
    try:
        chain = await intel.expand_redirects(url)
    except Exception:  # noqa: BLE001
        chain = [url]
    final = chain[-1] if chain else url
    try:
        page = await webcrawl.fetch_page(final)
        text = page.text or ""
        snapshot = await ev.ingest_text(ctx.owner, ctx.case, f"{url_row['client_item_id']}.source", text, kind="source_snapshot", origin="external_source",
                                        parent_id=args["urlEvidenceId"], label=f"source snapshot: {(page.title or final)[:55]}",
                                        meta={"redirectChain": chain, "finalUrl": page.final_url, "title": page.title, "forms": page.forms,
                                              "buttons": page.buttons, "linkHosts": page.links_sample, "fetchCoverage": page.coverage})
        source = SourceReference(id=str(uuid.uuid4()), url=page.final_url, title=(page.title or final)[:200], retrieved_at=now_utc(), retrieval="fetched",
                                 authority="self_claimed", authority_basis="Content fetched from the destination itself", evidence_ids=[args["urlEvidenceId"], snapshot.id])
        ctx.sources.append(source)
        source.id = (await repo.add_sources(ctx.owner, ctx.case_id, [source])).get(source.id, source.id)
        snapshot_row = await repo.get_evidence(ctx.owner, ctx.case_id, snapshot.id)
        snapshot_meta = await repo.evidence_meta(snapshot_row)
        snapshot_meta["sourceId"] = source.id
        await repo.update_evidence(ctx.owner, ctx.case_id, snapshot.id, {"$set": {"meta_ciphertext": repo.enc_json(snapshot_meta)}})
        url_meta.update({"sourceSnapshotId": snapshot.id, "sourceId": source.id})
        await repo.update_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"], {"$set": {"meta_ciphertext": repo.enc_json(url_meta)}})
        end = min(len(text), offset + 4000)
        await ev.mark_examined(ctx.owner, ctx.case_id, args["urlEvidenceId"], 0, 1, 1)
        return {"status": "fetched", "sourceId": source.id, "sourceSnapshotId": snapshot.id, "originalUrl": url, "redirectChain": chain,
                "finalUrl": page.final_url, "title": page.title, "forms": page.forms, "buttons": page.buttons, "linkHosts": page.links_sample,
                "text": text[offset:end], "nextCursor": str(end) if end < len(text) else None, "coverage": page.coverage,
                "_pendingMark": [snapshot.id, offset, end, len(text)]}
    except webcrawl.CrawlBlocked as exc:
        await repo.update_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"], {"$set": {"coverage.status": "unavailable", "coverage.reason": "fetch blocked by safety policy"}})
        return {"status": "blocked", "originalUrl": url, "redirectChain": chain, "note": f"Fetch refused by Apollo's safe-fetch policy ({exc}). This is a limitation, not proof of fraud or safety."}
    except Exception:  # noqa: BLE001 — DNS/HTTP errors are tool results
        await repo.update_evidence(ctx.owner, ctx.case_id, args["urlEvidenceId"], {"$set": {"coverage.status": "unavailable", "coverage.reason": "destination unreachable"}})
        return {"status": "unavailable", "originalUrl": url, "redirectChain": chain, "note": "The destination could not be fetched (DNS/connection/HTTP failure). Unavailable is not takedown, unauthorised ownership or safety."}


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
    fields = [str(f) for f in args.get("fields", [])]
    reason = str(args.get("reason", ""))
    if len(fields) > 32 or len(reason) > 300:
        return {"status": "invalid", "note": "Request at most 32 fields and keep the reason within 300 characters; no fields were silently omitted."}
    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo:{ctx.owner}:{ctx.case_id}:{ctx.job['job_id']}:{call_key}"))
    request = {"id": request_id, "caseId": ctx.case_id, "caseRevision": ctx.case["revision"], "capabilityId": args["capabilityId"],
               "fields": fields, "reason": reason,
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
