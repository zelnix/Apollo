#!/usr/bin/env python3
"""PIR Server Data Sync — exports Apollo's caller ID reputation database and pushes
it to the Apple Live Caller ID PIR server for re-indexing.

This script is designed to run as a cron job (e.g., daily at 2:00 AM):

    0 2 * * * /usr/bin/python3 /opt/apollo/backend/scripts/pir_sync.py

Or manually:
    python3 scripts/pir_sync.py --export-only        # just dump to file
    python3 scripts/pir_sync.py --pir-url https://pir.example.com/admin/reindex

Environment variables:
    APOLLO_API_URL       — Apollo backend base URL (default: http://localhost:8001)
    APOLLO_DEVICE_TOKEN  — Bearer token for authenticated export endpoint
    PIR_SERVER_URL       — PIR server admin reindex endpoint
    PIR_DATA_DIR         — Directory for export files (default: /tmp/apollo-pir)
    PIR_EXPORT_LIMIT     — Max entries to export (default: 500000)

Flow:
    1. Fetch reputation database from Apollo backend via GET /api/call/caller-id-db/export
    2. Transform to PIR server ingestion format
    3. Write to local file (always)
    4. POST to PIR server reindex endpoint (if PIR_SERVER_URL is set)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def export_from_apollo(api_url: str, token: str | None, limit: int) -> list[dict]:
    """Fetch the caller ID reputation database from Apollo's export endpoint."""
    url = f"{api_url}/api/call/caller-id-db/export?limit={limit}"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    log(f"Fetching from {url} (limit={limit})...")
    req = Request(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
    except HTTPError as e:
        log(f"HTTP error {e.code}: {e.reason}")
        sys.exit(1)
    except URLError as e:
        log(f"Connection error: {e.reason}")
        sys.exit(1)

    entries = data.get("entries", [])
    total = data.get("count", len(entries))
    log(f"Received {total} entries from Apollo backend")
    return entries


def transform_for_pir(entries: list[dict]) -> list[dict]:
    """Transform Apollo's export format to Apple PIR server ingestion format.

    Apple's PIR server expects:
    [
      {"phoneNumber": 61412345678, "label": "Likely spam", "category": "spam"},
      ...
    ]

    Apollo's export already provides this format, so this is mostly validation/cleanup.
    """
    valid = []
    skipped = 0
    for entry in entries:
        phone = entry.get("phoneNumber")
        label = entry.get("label", "Unknown caller")
        category = entry.get("category", "unknown_risk")

        if not isinstance(phone, int) or phone <= 0:
            skipped += 1
            continue

        valid.append({
            "phoneNumber": phone,
            "label": str(label)[:100],  # PIR label length limit
            "category": str(category),
        })

    if skipped:
        log(f"Skipped {skipped} entries with invalid phone numbers")
    log(f"Transformed {len(valid)} valid entries for PIR server")
    return valid


def write_export(entries: list[dict], data_dir: str) -> str:
    """Write the PIR-formatted data to a local JSON file."""
    path = Path(data_dir)
    path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    filename = f"pir_export_{timestamp}.json"
    filepath = path / filename

    with open(filepath, "w") as f:
        json.dump(entries, f, separators=(",", ":"))

    size_kb = filepath.stat().st_size / 1024
    log(f"Wrote {len(entries)} entries to {filepath} ({size_kb:.1f} KB)")

    # Also write a "latest" symlink for easy consumption
    latest = path / "pir_latest.json"
    if latest.is_symlink() or latest.exists():
        latest.unlink()
    latest.symlink_to(filepath)
    log(f"Updated symlink: {latest} → {filename}")

    return str(filepath)


def push_to_pir_server(entries: list[dict], pir_url: str) -> bool:
    """POST the PIR data to the PIR server's admin reindex endpoint."""
    log(f"Pushing {len(entries)} entries to PIR server at {pir_url}...")
    payload = json.dumps(entries).encode("utf-8")
    req = Request(
        pir_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        start = time.monotonic()
        with urlopen(req, timeout=120) as resp:
            elapsed = time.monotonic() - start
            body = resp.read().decode("utf-8", errors="replace")
            log(f"PIR server responded {resp.status} in {elapsed:.1f}s: {body[:200]}")
            return 200 <= resp.status < 300
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        log(f"PIR server error {e.code}: {body[:200]}")
        return False
    except URLError as e:
        log(f"PIR server connection error: {e.reason}")
        return False


def write_sync_status(data_dir: str, entries_count: int, pushed: bool | None, pir_url: str | None) -> None:
    """Write a sync status file for monitoring."""
    status = {
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "entries_exported": entries_count,
        "pir_push_attempted": pir_url is not None,
        "pir_push_success": pushed,
        "pir_server_url": pir_url or "",
    }
    status_path = Path(data_dir) / "sync_status.json"
    with open(status_path, "w") as f:
        json.dump(status, f, indent=2)
    log(f"Sync status written to {status_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Apollo PIR Server Data Sync")
    parser.add_argument("--export-only", action="store_true", help="Export to file only, don't push to PIR server")
    parser.add_argument("--pir-url", type=str, default=None, help="PIR server reindex endpoint URL (overrides PIR_SERVER_URL env)")
    parser.add_argument("--api-url", type=str, default=None, help="Apollo backend URL (overrides APOLLO_API_URL env)")
    parser.add_argument("--limit", type=int, default=None, help="Max entries to export (overrides PIR_EXPORT_LIMIT env)")
    parser.add_argument("--data-dir", type=str, default=None, help="Output directory (overrides PIR_DATA_DIR env)")
    args = parser.parse_args()

    api_url = args.api_url or os.environ.get("APOLLO_API_URL", "http://localhost:8001")
    token = os.environ.get("APOLLO_DEVICE_TOKEN")
    pir_url = args.pir_url or os.environ.get("PIR_SERVER_URL")
    data_dir = args.data_dir or os.environ.get("PIR_DATA_DIR", "/tmp/apollo-pir")
    limit = args.limit or int(os.environ.get("PIR_EXPORT_LIMIT", "500000"))

    log("=== Apollo PIR Sync Starting ===")
    log(f"API: {api_url} | PIR: {pir_url or '(not set)'} | Limit: {limit}")

    # Step 1: Export from Apollo
    raw_entries = export_from_apollo(api_url, token, limit)

    if not raw_entries:
        log("No entries to export. Writing empty file and exiting.")
        write_export([], data_dir)
        write_sync_status(data_dir, 0, None, pir_url)
        return

    # Step 2: Transform
    pir_entries = transform_for_pir(raw_entries)

    # Step 3: Write to file
    write_export(pir_entries, data_dir)

    # Step 4: Push to PIR server (if configured and not export-only)
    pushed: bool | None = None
    if not args.export_only and pir_url:
        pushed = push_to_pir_server(pir_entries, pir_url)
        if not pushed:
            log("WARNING: PIR server push failed. Data was exported to file successfully.")
    elif not pir_url:
        log("PIR_SERVER_URL not set — skipping push. Use --pir-url or set the environment variable.")

    write_sync_status(data_dir, len(pir_entries), pushed, pir_url)
    log(f"=== Apollo PIR Sync Complete ({len(pir_entries)} entries) ===")


if __name__ == "__main__":
    main()
