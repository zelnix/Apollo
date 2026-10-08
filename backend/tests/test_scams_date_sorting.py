"""Scams feed date/sorting regression (review request iteration 80).

Validates the new backend additions to GET /api/higgins/scams:
    1. top-level 'lastSourcedAt' (ISO datetime string or null).
    2. every alerts/emerging item has 'reportedDate' ('YYYY-MM-DD' | 'YYYY-MM' | '')
       and 'dateLabel' ('Month YYYY' or 'Date not stated').
    3. every item exposes a real 'source' name (non-empty, not a raw slug like 'scamwatch').
    4. alerts and emerging are sorted most-recent-first by effective date, undated items last,
       nothing older than ~15 months (RECENCY_CUTOFF = 455 days).
    5. the full contract-key set is still present and the tier purity rule still holds.

This file is self-contained (does NOT rely on conftest.py's auth shim). It registers its own
device via POST /api/devices/register and sends an explicit Authorization header, matching the
review-request steps exactly.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in /app/frontend/.env"

TIMEOUT = 30
RECENCY_CUTOFF = timedelta(days=455)  # must match services/government_alerts.py
ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
REPORTED_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2})$")
MONTH_YEAR_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$"
)

# A value is "slug-shaped" (and therefore likely the raw source_id leaking through) if it is
# entirely lowercase ascii with no spaces — e.g. 'cert_au', 'ftc', 'accc'. Real display names
# used by the service are either capitalised ('Scamwatch') or multi-word ('Federal Trade
# Commission'), so we reject strings that have no spaces AND no uppercase letters.
def _looks_like_slug(value: str) -> bool:
    return bool(value) and " " not in value and not any(c.isupper() for c in value)


# ---------------------------------------------------------------------- fixtures


def _register_device() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/devices/register",
        json={"platform": "web", "adapter_mode": "mock"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 201, (r.status_code, r.text[:400])
    body = r.json()
    assert "device_token" in body and "device_id" in body
    return body


@pytest.fixture(scope="module")
def auth_headers() -> dict:
    # X-Apollo-Raw ensures the conftest auth shim (installed session-wide) leaves our request alone
    # so the server sees exactly the bearer we attach here.
    dev = _register_device()
    return {"Authorization": f"Bearer {dev['device_token']}", "X-Apollo-Raw": "1"}


@pytest.fixture(scope="module")
def body(auth_headers) -> dict:
    r = requests.get(f"{BASE_URL}/api/higgins/scams?limit=50", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200, (r.status_code, r.text[:400])
    return r.json()


# ---------------------------------------------------------------------- contract keys


class TestContractShape:
    REQUIRED_KEYS = {
        "coverage", "generatedAt", "feeds", "alerts", "emerging",
        "pendingCount", "lastAnalysedAt", "lastSourcedAt", "growling",
    }

    def test_required_top_level_keys_present(self, body):
        missing = self.REQUIRED_KEYS - set(body.keys())
        assert not missing, f"missing top-level keys: {missing}; got {sorted(body.keys())}"

    def test_last_sourced_at_is_iso_or_null(self, body):
        v = body["lastSourcedAt"]
        assert v is None or (isinstance(v, str) and ISO_DATETIME_RE.match(v)), (
            f"lastSourcedAt must be ISO datetime string or null; got {v!r}"
        )

    def test_last_analysed_at_is_iso_or_null(self, body):
        v = body["lastAnalysedAt"]
        assert v is None or (isinstance(v, str) and ISO_DATETIME_RE.match(v)), (
            f"lastAnalysedAt must be ISO datetime string or null; got {v!r}"
        )

    def test_alerts_only_specific_scam(self, body):
        for a in body["alerts"]:
            assert a.get("tier") == "specific_scam", f"non-specific alert: {a.get('tier')} / {a.get('title')}"

    def test_emerging_only_emerging_pattern(self, body):
        for a in body["emerging"]:
            assert a.get("tier") == "emerging_pattern", f"non-emerging in emerging: {a.get('tier')} / {a.get('title')}"

    def test_no_general_education_leaks(self, body):
        for a in body["alerts"] + body["emerging"]:
            assert a.get("tier") != "general_education"


# ---------------------------------------------------------------------- per-item date fields


def _check_item_dates(item: dict) -> None:
    rd = item.get("reportedDate")
    assert isinstance(rd, str), f"reportedDate must be a string, got {type(rd).__name__} on {item.get('title')}"
    if rd:  # non-empty must match the two accepted shapes
        assert REPORTED_DATE_RE.match(rd), f"reportedDate shape invalid: {rd!r} on {item.get('title')}"
    dl = item.get("dateLabel")
    assert isinstance(dl, str) and dl, f"dateLabel must be non-empty string on {item.get('title')}"
    if rd:
        # When reportedDate is present dateLabel must be a human 'Month YYYY'.
        assert MONTH_YEAR_RE.match(dl), f"dateLabel should be 'Month YYYY' (got {dl!r}) when reportedDate={rd!r}"
    else:
        # Spec: empty reportedDate -> 'Date not stated' OR a 'Month YYYY' derived from published_at
        # (government_alerts.py uses published_at|reported_at as effective date). Either is acceptable
        # per the review note: 'Date not stated' when no date is stated.
        assert dl == "Date not stated" or MONTH_YEAR_RE.match(dl), (
            f"dateLabel with empty reportedDate must be 'Date not stated' or 'Month YYYY'; got {dl!r}"
        )


class TestItemDateFields:
    def test_alerts_reported_date_and_label(self, body):
        if not body["alerts"]:
            pytest.skip("no specific alerts available right now")
        for a in body["alerts"]:
            _check_item_dates(a)

    def test_emerging_reported_date_and_label(self, body):
        if not body["emerging"]:
            pytest.skip("no emerging patterns available right now")
        for a in body["emerging"]:
            _check_item_dates(a)


# ---------------------------------------------------------------------- source name


class TestSourceName:
    def test_each_alert_has_real_source_name(self, body):
        if not body["alerts"]:
            pytest.skip("no specific alerts to evaluate source names")
        for a in body["alerts"]:
            src = a.get("source")
            assert isinstance(src, str) and src.strip(), f"empty 'source' on {a.get('title')}"
            assert not _looks_like_slug(src), (
                f"'source' looks like a raw source_id slug ({src!r}) on {a.get('title')}"
            )

    def test_each_emerging_has_real_source_name(self, body):
        if not body["emerging"]:
            pytest.skip("no emerging patterns to evaluate source names")
        for a in body["emerging"]:
            src = a.get("source")
            assert isinstance(src, str) and src.strip(), f"empty 'source' on {a.get('title')}"
            assert not _looks_like_slug(src), (
                f"'source' looks like a raw source_id slug ({src!r}) on {a.get('title')}"
            )


# ---------------------------------------------------------------------- recency + sort


def _effective_dt(item: dict) -> datetime | None:
    v = item.get("effectiveDate")
    if not v:
        return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return v


class TestRecencyAndSort:
    def _assert_sorted_desc_dates_first(self, items: list[dict], label: str) -> None:
        dated: list[datetime] = []
        seen_undated = False
        for it in items:
            dt = _effective_dt(it)
            if dt is None:
                seen_undated = True
            else:
                assert not seen_undated, (
                    f"{label}: a dated item ({it.get('title')!r} @ {dt.isoformat()}) appears "
                    "after an undated item; undated items must sort last"
                )
                dated.append(dt)
        for i in range(1, len(dated)):
            assert dated[i - 1] >= dated[i], (
                f"{label}: dated items not in descending order at position {i}: "
                f"{dated[i - 1].isoformat()} came before {dated[i].isoformat()}"
            )

    def test_alerts_sorted_most_recent_first(self, body):
        if len(body["alerts"]) < 2:
            pytest.skip("need at least 2 alerts to verify ordering")
        self._assert_sorted_desc_dates_first(body["alerts"], "alerts")

    def test_emerging_sorted_most_recent_first(self, body):
        if len(body["emerging"]) < 2:
            pytest.skip("need at least 2 emerging items to verify ordering")
        self._assert_sorted_desc_dates_first(body["emerging"], "emerging")

    def test_no_item_older_than_recency_cutoff(self, body):
        now = datetime.now(timezone.utc)
        offenders: list[str] = []
        for it in body["alerts"] + body["emerging"]:
            dt = _effective_dt(it)
            if dt and (now - dt) > RECENCY_CUTOFF:
                offenders.append(f"{it.get('title')!r} @ {dt.date()}")
        assert not offenders, f"items older than ~15 months present: {offenders}"


# ---------------------------------------------------------------------- auth guard (unchanged)


class TestAuthGuard:
    def test_requires_bearer(self):
        r = requests.get(f"{BASE_URL}/api/higgins/scams", headers={"X-Apollo-Raw": "1"}, timeout=TIMEOUT)
        assert r.status_code == 401
