"""Canonical Triage rule catalogue loader (single source of truth for both engines)."""
from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "content" / "triage_catalogue.json"

CATALOGUE: dict = json.loads(_PATH.read_text(encoding="utf-8"))
VERSION: int = CATALOGUE["version"]
RULES: dict[str, dict] = {row["id"]: row for row in CATALOGUE["rules"]}
GAP_CODES: dict[str, dict] = {row["code"]: row for row in CATALOGUE["coverageGapCodes"]}
RETRY_ATTEMPTS: int = CATALOGUE["retryPolicy"]["attempts"]
RETRYABLE_GAPS: set[str] = set(CATALOGUE["retryPolicy"]["appliesTo"])

RULES_BY_CATEGORY: dict[str, list[dict]] = {}
for _row in CATALOGUE["rules"]:
    RULES_BY_CATEGORY.setdefault(_row["category"], []).append(_row)


def rule(rule_id: str) -> dict:
    return RULES[rule_id]


def gap_recoverable(code: str) -> bool:
    return bool(GAP_CODES.get(code, {}).get("recoverable", False))


def gap_plain(code: str) -> str:
    return GAP_CODES.get(code, {}).get("plain", "Apollo couldn't complete part of this check.")
