"""Purpose limitation, grounding and request-scoped deletion regressions.

Tests that observation utilities (URL sanitisation, entity extraction, screenshot
processing) work correctly. Investigation tests use the shared Magnum DI path
via services/higgins/coordinator.py, not the removed legacy investigation engine.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi import UploadFile
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import analysis
from services.investigation import deterministic_entities, purpose_limited_url


def test_server_redacts_secret_url_values_but_keeps_assessment_context():
    safe = purpose_limited_url("https://user:pass@example.com/reset?token=secret&invoice=42#fragment")
    assert safe == "https://example.com/reset?token=%5Bredacted%5D&invoice=42"
    assert "user" not in safe and "pass" not in safe and "secret" not in safe and "fragment" not in safe


def test_deterministic_extraction_finds_actual_concern():
    entities = deterministic_entities("Bank Alerts", "Pay $600 today, call 02 8000 1234 and share the code.", [], "CommBank", locale="en-AU")
    assert entities.claimed_organisations == ["CommBank"]
    assert any("8000" in p for p in entities.callback_details)


def test_dns_failure_cannot_be_rewritten_as_site_inactive():
    # The rule lives in the coordinator prompt: a DNS failure is a limitation, not takedown or safety.
    from services.higgins.coordinator import SYSTEM
    assert "DNS failure" in SYSTEM and "not proof of fraud, takedown or safety" in SYSTEM


@pytest.mark.asyncio
async def test_screenshot_upload_is_closed_after_success(monkeypatch):
    image = Image.new("RGB", (700, 300), "white"); draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 690, 290), outline="black", width=3); draw.text((30, 80), "Review this payment", fill="black")
    raw = io.BytesIO(); image.save(raw, "PNG"); file = UploadFile(filename="message.png", file=io.BytesIO(raw.getvalue()), headers={"content-type": "image/png"})

    async def fake_extract(_data: bytes):
        return {"sender": "", "text": "Review this payment", "urls": [], "source": "sms",
                "processing": {"raw_retained_by_apollo": False}}

    monkeypatch.setattr(analysis, "extract_message_screenshot", fake_extract)
    import hashlib
    image_bytes = raw.getvalue()
    digest = hashlib.sha256(image_bytes).hexdigest()
    response = await analysis.message_extract(
        device_id="purpose-test", file=file)
    assert response["processing"]["raw_retained_by_apollo"] is False
    assert file.file.closed
