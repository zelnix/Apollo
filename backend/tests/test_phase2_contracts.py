import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.higgins.contracts import DeviceResult


CONTRACT = json.loads((Path(__file__).resolve().parents[2] / "shared" / "apollo_phase2_contracts.json").read_text())


def test_unavailable_reason_registry_matches_python_contract():
    for reason in CONTRACT["unavailableReasons"]:
        value = DeviceResult(requestId="request-1", caseRevision=1, capabilityId="cap.x", status="unavailable", unavailableReason=reason)
        assert value.unavailable_reason == reason


def test_unavailable_device_result_without_reason_is_rejected():
    with pytest.raises(ValidationError):
        DeviceResult(requestId="request-1", caseRevision=1, capabilityId="cap.x", status="unavailable")


def test_observed_device_result_cannot_claim_unavailability():
    with pytest.raises(ValidationError):
        DeviceResult(requestId="request-1", caseRevision=1, capabilityId="cap.x", status="observed", unavailableReason="adapter_failed")