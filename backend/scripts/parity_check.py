"""Compare preview and production: does production behave the way preview was tested?

Run after every deploy:
    cd /app/backend && python scripts/parity_check.py --production https://threat-patrol-1.emergent.host

Reads each server's /api/health/parity fingerprint (no secret values) and prints every difference:
code build, Learn library, feeds each server can read, settings, which credentials are set, file storage.
Exit code 0 = no differences, 1 = differences found, 2 = a server could not be checked.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import requests

TOKENS = Path(tempfile.gettempdir()) / "apollo_parity_tokens.json"


def _preview_url() -> str:
    for line in (Path(__file__).resolve().parents[2] / "frontend" / ".env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise SystemExit("EXPO_PUBLIC_BACKEND_URL not found in frontend/.env")


def _token(base: str) -> str:
    """One anonymous device credential per server, reused between runs."""
    cache = json.loads(TOKENS.read_text()) if TOKENS.exists() else {}
    if base not in cache:
        res = requests.post(f"{base}/api/devices/register", json={"platform": "web", "adapter_mode": "mock"},
                            headers={"User-Agent": "apollo-parity-check"}, timeout=30)
        res.raise_for_status(); cache[base] = res.json()["device_token"]
        TOKENS.write_text(json.dumps(cache)); os.chmod(TOKENS, 0o600)
    return cache[base]


def fingerprint(base: str) -> dict | None:
    res = requests.get(f"{base}/api/health/parity", headers={"Authorization": f"Bearer {_token(base)}"}, timeout=60)
    if res.status_code == 401:  # stale credential (e.g. data wiped) — register again once
        cache = json.loads(TOKENS.read_text()); cache.pop(base, None); TOKENS.write_text(json.dumps(cache))
        res = requests.get(f"{base}/api/health/parity", headers={"Authorization": f"Bearer {_token(base)}"}, timeout=60)
    return res.json() if res.status_code == 200 else None


def differences(preview: dict, production: dict, path: str = "") -> list[str]:
    out = []
    for key in sorted(set(preview) | set(production)):
        a, b, where = preview.get(key), production.get(key), f"{path}{key}"
        if isinstance(a, dict) and isinstance(b, dict):
            out += differences(a, b, f"{where}.")
        elif a != b:
            out.append(f"{where}: preview={json.dumps(a)}  production={json.dumps(b)}")
    return out


# Feed-grown Learn articles accrue from each server's own sync history, so their counts differ by design.
# Everything else (code, curated library, settings, credentials, storage, which feeds work) should match.
EXPECTED = ("learn.published:", "learn.shownOnLearnScreen:", "learn.bySourceType.automated_feed:", "learn.withoutThumbnail:")


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--production", required=True); parser.add_argument("--preview", default=None)
    args = parser.parse_args()
    preview_base, production_base = (args.preview or _preview_url()).rstrip("/"), args.production.rstrip("/")
    preview, production = fingerprint(preview_base), fingerprint(production_base)
    if preview is None:
        print(f"Preview {preview_base} has no parity endpoint — restart the preview backend."); return 2
    if production is None:
        print(f"Production {production_base} has no parity endpoint, so it is running an older build than preview. Redeploy, then run this again."); return 2
    found = differences(preview, production)
    real = [line for line in found if not line.startswith(EXPECTED)]
    accrued = [line for line in found if line.startswith(EXPECTED)]
    print(f"Preview:    {preview_base}\nProduction: {production_base}")
    print("Production matches preview." if not real else f"{len(real)} difference(s) to fix:\n  " + "\n  ".join(real))
    if accrued:
        print("Feed-grown article counts (each server's own sync history):\n  " + "\n  ".join(accrued))
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(main())
