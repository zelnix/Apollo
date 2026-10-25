"""Knowledge sufficiency: does Apollo already know enough to skip a paid external call?

Deterministic, no AI. Three answers:
  KNOWN    — Apollo KB knowledge, or a reusable result that is fresh, about this exact subject, complete and not
             contradicted. Reuse it; the external call isn't needed.
  PARTIAL  — something relevant, but stale, incomplete, contradicted or not allowed to settle a live check. The
             existing path runs (for what is still open) and the result is refreshed.
  UNKNOWN  — nothing relevant and fresh. The existing path runs as it always has.

This is an optimisation only. It never lowers what an investigation must establish: a check that must be current
for security reasons (`live`) is never settled from memory, and anything short of KNOWN leaves the existing
investigation path exactly as it was.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Literal, Optional

from core.db import now_utc
from services import reusable_intel

KNOWN, PARTIAL, UNKNOWN = "KNOWN", "PARTIAL", "UNKNOWN"
Level = Literal["KNOWN", "PARTIAL", "UNKNOWN"]


@dataclass(frozen=True)
class Requirement:
    subject_key: str
    needs: tuple[str, ...] = ()                       # payload fields that must be present for the immediate need
    usable: Optional[Callable[[dict], bool]] = None   # the payload actually answers it (e.g. a sourced lookup)
    live: bool = False                                # must be current for security: never settled from memory


@dataclass
class Decision:
    level: Level
    reason: str                                       # content-free: kb_match, fresh_cache, expired, missing:<f>, ...
    kb: list[dict] = field(default_factory=list)      # KB entries to present (KNOWN by KB)
    reuse: list[dict] = field(default_factory=list)   # reusable records to reuse (KNOWN by cache)
    stale: list[dict] = field(default_factory=list)   # expired records: historical context only, never current

    @property
    def known(self) -> bool:
        return self.level == KNOWN

    def events(self, *, call_made: bool) -> list[str]:
        """The aggregate counters this decision adds (reusable_intel.EVENTS)."""
        out = [f"sufficiency_{self.level.lower()}"]
        if self.kb:
            out.append("kb_hit")
        if self.reuse:
            out.append("cache_hit")
        if self.stale:
            out.append("cache_expired")
        out.append("external_call_required" if call_made else "external_call_avoided")
        return out


def assess(req: Requirement, *, kb: list[dict] | tuple = (), cache: list[dict] | tuple = (), now: datetime | None = None) -> Decision:
    now = now or now_utc()
    current_kb = [e for e in kb if e.get("status") != "historical"]
    relevant = [r for r in cache if r.get("subject_key") == req.subject_key]
    fresh = [r for r in relevant if reusable_intel.fresh(r, now)]
    stale = [r for r in relevant if r not in fresh]

    if req.live:
        # Current information is required: memory can only be context.
        return Decision(PARTIAL if (kb or relevant) else UNKNOWN, "live_required", stale=stale + fresh)
    if kb:
        # The KB's own rules chose these entries; a historical one is presented with its own "may be out of date" label.
        return Decision(KNOWN, "kb_match" if current_kb else "kb_historical", kb=list(kb))
    if not fresh:
        if stale:
            return Decision(PARTIAL, "expired", stale=stale)
        return Decision(UNKNOWN, "no_match")
    statuses = {str((r.get("payload") or {}).get("status", "")) for r in fresh}
    if len(statuses) > 1:
        return Decision(PARTIAL, "conflict", stale=stale)
    record = fresh[0]
    payload = record.get("payload") or {}
    missing = next((f for f in req.needs if payload.get(f) in (None, "", [], {})), None)
    if missing:
        return Decision(PARTIAL, f"missing:{missing}", stale=stale)
    if req.usable and not req.usable(payload):
        return Decision(PARTIAL, "not_usable", stale=stale)
    return Decision(KNOWN, "fresh_cache", reuse=[record], stale=stale)
