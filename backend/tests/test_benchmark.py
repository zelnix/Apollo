"""Launch-gate benchmark harness (backend intelligence layer).

Runs the shared labelled corpus (frontend/src/benchmark/corpus.json) through
/api/intel/check-batch and reports:
  - intelligence-level detection on the subset of threats covered by Apollo's
    managed blocklist / Safe Browsing,
  - false positives on the clean set (any 'malicious' verdict on a clean URL).
Writes /app/test_reports/benchmark_report.json.

Run: cd /app/backend && python -m pytest tests/test_benchmark.py -q
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

BASE = os.environ.get("APOLLO_API_BASE", "http://localhost:8001/api")
CORPUS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "benchmark" / "corpus.json"
REPORT = Path("/app/test_reports/benchmark_report.json")
BLOCKLIST_HINTS = ("testsafebrowsing.appspot.com", "malware.testing.google.test", "apollo.test")


@pytest.fixture(scope="module")
def corpus():
    return json.loads(CORPUS.read_text())


@pytest.fixture(scope="module")
def batch(corpus):
    values = corpus["threats"] + corpus["clean"]
    r = requests.post(f"{BASE}/intel/check-batch", json={"indicator_type": "url", "values": values}, timeout=120)
    r.raise_for_status()
    return r.json()


def test_batch_shape(batch, corpus):
    assert len(batch) == len(corpus["threats"]) + len(corpus["clean"])
    for item in batch:
        assert item["result"] is not None or item["error"], item


def test_clean_set_false_positives(batch, corpus):
    clean = batch[len(corpus["threats"]):]
    fps = [c["value"] for c in clean if c["result"] and c["result"]["verdict"] == "malicious"]
    rate = len(fps) / len(clean)
    assert rate < 0.02, f"False positives: {fps}"


def test_blocklisted_threats_detected(batch, corpus):
    threats = batch[: len(corpus["threats"])]
    covered = [t for t in threats if any(h in t["value"] for h in BLOCKLIST_HINTS)]
    detected = [t for t in covered if t["result"] and t["result"]["verdict"] == "malicious"]
    assert covered, "corpus has no blocklist-covered threats"
    assert len(detected) / len(covered) >= 0.9, [t["value"] for t in covered if t not in detected]


def test_write_report(batch, corpus):
    n_t = len(corpus["threats"])
    threats, clean = batch[:n_t], batch[n_t:]
    coverage = {c["result"]["coverage"] for c in batch if c["result"]}
    intel_detected = [t["value"] for t in threats if t["result"] and t["result"]["verdict"] == "malicious"]
    fps = [c["value"] for c in clean if c["result"] and c["result"]["verdict"] == "malicious"]
    report = {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "corpus_version": corpus["version"],
        "scope": "backend intelligence layer only (on-device heuristics are scored in-app: Settings → Run threat benchmark)",
        "intel_coverage": sorted(coverage),
        "threats": n_t,
        "clean": len(clean),
        "intel_detected_threats": len(intel_detected),
        "intel_detection_rate_all_threats": len(intel_detected) / n_t,
        "clean_false_positives": len(fps),
        "false_positive_rate": len(fps) / len(clean),
        "gate_false_positive_lt_2pct": len(fps) / len(clean) < 0.02,
        "false_positive_urls": fps,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2))
    assert REPORT.exists()
