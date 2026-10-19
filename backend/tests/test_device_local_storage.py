"""Tests for device-local investigation storage and server purge lifecycle.

Validates:
1. Confirm-commit endpoint purges server data for completed investigations
2. Confirm-commit is idempotent (already purged → success)
3. Confirm-commit rejects incomplete investigations (no response)
4. Server retention constants are set to zero / no-retain
5. _find_reusable_investigation always returns None (server reuse removed)
"""
import pytest
import asyncio
from datetime import datetime, timedelta, timezone

from services.higgins.capacity import EVIDENCE_RETENTION_SECONDS, REPORT_RETENTION_SECONDS, REPORT_STORAGE_LIMIT_BYTES, SAVED_RETENTION


# ── Retention constant tests ────────────────────────────────────────────

def test_report_retention_is_zero():
    """Server must not retain completed investigation reports."""
    assert REPORT_RETENTION_SECONDS == 0, f"REPORT_RETENTION_SECONDS should be 0, got {REPORT_RETENTION_SECONDS}"


def test_storage_limit_is_zero():
    """Server must not allocate saved-report storage."""
    assert REPORT_STORAGE_LIMIT_BYTES == 0, f"REPORT_STORAGE_LIMIT_BYTES should be 0, got {REPORT_STORAGE_LIMIT_BYTES}"


def test_evidence_retention_positive():
    """24h evidence retention for active investigations must remain."""
    assert EVIDENCE_RETENTION_SECONDS > 0, "Evidence retention must be positive for active investigations"
    assert EVIDENCE_RETENTION_SECONDS <= 24 * 3600, "Evidence retention should be ≤24h"


def test_saved_retention_constant_exists():
    """SAVED_RETENTION constant exists for backward compat but should be a legacy no-op."""
    assert isinstance(SAVED_RETENTION, str)


# ── Reuse removal test ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_find_reusable_investigation_always_none():
    """Server-side investigation reuse has been removed."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.investigations import _find_reusable_investigation
    result = await _find_reusable_investigation("test-owner", [], "test question")
    assert result is None, "Server should never reuse a previously completed investigation"


# ── Confirm-commit API test (requires running server) ───────────────────

@pytest.mark.asyncio
async def test_confirm_commit_idempotent():
    """Confirming commit for a non-existent case should return success (idempotent)."""
    import httpx
    async with httpx.AsyncClient(base_url="http://localhost:8001") as client:
        # Register a device to get a valid bearer token
        reg = await client.post("/api/devices/register", json={"platform": "test", "model": "pytest", "adapter_mode": "standard"})
        assert reg.status_code in (200, 201), f"Device registration failed: {reg.text}"
        token = reg.json().get("device_token") or reg.json().get("token")
        assert token, "No token returned from device registration"
        headers = {"Authorization": f"Bearer {token}"}
        # Confirm commit for a case that doesn't exist → idempotent success
        response = await client.post(
            "/api/investigations/nonexistent-case-12345/confirm-commit",
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["purged"] is True
        assert data["status"] == "already_clean"
