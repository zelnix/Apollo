"""Canonical Triage rule catalogue loader (single source of truth for both engines)."""
from __future__ import annotations

import json
import re
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
    return GAP_CODES.get(code, {}).get("plain", "ApolloSG couldn't complete part of this check.")


_CODE_LIST = re.compile(r"\b[A-Z]+(?:_[A-Z]+)+(?:,\s*[A-Z]+(?:_[A-Z]+)+)*\b")
LIMITED_CAUTION = ("Treat this with caution. ApolloSG couldn't check it fully, so it can't say it's safe. "
                   "Don't act on it until you've confirmed it another way.")


def plain_codes(text: str) -> str:
    """Person-facing wording: every Coverage Gap code (or list of them) becomes its plain-English sentence.
    The codes themselves stay on the stored record for the DI view."""
    if not text:
        return text
    text = re.sub(r"^Coverage gap:\s*", "Couldn't check: ", text)
    return _CODE_LIST.sub(lambda m: " ".join(gap_plain(code.strip()) if code.strip() in GAP_CODES else code.strip().replace("_", " ").lower()
                                             for code in m.group(0).split(",")), text)
