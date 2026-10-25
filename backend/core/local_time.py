"""Times a person reads are in their own local time, never UTC.

The phone shares only a coarse UTC offset in minutes (at setup and with each heartbeat, `tz_offset_minutes`),
nothing else about where it is. Times are stored in UTC and turned into local time only when shown.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

MAX_OFFSET_MINUTES = 840


def clamp(offset_minutes: Any) -> int:
    try:
        value = int(offset_minutes or 0)
    except (TypeError, ValueError):
        return 0
    return max(-MAX_OFFSET_MINUTES, min(MAX_OFFSET_MINUTES, value))


def parse(value: Any) -> Optional[datetime]:
    """A stored time (datetime or ISO text) as an aware datetime; naive values are UTC, as Mongo returns them."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        try:
            dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def label(value: Any, offset_minutes: Any, *, with_time: bool = True) -> str:
    """'25 Oct 2026, 3:16 pm' in the person's local time. '—' when there is no time."""
    dt = parse(value)
    if not dt:
        return "—"
    local = dt.astimezone(timezone(timedelta(minutes=clamp(offset_minutes))))
    day = f"{local.day} {local:%b %Y}"
    if not with_time:
        return day
    return f"{day}, {local.hour % 12 or 12}:{local:%M} {'am' if local.hour < 12 else 'pm'}"


def zone_label(offset_minutes: Any) -> str:
    """The zone the times are in, for a printed report: 'UTC+11:00'."""
    minutes = clamp(offset_minutes)
    sign = "+" if minutes >= 0 else "-"
    return f"UTC{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"
