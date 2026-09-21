"""Evidence ingress: inventory, secret handling, safe extraction, coverage ledger and model-context parts (spec §6).

Originals are stored as encrypted chunks for the case lifetime only. Extraction never executes content.
"""
from __future__ import annotations

import io
import re
import uuid
import zipfile
from datetime import datetime
from typing import Optional

from google.genai import types

from core.db import now_utc
from core.redaction import redact_investigation_secrets
from services.higgins import repository as repo
from services.higgins.contracts import Coverage, EvidenceItem, OmittedRange, Range, Transformation
from services.higgins.repository import http

MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_CASE_BYTES = 64 * 1024 * 1024
MAX_PAGES = 200
MAX_IMAGE_PIXELS = 40_000_000
MAX_EXPANDED = 64 * 1024 * 1024
INLINE_TEXT_CHARS = 24_000  # longer text is read by range through read_evidence
READ_CHARS = 30_000
SUPPORTED = {"application/pdf": "document", "image/png": "image", "image/jpeg": "image", "text/plain": "text",
             "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document"}
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def sniff(data: bytes, declared: str) -> str:
    head = data[:16]
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"MZ"):
        return "application/vnd.microsoft.portable-executable"
    if head.startswith(b"\x7fELF"):
        return "application/x-elf"
    if head.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = archive.namelist()
                if any(n.startswith("word/") for n in names):
                    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                return "application/zip"
        except zipfile.BadZipFile:
            return "application/octet-stream"
    if head.startswith(b"Rar!") or head.startswith(b"\x1f\x8b") or head.startswith(b"7z\xbc\xaf"):
        return "application/x-archive"
    try:
        data[:4096].decode("utf-8")
        return "text/plain" if declared.startswith("text/") or not declared else declared
    except UnicodeDecodeError:
        return "application/octet-stream"


def _redact(text: str) -> tuple[str, list[Transformation]]:
    clean = redact_investigation_secrets(text)
    if clean == text:
        return text, []
    return clean, [Transformation(kind="secret_redaction", description="Authentication secrets (passwords/codes/tokens) were replaced with [redacted] before storage; surrounding context retained.")]


async def _case_budget(owner: str, case_id: str, adding: int) -> None:
    total = 0
    async for row in repo.db.investigation_evidence.find({"owner_id": owner, "case_id": case_id, "byte_length": {"$ne": None}}, {"_id": 0, "byte_length": 1}):
        total += row["byte_length"]
    if total + adding > MAX_CASE_BYTES:
        raise http(413, "budget_exhausted", f"This investigation's active payload budget ({MAX_CASE_BYTES // (1024 * 1024)} MiB) would be exceeded. Remove an item or start a new check.")


async def ingest_text(owner: str, case: dict, client_item_id: str, text: str, *, kind: str = "text", origin: str = "user_submission",
                      parent_id: Optional[str] = None, label: str = "", transformations: Optional[list[Transformation]] = None,
                      coverage: Optional[Coverage] = None, meta: Optional[dict] = None, simulation=None, observed_at: Optional[datetime] = None) -> EvidenceItem:
    clean, redactions = _redact(text)
    item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=client_item_id, origin=origin, kind=kind, parent_id=parent_id,
                        collected_at=now_utc(), observed_at=observed_at, expires_at=repo.utc(case["expires_at"]), media_type="text/plain",
                        byte_length=len(clean.encode("utf-8")), simulation=simulation,
                        coverage=coverage or Coverage(status="not_started", unit="characters", total=len(clean), examined=0),
                        transformations=[*(transformations or []), *redactions], label=label or ("link" if kind == "url" else "text"))
    await repo.insert_evidence(owner, item, {**(meta or {}), "urls": URL_RE.findall(clean)[:512] if kind == "text" else []})
    await repo.store_bytes(owner, case["case_id"], item.id, clean.encode("utf-8"), item.expires_at)
    return item


async def ingest_url(owner: str, case: dict, client_item_id: str, url: str, *, parent_id: Optional[str] = None, label: str = "") -> EvidenceItem:
    url = url.strip()
    if not re.match(r"(?i)^https?://", url):
        url = "https://" + url
    host = re.sub(r"^https?://([^/]+).*$", r"\1", url, flags=re.I)
    return await ingest_text(owner, case, client_item_id, url, kind="url", parent_id=parent_id, label=label or host[:80],
                             coverage=Coverage(status="not_started", unit="items", total=1, examined=0))


async def ingest_observation(owner: str, case: dict, client_item_id: str, result: dict, *, parent_id: Optional[str] = None) -> EvidenceItem:
    import json
    text = json.dumps({"capabilityId": result["capabilityId"], "status": result["status"], "values": result.get("values", {})}, ensure_ascii=False)
    observed = datetime.fromisoformat(result["observedAt"].replace("Z", "+00:00")) if result.get("observedAt") else None
    return await ingest_text(owner, case, client_item_id, text, kind="observation", origin="device_observation", parent_id=parent_id,
                             label=f"observation: {result['capabilityId']}"[:80], simulation=result.get("simulation"), observed_at=observed,
                             coverage=Coverage(status="examined" if result["status"] == "observed" else "unavailable", unit="items", total=1,
                                               examined=1 if result["status"] == "observed" else 0, reason=None if result["status"] == "observed" else result["status"]),
                             meta={"deviceResult": result})


def _pdf_pages(data: bytes) -> tuple[list[str], list[str], list[int]]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError("encrypted")
    pages, links, unreadable = [], [], []
    for index, page in enumerate(reader.pages[:MAX_PAGES]):
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001 — malformed page becomes an explicit gap
            text, unreadable = "", [*unreadable, index + 1]
        if not text.strip():
            unreadable.append(index + 1)
        pages.append(text)
        for annotation in page.get("/Annots") or []:
            try:
                obj = annotation.get_object()
                uri = obj.get("/A", {}).get("/URI")
                if uri:
                    links.append(f"page {index + 1}: {uri}")
            except Exception:  # noqa: BLE001
                continue
    return pages, links, sorted(set(unreadable))


def _docx_text(data: bytes) -> tuple[list[str], list[str]]:
    import docx
    document = docx.Document(io.BytesIO(data))
    paragraphs = [p.text for p in document.paragraphs]
    links = [rel.target_ref for rel in document.part.rels.values() if "hyperlink" in rel.reltype and rel.is_external]
    return paragraphs, links


async def ingest_file(owner: str, case: dict, meta_in: dict, data: bytes) -> EvidenceItem:
    if len(data) > MAX_FILE_BYTES:
        raise http(413, "budget_exhausted", f"Files above {MAX_FILE_BYTES // (1024 * 1024)} MiB are not accepted. The item stays listed as not received.")
    await _case_budget(owner, case["case_id"], len(data))
    detected = sniff(data, meta_in["mediaType"])
    transformations = []
    if detected != meta_in["mediaType"]:
        transformations.append(Transformation(kind="normalise", description=f"Declared type {meta_in['mediaType']} but bytes match {detected}; the detected type is used."))
    kind = SUPPORTED.get(detected, meta_in["kind"] if meta_in["kind"] != "document" else "attachment")
    expires = repo.utc(case["expires_at"])
    item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=meta_in["clientItemId"], origin="user_submission", kind=kind,
                        parent_id=meta_in.get("parentId"), collected_at=now_utc(), expires_at=expires, media_type=detected, byte_length=len(data),
                        coverage=Coverage(status="not_started", unit="bytes", total=len(data), examined=0), transformations=transformations,
                        label=f"{kind}: {re.sub(r'[^A-Za-z0-9._ -]', '_', meta_in['filename'])[:60]}")
    await repo.insert_evidence(owner, item, {"filename": meta_in["filename"], "declaredMediaType": meta_in["mediaType"], "detectedMediaType": detected})
    await repo.store_bytes(owner, case["case_id"], item.id, data, expires)
    await _derive(owner, case, item, data, detected)
    return item


async def _derive(owner: str, case: dict, item: EvidenceItem, data: bytes, detected: str) -> None:
    """Parser extraction is recorded as its own derived evidence with page/offset identities. Parsing is not examination."""
    coverage_update: dict = {}
    try:
        if detected == "application/pdf" or detected.endswith("wordprocessingml.document"):
            if detected == "application/pdf":
                pages, links, unreadable = _pdf_pages(data)
            else:
                paragraphs, links = _docx_text(data)
                pages, unreadable = ["\n".join(paragraphs)], []
            offsets, text, cursor = [], "", 0
            for number, page in enumerate(pages, start=1):
                block = f"\n\n[page {number}]\n{page}"
                offsets.append({"page": number, "start": cursor, "end": cursor + len(block)})
                text += block
                cursor += len(block)
            if len(text) > MAX_EXPANDED:
                raise ValueError("expanded")
            link_text = "\n".join(links)
            derived = await ingest_text(owner, case, f"{item.client_item_id}.text", text + ("\n\n[links]\n" + link_text if link_text else ""), parent_id=item.id,
                                        label=f"extracted text ({len(pages)} pages)", meta={"pages": offsets, "links": links[:512]},
                                        transformations=[Transformation(kind="decode", description=f"Parser text layer of {len(pages)} page(s) with page markers; {len(links)} link target(s) collected. Scanned/unreadable pages: {unreadable or 'none'}.")])
            coverage_update = {"status": "partial" if unreadable else "not_started", "unit": "pages", "total": len(pages), "examined": 0,
                               "omittedRanges": [{"start": p - 1, "end": p, "reason": "no extractable text layer (scanned or image-only page)"} for p in unreadable],
                               "materialGap": bool(unreadable), "reason": "parser extraction complete; model examination pending"}
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage": coverage_update, "related_evidence_ids": [derived.id]}})
        elif detected in ("image/png", "image/jpeg"):
            from PIL import Image
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("pixels")
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage.reason": "original image available to Gemini vision; not yet examined"}})
        elif detected == "text/plain":
            derived = await ingest_text(owner, case, f"{item.client_item_id}.text", data.decode("utf-8", errors="replace"), parent_id=item.id, label="file text")
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"related_evidence_ids": [derived.id]}})
        else:
            reason = {"application/zip": "archive contents are not expanded; list only", "application/x-archive": "compressed archive is not expanded",
                      "application/vnd.microsoft.portable-executable": "Windows executable: signature inspected, never executed",
                      "application/x-elf": "executable binary: signature inspected, never executed"}.get(detected, "unsupported format: signature and size only")
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage": {"status": "unavailable", "unit": "bytes", "total": len(data), "examined": 16,
                                                                                    "examinedRanges": [{"start": 0, "end": 16}], "omittedRanges": [{"start": 16, "end": len(data), "reason": reason}],
                                                                                    "reason": reason, "materialGap": True}}})
    except ValueError as exc:
        reason = {"encrypted": "document is encrypted; contents cannot be read", "expanded": "extracted content exceeds the expansion budget", "pixels": "image exceeds the 40-megapixel decode budget"}.get(str(exc), "malformed content")
        await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage": {"status": "unavailable", "unit": "bytes", "total": len(data), "examined": 0,
                                                                                "omittedRanges": [{"start": 0, "end": len(data), "reason": reason}], "reason": reason, "materialGap": True}}})
    except Exception:  # noqa: BLE001 — parser failure is an explicit gap, never a clean result
        await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage.status": "unavailable", "coverage.reason": "parser failed; content not examined", "coverage.materialGap": True}})


def _union(ranges: list[dict], start: int, end: int) -> list[dict]:
    merged, added = [], False
    for r in sorted([*ranges, {"start": start, "end": end}], key=lambda x: x["start"]):
        if merged and r["start"] <= merged[-1]["end"]:
            merged[-1]["end"] = max(merged[-1]["end"], r["end"])
        else:
            merged.append(dict(r))
    return merged if added or True else merged


async def mark_examined(owner: str, case_id: str, evidence_id: str, start: int, end: int, total: Optional[int]) -> None:
    row = await repo.get_evidence(owner, case_id, evidence_id)
    coverage = row["coverage"]
    ranges = _union(coverage.get("examinedRanges", []), start, end)
    examined = sum(r["end"] - r["start"] for r in ranges)
    total = total if total is not None else coverage.get("total")
    complete = total is not None and examined >= total
    await repo.update_evidence(owner, case_id, evidence_id, {"$set": {"coverage.examinedRanges": ranges, "coverage.examined": min(examined, total or examined),
                                                                      "coverage.status": "examined" if complete else "partial", "coverage.materialGap": not complete and bool(total)}})
    if row.get("parent_id"):
        meta = await repo.evidence_meta(row)
        pages = meta.get("pages") or []
        parent_update = {"coverage.status": "examined" if complete else "partial"}
        if pages:
            covered = [p for p in pages if any(r["start"] < p["end"] and r["end"] > p["start"] for r in ranges)]
            parent_update["coverage.examined"] = len(covered)
            parent_update["coverage.examinedRanges"] = [{"start": p["page"] - 1, "end": p["page"]} for p in covered]
        await repo.update_evidence(owner, case_id, row["parent_id"], {"$set": parent_update})


async def read_text(owner: str, case_id: str, evidence_id: str, start: Optional[int], end: Optional[int], pages: Optional[list[int]]) -> dict:
    row = await repo.get_evidence(owner, case_id, evidence_id)
    if row["kind"] in ("image", "document", "attachment", "audio"):
        children = row.get("related_evidence_ids") or []
        if row["kind"] == "image":
            return {"evidenceId": evidence_id, "kind": "image", "note": "Image parts are supplied inline to the model; describe what you observe in the image itself.",
                    "coverage": row["coverage"]}
        if not children:
            return {"evidenceId": evidence_id, "kind": row["kind"], "availability": "unavailable", "coverage": row["coverage"], "note": row["coverage"].get("reason")}
        row = await repo.get_evidence(owner, case_id, children[0])
        evidence_id = row["evidence_id"]
    text = (await repo.read_bytes(owner, case_id, evidence_id)).decode("utf-8", errors="replace")
    meta = await repo.evidence_meta(row)
    if pages and meta.get("pages"):
        selected = [p for p in meta["pages"] if p["page"] in pages]
        if not selected:
            return {"evidenceId": evidence_id, "error": "unknown page numbers", "availablePages": len(meta["pages"])}
        start, end = selected[0]["start"], selected[-1]["end"]
    start = max(0, start or 0)
    end = min(len(text), end if end is not None else start + READ_CHARS, start + READ_CHARS)
    await mark_examined(owner, case_id, evidence_id, start, end, len(text))
    return {"evidenceId": evidence_id, "totalCharacters": len(text), "start": start, "end": end, "content": text[start:end],
            "hasMore": end < len(text), "pages": meta.get("pages", [])[:MAX_PAGES] if pages is None and meta.get("pages") else None}


async def model_parts(owner: str, case: dict, rows: list[dict]) -> tuple[list[types.Part], list[dict]]:
    """Inline short text and images; long text is summarised by inventory and read by range via tools."""
    parts, inventory = [], []
    for row in rows:
        entry = {"evidenceId": row["evidence_id"], "kind": row["kind"], "origin": row["origin"], "label": row.get("label", ""), "parentId": row.get("parent_id"),
                 "availability": row["availability"], "coverage": row["coverage"], "simulation": row.get("simulation"), "transformations": row.get("transformations", [])}
        if row["availability"] != "available":
            inventory.append(entry)
            continue
        if row["kind"] in ("text", "url", "observation"):
            text = (await repo.read_bytes(owner, case["case_id"], row["evidence_id"])).decode("utf-8", errors="replace")
            if len(text) <= INLINE_TEXT_CHARS:
                entry["content"] = text
                if row["coverage"].get("unit") == "characters":
                    await mark_examined(owner, case["case_id"], row["evidence_id"], 0, len(text), len(text))
            else:
                entry["content"] = text[:2000]
                entry["note"] = f"{len(text)} characters total; only the first 2000 are inline. Use read_evidence with ranges/pages to examine the rest before concluding."
                await mark_examined(owner, case["case_id"], row["evidence_id"], 0, 2000, len(text))
        elif row["kind"] == "image":
            data = await repo.read_bytes(owner, case["case_id"], row["evidence_id"])
            parts.append(types.Part.from_bytes(data=data, mime_type=row["media_type"]))
            entry["note"] = "original image supplied inline (previous part)"
            await mark_examined(owner, case["case_id"], row["evidence_id"], 0, len(data), len(data))
        inventory.append(entry)
    return parts, inventory
