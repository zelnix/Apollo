"""Focused regressions for the shared investigation engine (spec §20 items 1, 2, 7, 9, 12). No Gemini calls: cases are opened
with a blank question so no turn runs. Run: cd backend && python -m pytest tests/test_investigation_engine.py -q"""
import json
import uuid

import httpx
import pytest

from services.higgins import evidence as ev
from services.higgins.validation import validate

BASE = "http://localhost:8001/api"


def _owner():
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def _case(h, **extra):
    body = {"gate": "text", "question": "", "submissions": [], "initialFindingRefs": [], "initialFindings": [], "deviceProfile": None, **extra}
    key = str(uuid.uuid4())
    r = httpx.post(f"{BASE}/investigations", json=body, headers={**h, "Idempotency-Key": key}, timeout=30)
    assert r.status_code == 201, r.text
    return r.json()["case"], key, body


def test_create_idempotency_and_conflict():
    h = _owner()
    case, key, body = _case(h)
    replay = httpx.post(f"{BASE}/investigations", json=body, headers={**h, "Idempotency-Key": key}, timeout=30)
    assert replay.status_code == 201 and replay.json()["case"]["id"] == case["id"]
    changed = httpx.post(f"{BASE}/investigations", json={**body, "gate": "link"}, headers={**h, "Idempotency-Key": key}, timeout=30)
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "conflict"
    assert httpx.post(f"{BASE}/investigations", json=body, headers=h, timeout=30).status_code == 400  # missing key


def test_cross_owner_isolation_and_delete():
    h, other = _owner(), _owner()
    case, _, _ = _case(h)
    for path in ("", "/evidence", "/sources", "/turns"):
        assert httpx.get(f"{BASE}/investigations/{case['id']}{path}", headers=other, timeout=20).status_code == 404
    assert httpx.delete(f"{BASE}/investigations/{case['id']}", headers=other, timeout=20).status_code == 404
    assert httpx.delete(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20).status_code in (202, 204)
    assert httpx.get(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20).status_code == 410
    assert httpx.delete(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20).status_code in (202, 204)  # repeat safe


def test_full_inventory_25_urls_and_long_text():
    h = _owner()
    urls = [f"https://example-{i}.test/path/{i}?ref=late" for i in range(25)]
    long_text = ("routine notes. " * 700) + " Pay the changed levy to BSB 000-000 now. " + ("thanks. " * 50)
    case, _, _ = _case(h, submissions=[{"clientItemId": str(uuid.uuid4()), "kind": "url", "value": u} for u in urls] + [{"clientItemId": str(uuid.uuid4()), "kind": "text", "value": long_text}])
    items = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
    assert items["total"] == 26 and sum(1 for i in items["items"] if i["kind"] == "url") == 25
    text_item = next(i for i in items["items"] if i["kind"] == "text")
    assert text_item["coverage"]["total"] == len(long_text) and text_item["coverage"]["status"] == "not_started"
    # Stale revision on evidence add is a recoverable 409, not a silent second context.
    r = httpx.post(f"{BASE}/investigations/{case['id']}/evidence", json={"expectedRevision": 99, "clientItemId": str(uuid.uuid4()), "parentId": None, "kind": "text", "text": "x"}, headers=h, timeout=20)
    assert r.status_code == 409


def test_file_signature_uses_actual_bytes_and_records_mismatch():
    h = _owner()
    case, _, _ = _case(h, gate="file")
    meta = {"expectedRevision": case["revision"], "clientItemId": str(uuid.uuid4()), "parentId": None, "kind": "document", "filename": "invoice.pdf", "mediaType": "application/pdf"}
    exe = b"MZ" + b"\x00" * 600
    r = httpx.post(f"{BASE}/investigations/{case['id']}/evidence", data={"metadata": json.dumps(meta)}, files={"file": ("invoice.pdf", exe, "application/pdf")}, headers=h, timeout=30)
    assert r.status_code == 201, r.text
    item = r.json()["evidence"]
    assert item["mediaType"] == "application/vnd.microsoft.portable-executable" and item["kind"] == "attachment"
    assert any(t["kind"] == "normalise" for t in item["transformations"])
    fresh = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()["items"][0]
    assert fresh["coverage"]["status"] == "unavailable" and fresh["coverage"]["materialGap"] is True
    assert ev.sniff(b"%PDF-1.4 ...", "image/png") == "application/pdf"


def test_secret_redaction_keeps_context():
    h = _owner()
    case, _, _ = _case(h, submissions=[{"clientItemId": str(uuid.uuid4()), "kind": "text", "value": "Reset your password if you did not request this. My password is Hunter2!! and the code is 493 221."}])
    item = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()["items"][0]
    assert any(t["kind"] == "secret_redaction" for t in item["transformations"])


def test_validation_rejects_unknown_refs_but_not_style():
    base = {"overview": "A calm answer.", "explanationMarkdown": "Long prose with a question at the end?", "assessment": "uncertain", "attention": "none",
            "findings": [], "uncertainties": [], "scope": "", "sourceIds": [], "remainingEvidenceIds": [], "actions": [], "completion": "complete"}
    ok, errors = validate(base, revision=1, evidence_ids=set(), source_ids=set(), capability_ids=set(), pending_question=None, provider_complete=True)
    assert ok and not errors
    bad = {**base, "findings": [{"text": "x", "basis": "observation", "confidence": "high", "evidenceIds": ["nope"], "sourceIds": []}],
           "actions": [{"kind": "open_settings", "label": "Open", "instruction": "go", "capabilityId": None}]}
    ok, errors = validate(bad, revision=1, evidence_ids={"e1"}, source_ids=set(), capability_ids=set(), pending_question=None, provider_complete=True)
    assert ok is None and any("unknown ids" in e for e in errors) and any("capabilityId" in e for e in errors)
    ok, errors = validate(base, revision=1, evidence_ids=set(), source_ids=set(), capability_ids=set(), pending_question=None, provider_complete=False)
    assert ok is None and any("incomplete" in e for e in errors)
    ok, errors = validate({**base, "completion": "waiting_user"}, revision=1, evidence_ids=set(), source_ids=set(), capability_ids=set(), pending_question=None, provider_complete=True)
    assert ok is None


def test_turn_requires_key_and_rejects_stale_revision():
    h = _owner()
    case, _, _ = _case(h)
    turn = {"expectedRevision": case["revision"] + 5, "turnId": str(uuid.uuid4()), "message": "hello", "answerToQuestionId": None, "evidenceIds": []}
    assert httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=turn, headers=h, timeout=20).status_code == 400
    assert httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=turn, headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=20).status_code == 409
    unknown = {**turn, "expectedRevision": case["revision"], "evidenceIds": ["missing"]}
    assert httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=unknown, headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=20).status_code == 404


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
