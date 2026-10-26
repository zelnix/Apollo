"""Check completeness — Apollo never presents an incomplete examination as a complete one.

An incomplete check is one Apollo needed but couldn't finish: a reputation source that didn't answer, a link whose
final destination couldn't be verified, a number scored only from an earlier lookup. It is recorded as
{check, status, failure, detail, source}. When no rule is met and some check is incomplete, the result is
"No threat found by available checks" — not Limited, and never the unqualified "No threat identified".
The wording follows the kind of check and how it failed, never the provider. Mirror:
frontend/src/domain/triage/completeness.ts. Words: content/triage_catalogue.json "completeness".
"""
from __future__ import annotations

from typing import Optional

from services.triage.catalogue import CATALOGUE

_WORDS: dict = CATALOGUE["completeness"]
AVAILABLE_CHECKS: str = _WORDS["availableChecksLabel"]


def incomplete_check(check: str, failure: Optional[str], *, status: str = "unavailable", detail: str = "",
                     source: Optional[str] = None, at: Optional[str] = None) -> dict:
    """One incomplete check. status: "unavailable" (no answer), "unresolved" (final destination), "stale" (earlier result used)."""
    return {"check": check, "status": status, "failure": failure, "detail": detail, "source": source, "at": at}


def incomplete_plain(check: dict) -> str:
    """'Apollo couldn't verify where this link finally leads (the website's address doesn't exist).'"""
    what = _WORDS["checks"].get(check.get("check"), "A check didn't complete")
    why = _WORDS["failures"].get(check.get("failure") or "", "")
    if check.get("status") == "stale":
        return f"{what}: {_WORDS['stale'].format(failure=why or 'no answer')}."
    return f"{what} ({why})." if why else f"{what}."


def from_sources(sources: list[dict]) -> list[dict]:
    """Every source of a reputation answer that didn't complete (status unavailable / not_configured)."""
    return [incomplete_check(s.get("check") or "reputation", s.get("failure"),
                             status="unresolved" if s.get("check") == "final_destination" else "unavailable",
                             detail=s.get("detail") or "", source=s.get("name"))
            for s in sources if s.get("status") in ("unavailable", "not_configured")]
