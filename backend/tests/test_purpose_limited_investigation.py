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
from services import investigation
from services.investigation import (HigginsAssessment, InvestigationSource, _complete_fallback_higgins_response,
                                    _model_infers_page_state_from_unavailable_inspection, deterministic_entities,
                                    investigate_message, purpose_limited_url)


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


def test_deterministic_fallback_contains_finding_uncertainty_and_action():
    result = _complete_fallback_higgins_response(HigginsAssessment(headline="Check this request", next_action="Call the official number.",
        exact_response="too short", what_was_found=["The supplied domain is not official."],
        why_it_matters=["Lookalike domains can collect passwords."],
        could_not_establish=["Apollo could not authenticate the sender."], action_label="Call official number", action_kind="call_known_number"))
    assert "not official" in result.exact_response
    assert "could not establish" in result.exact_response.lower()
    assert "Call the official number" in result.exact_response


@pytest.mark.asyncio
async def test_valid_gemini_exact_response_is_preserved_verbatim(monkeypatch):
    exact = "The submitted request uses an unverified sender. The sender identity remains unknown. Open the official app independently and review recent activity there."
    model = {
        "claimed_organisations": [], "sender_details": [], "sender_phone_numbers": [], "callback_details": [],
        "requested_actions": ["open a supplied link"], "transaction_claims": [], "mentioned_names": [], "suspected_deception": [],
        "findings": [{"status": "unresolved", "evidence_kind": "submitted_content", "title": "Unverified request",
                      "detail": "The submitted request does not authenticate its sender.", "source_ids": ["local-1"]}],
        "headline": "Verify the request independently", "next_action": "Open the official app independently.",
        "exact_response": exact, "what_was_found": ["An unverified request was submitted."],
        "why_it_matters": ["Impersonated requests can redirect account access."],
        "could_not_establish": ["The sender identity remains unknown."],
        "action_label": "Open official app", "action_kind": "verify_officially",
    }

    async def fake_stream(_system: str, _prompt: str):
        return model, []

    monkeypatch.setattr(investigation, "_stream_json", fake_stream)
    result = await investigate_message(sender="Account alert", text="Open the link to review activity", urls=[], claimed_brand=None,
                                       local_state="ears_up", url_context=[])
    assert result.higgins.exact_response == exact
    assert result.processing["higgins_source"] == "gemini"
    assert result.processing["fallback_used"] is False


def test_dns_failure_cannot_be_rewritten_as_site_inactive():
    higgins = HigginsAssessment(headline="Unverified page", next_action="Use the official app.",
                                exact_response="The DNS failure suggests the site may already be inactive.",
                                what_was_found=["The page failed to load and may be offline."], why_it_matters=["Connection failed."],
                                could_not_establish=["Page state is unknown."], action_label="Use official app", action_kind="verify_officially")
    sources = [InvestigationSource(source_id="page-1", kind="page", label="Isolated webpage inspection", status="unavailable", detail="dns_failed")]
    assert _model_infers_page_state_from_unavailable_inspection(higgins, sources) is True


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