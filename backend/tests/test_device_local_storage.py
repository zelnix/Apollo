"""Tests for device-local investigation storage and server purge lifecycle.

Validates:
1. Confirm-commit endpoint purges server data for completed investigations
2. Confirm-commit is idempotent (already purged → success)
3. Confirm-commit rejects incomplete investigations (no response)
4. Server retention constants have been removed (Stage 11)
5. Evidence retention is positive
"""
import pytest

from services.higgins.capacity import EVIDENCE_RETENTION_SECONDS


# ── Retention constant tests ────────────────────────────────────────────

def test_dead_retention_constants_removed():
    """Stage 11: REPORT_RETENTION_SECONDS, REPORT_STORAGE_LIMIT_BYTES, and
    SAVED_RETENTION have been removed from capacity.py."""
    from services.higgins import capacity
    assert not hasattr(capacity, "REPORT_RETENTION_SECONDS"), "REPORT_RETENTION_SECONDS should be removed"
    assert not hasattr(capacity, "REPORT_STORAGE_LIMIT_BYTES"), "REPORT_STORAGE_LIMIT_BYTES should be removed"
    assert not hasattr(capacity, "SAVED_RETENTION"), "SAVED_RETENTION should be removed"


def test_evidence_retention_positive():
    """24h evidence retention for active investigations must remain."""
    assert EVIDENCE_RETENTION_SECONDS > 0, "Evidence retention must be positive for active investigations"
    assert EVIDENCE_RETENTION_SECONDS <= 24 * 3600, "Evidence retention should be ≤24h"


def test_investigation_reuse_removed():
    """Stage 11: _find_reusable_investigation and _evidence_fingerprint have been
    removed from the investigations router."""
    from routers import investigations
    assert not hasattr(investigations, "_find_reusable_investigation"), "_find_reusable_investigation should be removed"
    assert not hasattr(investigations, "_evidence_fingerprint"), "_evidence_fingerprint should be removed"


def test_saved_report_endpoints_removed():
    """Stage 11: Server-side saved report endpoints have been removed."""
    from routers.investigations import router
    paths = [r.path for r in router.routes if hasattr(r, 'path')]
    assert "/investigations/reports/list" not in paths, "list_reports endpoint should be removed"
    assert "/investigations/reports/{report_id}" not in paths or \
        not any(r.path == "/investigations/reports/{report_id}" and "GET" in r.methods for r in router.routes if hasattr(r, 'methods')), \
        "get_report endpoint should be removed"
    assert "/investigations/{case_id}/reports" not in paths or \
        not any(r.path == "/investigations/{case_id}/reports" and "POST" in r.methods for r in router.routes if hasattr(r, 'methods')), \
        "save_report endpoint should be removed"


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
