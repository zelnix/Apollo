"""Regression tests for Call Gate reliability fixes (12 Oct 2026).

Covers:
  1. Backend phonerisk: "unknown" decision when IPQS key missing or provider fails.
  2. Backend phonerisk: Honest Higgins messaging for unknown assessments.
  3. Response contract: "unknown" is a valid decision alongside allow/review/avoid.
  4. Unavailable source is correctly surfaced.

Does NOT cover (requires physical device):
  - Native call-screening role detection
  - ApolloCallScreeningService pending queue behaviour
  - callSdk.ts explicit result statuses (Expo native module needed)
"""
import os
import pytest
from unittest.mock import patch, AsyncMock
from datetime import datetime, timezone
from core.models import CallRiskResponse


# ─── 1. "unknown" decision when IPQS key is not configured ─────────────────

@pytest.mark.asyncio
async def test_no_ipqs_key_returns_unknown_decision():
    """When IPQS_API_KEY is not set, phonerisk must return decision='unknown',
    not 'allow'. A missing reputation provider is not a clean assessment."""
    from services.phonerisk import check_phone_risk

    with patch.dict(os.environ, {"IPQUALITYSCORE_API_KEY": ""}, clear=False):
        # Force module to re-read the key
        import services.phonerisk as pr
        original_key = pr.IPQS_API_KEY
        pr.IPQS_API_KEY = ""
        try:
            result = await check_phone_risk("+15550001234", "test-device")
            assert result.decision == "unknown", f"Expected 'unknown' but got '{result.decision}'"
            assert result.source == "not_configured"
            assert result.higgins["found"].startswith("Apollo could not obtain")
        finally:
            pr.IPQS_API_KEY = original_key


@pytest.mark.asyncio
async def test_provider_failure_no_cache_returns_unknown():
    """When IPQS fails and there is no cached result, phonerisk must return
    decision='unknown' with source='unavailable', not 'allow'."""
    from services.phonerisk import check_phone_risk
    import services.phonerisk as pr
    from fastapi import HTTPException

    original_key = pr.IPQS_API_KEY
    pr.IPQS_API_KEY = "test-key-that-will-fail"

    try:
        # Mock _query_ipqs to raise HTTPException (which is what happens when IPQS fails after retries)
        with patch("services.phonerisk._query_ipqs", new_callable=AsyncMock, side_effect=HTTPException(status_code=503, detail="IPQS unavailable")):
            # Also mock the DB cache to return None (no stale cache available)
            mock_db = AsyncMock()
            mock_db.phone_risk_cache.find_one = AsyncMock(return_value=None)
            with patch("services.phonerisk.db", mock_db):
                result = await check_phone_risk("+15550009999", "test-device")
                assert result.decision == "unknown", f"Expected 'unknown' but got '{result.decision}'"
                assert result.source == "unavailable"
    finally:
        pr.IPQS_API_KEY = original_key


# ─── 2. Honest Higgins messaging ───────────────────────────────────────────

def test_higgins_unknown_messaging_is_honest():
    """The Higgins text for 'unknown' must not imply safety or danger."""
    from services.phonerisk import _higgins

    result = _higgins("unknown", {"fraud_score": None})
    assert "could not obtain" in result["found"].lower() or "could not" in result["found"].lower()
    # Must NOT falsely reassure ("did not find abuse signals" is for verified "allow")
    assert "did not find" not in result["found"].lower()
    # The text may mention "safe" in the context of "does not mean safe" — that's honest.
    # But it must NOT say something like "this number is safe" or "appears safe".
    assert "is safe" not in result["found"].lower() or "does not mean" in result["found"].lower()


def test_higgins_allow_still_works():
    """Verified 'allow' decision still produces correct messaging."""
    from services.phonerisk import _higgins

    result = _higgins("allow", {"fraud_score": 15})
    assert "did not find strong abuse signals" in result["found"].lower()


def test_higgins_avoid_still_works():
    """Verified 'avoid' decision still produces correct messaging."""
    from services.phonerisk import _higgins

    result = _higgins("avoid", {"fraud_score": 92})
    assert "fraud" in result["found"].lower() or "abuse" in result["found"].lower()


# ─── 3. Response contract includes "unknown" ───────────────────────────────

def test_call_risk_response_accepts_unknown_decision():
    """The CallRiskResponse model must accept 'unknown' as a valid decision."""
    resp = CallRiskResponse(
        number="+15550001234",
        decision="unknown",
        cached=False,
        checked_at=datetime.now(timezone.utc),
        source="unavailable",
        higgins={"headline": "Test", "found": "Test", "why": "Test",
                 "could_not_establish": "Test", "next_action": "Test",
                 "exact_response": "Test", "warning_only": True},
    )
    assert resp.decision == "unknown"
    assert resp.source == "unavailable"


def test_call_risk_response_still_accepts_allow_review_avoid():
    """Existing allow/review/avoid decisions must still work."""
    for decision in ("allow", "review", "avoid"):
        resp = CallRiskResponse(
            number="+15550001234",
            decision=decision,
            cached=False,
            checked_at=datetime.now(timezone.utc),
            source="ipqualityscore",
            higgins={"headline": "Test", "found": "Test", "why": "Test",
                     "could_not_establish": "Test", "next_action": "Test",
                     "exact_response": "Test", "warning_only": True},
        )
        assert resp.decision == decision
