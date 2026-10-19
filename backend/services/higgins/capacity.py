"""Versioned transport/scheduling policy, not a claim about model capabilities."""
from dataclasses import asdict, dataclass
import asyncio
from functools import wraps
import inspect
import os

from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()


@dataclass(frozen=True)
class Bound:
    value: int
    unit: str
    purpose: str
    overflow: str


POLICY_VERSION = "2026-10-11.1"
TEXT = Bound(int(os.getenv("HIGGINS_MAX_TEXT_CHARACTERS", "262144")), "characters",
             "Bound transport allocation before provider token admission", "reject explicitly; never slice")
ITEMS = Bound(int(os.getenv("HIGGINS_MAX_ITEMS", "256")), "items",
              "Bound one request's inventory; additional batches require continuation", "reject explicitly; never slice")
OUTPUT = Bound(int(os.getenv("HIGGINS_OUTPUT_TOKENS", "16384")), "tokens",
               "Reserve response and reasoning within the provider's output limit", "non-STOP output is incomplete")
SCHEMA_RESERVE = Bound(1024, "tokens", "Conservative role/tool-wrapper overhead not exposed by Developer API token counting", "reject; do not trim context")
LIFETIME_SECONDS = 15 * 60  # hard ceiling for active-investigation work; never extended by retries
TEMPORARY_RETENTION = "apollo_15_minute_temporary"
WORK_SECONDS = 300
CALL_SECONDS = 90

# ── Retention Policy ───────────────────────────────────────────────────
# Source evidence content (images, files, screenshots): delete within 24 hours of acquisition.
EVIDENCE_RETENTION_SECONDS = int(os.getenv("EVIDENCE_RETENTION_SECONDS", str(24 * 3600)))  # 24 hours
# Device-local investigations: the server does NOT retain completed investigations.
# These constants are kept at zero / removed for backward compat of imports.
REPORT_RETENTION_SECONDS = 0  # No server-side report retention
REPORT_STORAGE_LIMIT_BYTES = 0  # No server-side saved-report storage allowance
# Retention class tags — SAVED_RETENTION is no longer promoted to; existing references are safe no-ops.
SAVED_RETENTION = "apollo_saved_report"  # Legacy constant — never assigned to new cases


def policy() -> dict:
    return {"version": POLICY_VERSION, "bounds": {k: asdict(v) for k, v in
            {"text": TEXT, "items": ITEMS, "output": OUTPUT, "schemaReserve": SCHEMA_RESERVE}.items()},
            "lifetimeSeconds": LIFETIME_SECONDS, "workSeconds": WORK_SECONDS}


def bounded_analysis(function):
    """Bound the complete compatibility request, including queued reputation/page work.

This is not durable job recovery. A timeout cancels descendants and reports non-completion,
never a verdict. Evaluate the original annotations to preserve FastAPI's body/form contract.
"""
    @wraps(function)
    async def wrapped(*args, **kwargs):
        try:
            return await asyncio.wait_for(function(*args, **kwargs), timeout=WORK_SECONDS)
        except asyncio.TimeoutError as exc:
            raise HTTPException(504, 'The investigation work budget was reached. Not all evidence was processed; no complete conclusion is available.') from exc
    wrapped.__signature__ = inspect.signature(function, eval_str=True)
    return wrapped