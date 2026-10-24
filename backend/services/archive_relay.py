"""Read an official feed through the Internet Archive when the source blocks cloud servers.

cyber.gov.au sits behind an edge that drops every request from cloud data centres — Apollo's servers and
Google's own fetcher alike — while the Internet Archive's crawler can still read it. For a feed marked
`relay: internet_archive`, Apollo asks the Archive to save a fresh copy (Save Page Now), then reads the
ORIGINAL bytes of that capture (`id_` mode: no Archive toolbar or rewriting). A capture is used only when it
is a copy of the feed's exact address and is less than a day old.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urljoin

import httpx

from core.db import now_utc
from services.outbound import public_get

INTERNET_ARCHIVE = "internet_archive"
MAX_COPY_AGE = timedelta(hours=24)
_ARCHIVE = "https://web.archive.org"
_CAPTURE = re.compile(r"^https?://web\.archive\.org/web/(\d{14})(?:id_)?/(.+)$")


class ArchiveRelayError(ValueError):
    """Fixed reason codes, explained in plain words on Feed Health."""


def _address(url: str) -> str:
    return re.sub(r"^https?://", "", url).rstrip("/").lower()


def capture_of(archive_url: str | None, feed_url: str) -> datetime | None:
    """When the Archive URL is a capture of exactly `feed_url`, the time that capture was made."""
    match = _CAPTURE.match(archive_url or "")
    if not match or _address(match.group(2)) != _address(feed_url):
        return None
    return datetime.strptime(match.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


async def _save_now(feed_url: str) -> str | None:
    """Ask the Archive to capture the feed now (takes ~25 s). Returns the capture URL it redirects to."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0), follow_redirects=False, trust_env=False,
                                     headers={"User-Agent": "Apollo official-feed reader"}) as http:
            response = await http.get(f"{_ARCHIVE}/save/{feed_url}")
    except httpx.HTTPError:
        return None
    location = response.headers.get("location")
    return urljoin(f"{_ARCHIVE}/", location) if location else None


async def _latest_copy(feed_url: str) -> str | None:
    """The newest existing capture, for when a fresh save is refused (the Archive rate-limits saves)."""
    try:
        response = await public_get(f"{_ARCHIVE}/cdx/search/cdx?url={quote(feed_url, safe='')}&output=json&limit=-1&fl=timestamp&filter=statuscode:200", max_hops=1)
        rows = json.loads(response.content) if response.status_code == 200 else []
    except Exception:  # noqa: BLE001 — an unreachable index just means no fallback copy
        return None
    return f"{_ARCHIVE}/web/{rows[-1][0]}/{feed_url}" if len(rows) > 1 and rows[-1] else None


async def fetch(feed_url: str) -> tuple[httpx.Response, datetime]:
    """The feed's original bytes from a capture under a day old, and when that capture was made."""
    now = now_utc()
    captured = capture_of(await _save_now(feed_url), feed_url)
    if not captured or now - captured > MAX_COPY_AGE:
        captured = capture_of(await _latest_copy(feed_url), feed_url)
    if not captured:
        raise ArchiveRelayError("archive_unavailable")
    if now - captured > MAX_COPY_AGE:
        raise ArchiveRelayError("archive_copy_too_old")
    response = await public_get(f"{_ARCHIVE}/web/{captured.strftime('%Y%m%d%H%M%S')}id_/{feed_url}", max_hops=2)
    if response.status_code != 200:
        raise ArchiveRelayError("archive_unavailable")
    served = capture_of(str(response.request.url), feed_url)  # the Archive may redirect to the nearest capture
    if not served:
        raise ArchiveRelayError("archive_wrong_capture")
    if now - served > MAX_COPY_AGE:
        raise ArchiveRelayError("archive_copy_too_old")
    return response, served
