"""Out-of-band DNS/DoH capability characterization: nonce receipt collector.

COMPLETELY SEPARATE from M1/M2 rule distribution and signing (never reads or writes
rule_bundles/rule_versions/key_metadata/service_config, no new Mongo collection, no auth token).

Why this exists: for the app-embedded DoH probe, a manually-reported "the page looked like it
loaded" judgment from the tester is not strong enough evidence to support a machine BYPASSED
verdict -- it reintroduces exactly the kind of human interpretation the M2.1 freeze worked to
remove. This endpoint gives the diagnostic tool an objective, server-verified alternative: the
probe page served at the dedicated, already-DNS/TLS-provisioned host
(https://dnsprobe.blocktest.btciq.app/dnsdiag/?n=<nonce> -- see
docs/dns-capability-characterization.md for the exact static asset to host there) calls
POST /api/dns-diagnostics/receipts/{nonce} exactly once, purely client-side, when it loads. The
Apollo app polls GET .../receipts/{nonce} while independently watching its own attributed
THREAT_BLOCKED event stream, and only classifies BYPASSED when this receipt confirms independently.

Deliberately in-memory only (never persisted to Mongo): a characterization session is short-lived
(tens of minutes at most), this is not acceptance-relevant state, and keeping it out of Mongo means
this file can never touch, migrate, or risk any M1/M2 collection.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(prefix="/dns-diagnostics", tags=["dns-diagnostics"])

NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
RECEIPT_TTL_SECONDS = 3600


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _store(request: Request) -> dict:
    if not hasattr(request.app.state, "dns_diagnostic_receipts"):
        request.app.state.dns_diagnostic_receipts = {}
    return request.app.state.dns_diagnostic_receipts


def _prune(store: dict) -> None:
    cutoff = time.time() - RECEIPT_TTL_SECONDS
    for k in [k for k, v in store.items() if v["receivedAtEpoch"] < cutoff]:
        del store[k]


def _validate(nonce: str) -> None:
    if not NONCE_RE.match(nonce):
        raise HTTPException(status_code=400, detail="invalid nonce format")


@router.post("/receipts/{nonce}")
async def record_receipt(nonce: str, request: Request, response: Response) -> dict:
    _validate(nonce)
    response.headers["Cache-Control"] = "no-store"
    store = _store(request)
    _prune(store)
    now = time.time()
    # First receipt wins -- a probe page hit more than once (e.g. a browser retry) still reports the
    # original arrival time, not the latest one.
    store.setdefault(nonce, {"receivedAtEpoch": now, "receivedAt": _iso(now), "userAgent": request.headers.get("user-agent", "")[:200]})
    return {"nonce": nonce, "recorded": True}


@router.get("/receipts/{nonce}")
async def get_receipt(nonce: str, request: Request, response: Response) -> dict:
    _validate(nonce)
    response.headers["Cache-Control"] = "no-store"
    store = _store(request)
    _prune(store)
    entry = store.get(nonce)
    if entry is None:
        return {"nonce": nonce, "received": False, "receivedAt": None}
    return {"nonce": nonce, "received": True, "receivedAt": entry["receivedAt"]}
