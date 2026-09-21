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
PHONE_RE = re.compile(r"(?<![\w@.])(?:\+?\d[\d\s().-]{7,}\d)(?![\w@])")
MAX_CLUES = 64


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
    if kind == "text" and ((origin == "user_submission" and not meta) or (meta or {}).get("registerClues")):
        await register_clues(owner, case, item, clean)
    return item


async def register_clues(owner: str, case: dict, parent: EvidenceItem, text: str) -> list[EvidenceItem]:
    """Every link and callback number becomes an addressable child clue with its exact offset (R07).
    Full inventory first, then registration in document order (phones are never starved by many URLs); when the per-item
    budget is reached the omitted count and their offsets are recorded on the parent instead of vanishing silently (S10)."""
    found: list[tuple[str, str, int, int]] = []
    seen: set[str] = set()
    for kind, pattern in (("url", URL_RE), ("phone", PHONE_RE)):
        for match in pattern.finditer(text):
            value = match.group(0).rstrip(".,;")
            if value in seen or (kind == "phone" and sum(c.isdigit() for c in value) < 8):
                continue
            seen.add(value)
            found.append((kind, value, match.start(), match.end()))
    found.sort(key=lambda f: f[2])  # document order: a decisive late phone number is registered before an early batch of links
    phones = [f for f in found if f[0] == "phone"]
    urls = [f for f in found if f[0] == "url"]
    # Interleave so both kinds keep a share of the budget; phones (callback numbers) take priority when the budget is tight.
    budget = min(MAX_CLUES, len(found))
    phone_share = min(len(phones), max(budget // 2, budget - len(urls)))
    selected = sorted(phones[:phone_share] + urls[:budget - phone_share], key=lambda f: f[2])
    omitted = [f for f in found if f not in selected]
    clues: list[EvidenceItem] = []
    for kind, value, start, end in selected:
        clue = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=f"{parent.client_item_id}.clue{len(clues)}", origin="apollo_inference",
                            kind="url" if kind == "url" else "text", parent_id=parent.id, collected_at=now_utc(), expires_at=parent.expires_at, media_type="text/plain",
                            byte_length=len(value.encode("utf-8")), coverage=Coverage(status="not_started", unit="items", total=1, examined=0),
                            transformations=[Transformation(kind="chunk", description=f"{kind} clue found at characters {start}–{end} of the parent item", source_start=start, source_end=end)],
                            label=(("link clue: " + re.sub(r"^https?://([^/]+).*$", r"\1", value)) if kind == "url" else "phone clue")[:80])
        await repo.insert_evidence(owner, clue, {"value": value, "parentOffset": [start, end]})
        await repo.store_bytes(owner, case["case_id"], clue.id, value.encode("utf-8"), clue.expires_at)
        clues.append(clue)
    updates: dict = {}
    if clues:
        updates["$addToSet"] = {"related_evidence_ids": {"$each": [c.id for c in clues]}}
    if omitted:
        updates["$set"] = {"clue_inventory": {"found": len(found), "registered": len(clues), "omitted": len(omitted),
                                              "omittedOffsets": [[f[2], f[3], f[0]] for f in omitted[:256]],
                                              "note": f"{len(omitted)} further {'clue' if len(omitted) == 1 else 'clues'} were found but not registered (per-item budget {MAX_CLUES}); read the parent ranges above to examine them."}}
    if updates:
        await repo.update_evidence(owner, case["case_id"], parent.id, updates)
    return clues


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


async def _purge_original_if_secret(owner: str, case: dict, item: EvidenceItem, text: str) -> None:
    """Originals are never retained in recoverable form when they carry an authentication secret (R03)."""
    if redact_investigation_secrets(text) != text:
        await repo.db.investigation_content_chunks.delete_many({"owner_id": owner, "case_id": case["case_id"], "evidence_id": item.id})
        await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"availability": "purged"}, "$push": {"transformations": Transformation(
            kind="secret_redaction", description="The original file contained an authentication secret; only the redacted extracted text is retained. Signature, size and structure were recorded first.").wire()}})


MAX_SCANNED_PAGES = 12
SCAN_DPI = 110


def _render_pdf_pages(data: bytes, page_numbers: list[int]) -> list[tuple[int, bytes]]:
    """Rasterises the given 1-based pages to PNG (bounded). Rendering failures yield no image; the page stays an explicit omitted range."""
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(io.BytesIO(data))
    except Exception:  # noqa: BLE001
        return []
    out: list[tuple[int, bytes]] = []
    for number in page_numbers:
        try:
            page = pdf[number - 1]
            bitmap = page.render(scale=SCAN_DPI / 72)
            image = bitmap.to_pil()
            if image.width * image.height > MAX_IMAGE_PIXELS:
                image.thumbnail((2000, 2000))
            buf = io.BytesIO()
            image.save(buf, format="PNG", optimize=True)
            out.append((number, buf.getvalue()))
        except Exception:  # noqa: BLE001
            continue
    return out


def _pdf_pages(data: bytes) -> tuple[list[str], list[str], list[int]]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError("encrypted")
    pages, links, unreadable = [], [], []
    total_pages = len(reader.pages)
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
    return pages, links, sorted(set(unreadable)), total_pages


def _docx_text(data: bytes) -> tuple[list[str], list[str]]:
    import docx
    document = docx.Document(io.BytesIO(data))
    paragraphs = [p.text for p in document.paragraphs]
    for table in document.tables:  # tables are part of the document, not an omission
        for row in table.rows:
            paragraphs.append(" | ".join(cell.text for cell in row.cells))
    for section in document.sections:
        paragraphs.extend(p.text for p in section.header.paragraphs if p.text.strip())
        paragraphs.extend(p.text for p in section.footer.paragraphs if p.text.strip())
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
    if kind == "text":
        kind = "document"  # a TXT original is a document container; only its redacted derivative is model input
    expires = repo.utc(case["expires_at"])
    item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=meta_in["clientItemId"], origin="user_submission", kind=kind,
                        parent_id=meta_in.get("parentId"), collected_at=now_utc(), expires_at=expires, media_type=detected, byte_length=len(data),
                        coverage=Coverage(status="not_started", unit="bytes", total=len(data), examined=0), transformations=transformations,
                        label=f"{kind}: {re.sub(r'[^A-Za-z0-9._ -]', '_', meta_in['filename'])[:60]}")
    admission = await _image_secret_preflight(data, detected) if kind == "image" else None
    if admission and admission["status"] != "clear":
        # Ephemeral admission (S06/R03). Two distinct outcomes, never conflated:
        #  - secret_detected: the original is withheld; the preflight's FULL transcription with only the secrets replaced by [REDACTED]
        #    plus a visual description are retained as derived text with explicit coverage, so non-secret evidence is not lost.
        #  - unavailable: the check could not run/validate, so no unchecked original is stored; the person is told to resubmit.
        detected_secret = admission["status"] == "secret_detected"
        reason = ("original image withheld: it shows an authentication secret" if detected_secret
                  else "original image not stored: the secret check was unavailable, so admission could not be decided")
        description = ("The screenshot shows a password, one-time code, card number or similar secret. The original image was not stored; its visible text "
                       "was transcribed with each secret replaced by [REDACTED] and a description of the visual layout was kept."
                       if detected_secret else f"The image could not be checked for secrets before storage ({admission['status']}), so it was not kept. Submit it again; if it keeps failing, describe what it shows.")
        item = item.model_copy(update={"availability": "purged", "coverage": Coverage(status="unavailable", unit="bytes", total=len(data), examined=0, reason=reason),
                                       "transformations": [*transformations, Transformation(kind="secret_redaction", description=description)]})
        await repo.insert_evidence(owner, item, {"filename": meta_in["filename"], "declaredMediaType": meta_in["mediaType"], "detectedMediaType": detected, "secretPreflight": admission})
        if detected_secret:
            text = redact_investigation_secrets(
                f"VISIBLE TEXT (verbatim, secrets replaced by [REDACTED]):\n{admission['redactedText']}\n\nVISUAL DESCRIPTION:\n{admission['visualDescription']}\n\n"
                f"REDACTED ITEMS: {', '.join(admission['secretKinds']) or 'unspecified'}.")
            truncated = bool(admission.get("transcriptionTruncated"))
            transcription_gap_reason = ("the transcription exceeded the 60,000-character processing budget and was truncated; continuation is required to examine the remainder" if truncated
                                        else None if admission["transcriptionComplete"] else "the preflight reported its transcription as incomplete")
            derived = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=f"{item.client_item_id}.redacted", origin="apollo_inference", kind="text",
                                   parent_id=item.id, collected_at=now_utc(), expires_at=expires, media_type="text/plain", byte_length=len(text.encode("utf-8")),
                                   coverage=Coverage(status="not_started", unit="characters", total=len(text), examined=0,
                                                     material_gap=truncated or not admission["transcriptionComplete"], reason=transcription_gap_reason),
                                   transformations=[Transformation(kind="secret_redaction", description="Targeted redaction by the Gemini preflight: only secret values were replaced; other visible text is verbatim.")],
                                   label="redacted transcription of the withheld screenshot")
            await repo.insert_evidence(owner, derived, {"derivedFrom": item.id})
            await repo.store_bytes(owner, case["case_id"], derived.id, text.encode("utf-8"), expires)
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"related_evidence_ids": [derived.id]}})
            await register_clues(owner, case, derived, text)
        return item
    await repo.insert_evidence(owner, item, {"filename": meta_in["filename"], "declaredMediaType": meta_in["mediaType"], "detectedMediaType": detected,
                                             **({"secretPreflight": admission} if admission else {})})
    await repo.store_bytes(owner, case["case_id"], item.id, data, expires)
    await _derive(owner, case, item, data, detected)
    return item


async def _image_secret_preflight(data: bytes, media_type: str) -> dict:
    """Gemini-only visual admission check with STRICT response validation. Outcomes: `clear` (store original), `secret_detected`
    (withhold original; keep targeted-redacted transcription), `unavailable` (check failed or response malformed: no unchecked original
    is stored, and the person is told the check was unavailable — NOT that a secret was found)."""
    from services.higgins import provider
    from google.genai import types as gtypes
    prompt = [gtypes.Part.from_bytes(data=data, mime_type=media_type),
              gtypes.Part(text="You are an admission filter for screenshots. Decide whether the image VISIBLY shows an authentication secret: password, PIN, "
                               "one-time code, recovery code, full card number, CVV, private key or session token. Then transcribe ALL visible text verbatim, "
                               "replacing ONLY each secret value with [REDACTED] (keep sender names, amounts, links, phone numbers, dates, instructions exactly). "
                               'Answer JSON only: {"containsSecret": true|false, "secretKinds": ["..."], "redactedText": "verbatim transcription with secrets '
                               'replaced", "visualDescription": "layout, app/window, sender/recipient chrome, images or icons, without any secret", '
                               '"transcriptionComplete": true|false}')]
    try:
        result, _ = await provider.generate_json("Return only the JSON object.", prompt, capability="vision")
    except Exception as exc:  # noqa: BLE001
        return {"status": f"unavailable:{type(exc).__name__}", "containsSecret": None, "secretKinds": [], "redactedText": "", "visualDescription": "", "transcriptionComplete": None}
    contains = result.get("containsSecret") if isinstance(result, dict) else None
    if not isinstance(contains, bool):  # a missing/ambiguous verdict is NOT "no secret"; it is an unavailable check
        return {"status": "unavailable:invalid_response", "containsSecret": None, "secretKinds": [], "redactedText": "", "visualDescription": "", "transcriptionComplete": None}
    kinds = [str(k)[:40] for k in (result.get("secretKinds") or []) if isinstance(k, (str, int))][:8]
    redacted_text_raw = str(result.get("redactedText") or "")
    truncated = len(redacted_text_raw) > 60_000  # our own processing budget — independent of the model's own completeness claim below
    redacted_text = redacted_text_raw[:60_000]
    visual = str(result.get("visualDescription") or "")[:8_000]
    complete = result.get("transcriptionComplete") if isinstance(result.get("transcriptionComplete"), bool) else None
    if contains and not redacted_text.strip() and not visual.strip():  # detected a secret but produced no usable redacted content: cannot admit anything
        return {"status": "unavailable:no_redacted_content", "containsSecret": True, "secretKinds": kinds, "redactedText": "", "visualDescription": "", "transcriptionComplete": None, "transcriptionTruncated": False}
    return {"status": "secret_detected" if contains else "clear", "containsSecret": contains, "secretKinds": kinds, "redactedText": redacted_text,
            "visualDescription": visual, "transcriptionComplete": complete, "transcriptionTruncated": truncated}


async def _derive(owner: str, case: dict, item: EvidenceItem, data: bytes, detected: str) -> None:
    """Parser extraction is recorded as its own derived evidence with page/offset identities. Parsing is not examination."""
    coverage_update: dict = {}
    try:
        if detected == "application/pdf" or detected.endswith("wordprocessingml.document"):
            if detected == "application/pdf":
                pages, links, unreadable, total_pages = _pdf_pages(data)
            else:
                paragraphs, links = _docx_text(data)
                pages, unreadable, total_pages = ["\n".join(paragraphs)], [], 1
            offsets, text, cursor = [], "", 0
            for number, page in enumerate(pages, start=1):
                block = f"\n\n[page {number}]\n{page}"
                offsets.append({"page": number, "start": cursor, "end": cursor + len(block), "readable": number not in unreadable})
                text += block
                cursor += len(block)
            if len(text) > MAX_EXPANDED:
                raise ValueError("expanded")
            link_text = "\n".join(links)
            derived = await ingest_text(owner, case, f"{item.client_item_id}.text", text + ("\n\n[links]\n" + link_text if link_text else ""), parent_id=item.id,
                                        label=f"extracted text ({len(pages)} pages)", meta={"pages": offsets, "links": links[:512], "registerClues": True},
                                        transformations=[Transformation(kind="decode", description=f"Parser text layer of {len(pages)} page(s) with page markers; {len(links)} link target(s) collected. Scanned/unreadable pages: {unreadable or 'none'}.")])
            # Scanned/image-only pages: rasterise each (within budget) as a derived image so Gemini can read it visually. A rendered page
            # is addressable evidence with its own coverage; only pages beyond the render budget remain explicit omitted ranges.
            rendered_ids, rendered_pages = [], []
            to_render = unreadable[:MAX_SCANNED_PAGES] if detected == "application/pdf" else []
            if to_render:
                for number, png in _render_pdf_pages(data, to_render):
                    page_item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id=f"{item.client_item_id}.page{number}", origin=item.origin, kind="image",
                                             parent_id=item.id, collected_at=now_utc(), expires_at=item.expires_at, media_type="image/png", byte_length=len(png),
                                             coverage=Coverage(status="not_started", unit="items", total=1, examined=0, reason="rendered scanned page available to Gemini vision; not yet examined"),
                                             transformations=[Transformation(kind="decode", description=f"Page {number} has no text layer; rasterised at {SCAN_DPI} DPI for visual reading. Layout and images preserved; no OCR text layer was invented.")],
                                             label=f"scanned page {number} (rendered image)")
                    await repo.insert_evidence(owner, page_item, {"page": number, "derivedFrom": item.id})
                    await repo.store_bytes(owner, case["case_id"], page_item.id, png, item.expires_at)
                    rendered_ids.append(page_item.id)
                    rendered_pages.append(number)
            omitted = [{"start": p - 1, "end": p, "reason": "no extractable text layer (scanned or image-only page); rendering it also failed" if p in to_render
                       else f"scanned page beyond this turn's {MAX_SCANNED_PAGES}-page visual-rendering budget; not yet examined — continue to process the remainder"}
                      for p in unreadable if p not in rendered_pages]
            if total_pages > len(pages):
                omitted.append({"start": len(pages), "end": total_pages, "reason": f"beyond the {MAX_PAGES}-page processing budget; not extracted"})
            coverage_update = {"status": "partial" if omitted else "not_started", "unit": "pages", "total": total_pages, "examined": 0, "omittedRanges": omitted,
                               "materialGap": bool(omitted),
                               "reason": "parser extraction complete; model examination pending" + (f"; {len(rendered_pages)} scanned page(s) rendered for visual reading" if rendered_pages else "")}
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage": coverage_update, "related_evidence_ids": [derived.id, *rendered_ids]}})
            await _purge_original_if_secret(owner, case, item, text)
        elif detected in ("image/png", "image/jpeg"):
            from PIL import Image
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"availability": "unavailable"}})
                    raise ValueError("pixels")
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"coverage.reason": "original image available to Gemini vision; not yet examined"}})
        elif detected == "text/plain":
            derived = await ingest_text(owner, case, f"{item.client_item_id}.text", data.decode("utf-8", errors="replace"), parent_id=item.id, label="file text", meta={"registerClues": True})
            await repo.update_evidence(owner, case["case_id"], item.id, {"$set": {"related_evidence_ids": [derived.id], "coverage": {"status": "not_started", "unit": "characters", "total": len(data.decode("utf-8", errors="replace")), "examined": 0}}})
            await _purge_original_if_secret(owner, case, item, data.decode("utf-8", errors="replace"))
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
    fully_read = total is not None and examined >= total
    # A gap recorded at INGESTION time (truncation, incomplete transcription, parser failure, ...) is a fact about
    # what was retained, not about what was read. Reading everything that WAS retained can never resolve it here —
    # that only happens once the missing portion is actually processed (a future continuation turn), never by re-reading.
    permanent_gap = bool(coverage.get("materialGap"))
    complete = fully_read and not permanent_gap
    await repo.update_evidence(owner, case_id, evidence_id, {"$set": {"coverage.examinedRanges": ranges, "coverage.examined": min(examined, total or examined),
                                                                      "coverage.status": "examined" if complete else "partial",
                                                                      "coverage.materialGap": permanent_gap or (not fully_read and bool(total))}})
    # Only a DERIVED full-text child (document extraction) or a rendered scanned-page image propagates coverage to its
    # parent. A registered clue (origin apollo_inference, parentOffset) is a relationship, not inherited completion:
    # reading one clue never examines the document.
    if not row.get("parent_id") or row.get("origin") == "apollo_inference":
        return
    parent = await repo.get_evidence(owner, case_id, row["parent_id"])
    if parent["coverage"].get("unit") != "pages":
        # Single-child parent (no page-level structure of its own): mirror this child's own outcome directly.
        await repo.update_evidence(owner, case_id, row["parent_id"], {"$set": {"coverage.status": "examined" if complete else "partial"}})
        return
    # Multi-page parent (a scanned/mixed PDF): its own pages are covered by TWO kinds of children — the extracted-text
    # child (page ranges in CHARACTER units, readable pages only) and each rendered scanned-page image (exactly one
    # page each). Neither can singlehandedly complete the parent; their page coverage is combined here incrementally.
    meta = await repo.evidence_meta(row)
    covered_pages: set[int] = set()
    if meta.get("pages"):  # the extracted-text child: a page counts only once fully covered AND it actually had a text layer
        covered_pages = {p["page"] for p in meta["pages"] if p.get("readable", True) and any(r["start"] <= p["start"] and r["end"] >= p["end"] for r in ranges)}
    elif meta.get("page") and complete:  # a single rendered scanned-page image child represents exactly that one page
        covered_pages = {meta["page"]}
    if not covered_pages:
        return
    parent_ranges = list(parent["coverage"].get("examinedRanges", []))
    for page in covered_pages:
        parent_ranges = _union(parent_ranges, page - 1, page)
    parent_examined = sum(r["end"] - r["start"] for r in parent_ranges)
    parent_total = parent["coverage"].get("total")
    parent_gap = bool(parent["coverage"].get("omittedRanges"))  # pages beyond a processing budget remain a gap until a continuation turn resolves them
    parent_complete = parent_total is not None and parent_examined >= parent_total and not parent_gap
    await repo.update_evidence(owner, case_id, row["parent_id"], {"$set": {
        "coverage.examinedRanges": parent_ranges, "coverage.examined": min(parent_examined, parent_total or parent_examined),
        "coverage.status": "examined" if parent_complete else "partial", "coverage.materialGap": parent_gap or not parent_complete}})


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
    return {"evidenceId": evidence_id, "totalCharacters": len(text), "start": start, "end": end, "content": text[start:end],
            "hasMore": end < len(text), "pages": meta.get("pages", [])[:MAX_PAGES] if pages is None and meta.get("pages") else None,
            "_pendingMark": [evidence_id, start, end, len(text)]}  # applied by the coordinator after the model has actually received this range


async def model_parts(owner: str, case: dict, rows: list[dict]) -> tuple[list[types.Part], list[dict], list[tuple[str, int, int, int]]]:
    """Inline short text and images; long text is summarised by inventory and read by range via tools.
    Returns pending examination marks (evidence_id, start, end, total) to apply only after Gemini succeeds."""
    parts, inventory, marks = [], [], []
    for row in rows:
        entry = {"evidenceId": row["evidence_id"], "kind": row["kind"], "origin": row["origin"], "label": row.get("label", ""), "parentId": row.get("parent_id"),
                 "availability": row["availability"], "coverage": row["coverage"], "simulation": row.get("simulation"), "transformations": row.get("transformations", [])}
        if row.get("clue_inventory"):
            entry["clueInventory"] = row["clue_inventory"]  # explicit deferred count/offsets: a budget cutoff is never "all clues investigated"
        if row["availability"] != "available":
            inventory.append(entry)
            continue
        if row["kind"] in ("text", "url", "observation"):
            text = (await repo.read_bytes(owner, case["case_id"], row["evidence_id"])).decode("utf-8", errors="replace")
            if len(text) <= INLINE_TEXT_CHARS:
                entry["content"] = text
                if row["coverage"].get("unit") == "characters":
                    marks.append((row["evidence_id"], 0, len(text), len(text)))
            else:
                entry["content"] = text[:2000]
                entry["note"] = f"{len(text)} characters total; only the first 2000 are inline. Use read_evidence with ranges/pages to examine the rest before concluding."
                marks.append((row["evidence_id"], 0, 2000, len(text)))
        elif row["kind"] == "image":
            data = await repo.read_bytes(owner, case["case_id"], row["evidence_id"])
            parts.append(types.Part.from_bytes(data=data, mime_type=row["media_type"]))
            entry["note"] = "original image supplied inline (previous part)"
            marks.append((row["evidence_id"], 0, len(data), len(data)))
        inventory.append(entry)
    return parts, inventory, marks
