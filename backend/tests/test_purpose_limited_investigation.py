"""Purpose limitation, grounding and request-scoped deletion regressions."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi import UploadFile
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import analysis
from services.investigation import (HigginsAssessment, _complete_higgins_response, deterministic_entities,
                                    purpose_limited_url)


def test_server_redacts_secret_url_values_but_keeps_assessment_context():
    safe = purpose_limited_url("https://user:pass@example.com/reset?token=secret&invoice=42#fragment")
    assert safe == "https://example.com/reset?token=%5Bredacted%5D&invoice=42"
    assert "user" not in safe and "pass" not in safe and "secret" not in safe and "fragment" not in safe


def test_deterministic_extraction_finds_actual_concern():
    entities = deterministic_entities("Bank Alerts", "Pay $600 today, call 02 8000 1234 and share the code.", [], "CommBank")
    assert entities.claimed_organisations == ["CommBank"]
    assert entities.callback_details == ["02 8000 1234"]
    assert "$600" in entities.transaction_claims
    assert "share a verification code" in entities.requested_actions


def test_higgins_exact_response_always_contains_finding_uncertainty_and_action():
    result = _complete_higgins_response(HigginsAssessment(headline="Check this request", next_action="Call the official number.",
        exact_response="too short", what_was_found=["The supplied domain is not official."],
        why_it_matters=["Lookalike domains can collect passwords."],
        could_not_establish=["Apollo could not authenticate the sender."], action_label="Call official number", action_kind="call_known_number"))
    assert "not official" in result.exact_response
    assert "could not establish" in result.exact_response.lower()
    assert "Call the official number" in result.exact_response


@pytest.mark.asyncio
async def test_screenshot_upload_is_closed_after_success(monkeypatch):
    image = Image.new("RGB", (700, 300), "white"); draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 690, 290), outline="black", width=3); draw.text((30, 80), "Review this payment", fill="black")
    raw = io.BytesIO(); image.save(raw, "PNG"); file = UploadFile(filename="message.png", file=io.BytesIO(raw.getvalue()), headers={"content-type": "image/png"})

    async def fake_extract(_data: bytes):
        return {"sender": "", "text": "Review this payment", "urls": [], "source": "sms",
                "processing": {"raw_retained_by_apollo": False}}

    monkeypatch.setattr(analysis, "extract_message_screenshot", fake_extract)
    response = await analysis.message_extract(device_id="purpose-test", file=file)
    assert response["processing"]["raw_retained_by_apollo"] is False
    assert file.file.closed