"""Quiet hours hold the gentle alerts instead of dropping them.

A growl raised at 2am used to vanish. It is now held until the quiet window ends and released as its
own notification, in the order it was raised. Urgent alerts (barking/biting) are never held.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from routers.devices import in_quiet_hours, quiet_hours_end_utc

# 22:00 → 07:00 local, device two hours ahead of UTC.
QH = {"enabled": True, "start_minutes": 22 * 60, "end_minutes": 7 * 60, "tz_offset_minutes": 120}


def utc(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_no_end_when_not_in_a_quiet_window():
    # 10:00 UTC = midday locally — wide awake, nothing to hold.
    assert quiet_hours_end_utc(QH, utc(2026, 6, 1, 10)) is None


def test_disabled_quiet_hours_never_hold():
    assert quiet_hours_end_utc({**QH, "enabled": False}, utc(2026, 6, 1, 1)) is None
    assert quiet_hours_end_utc(None, utc(2026, 6, 1, 1)) is None


def test_alert_after_midnight_is_released_the_same_morning():
    # 00:30 UTC = 02:30 locally, inside the window; 07:00 local = 05:00 UTC the same day.
    at = utc(2026, 6, 1, 0, 30)
    assert in_quiet_hours(QH, at)
    assert quiet_hours_end_utc(QH, at) == utc(2026, 6, 1, 5)


def test_alert_before_midnight_is_released_the_next_morning():
    # 21:00 UTC = 23:00 locally on the 1st; the window ends 07:00 local on the 2nd = 05:00 UTC.
    at = utc(2026, 6, 1, 21)
    assert in_quiet_hours(QH, at)
    assert quiet_hours_end_utc(QH, at) == utc(2026, 6, 2, 5)


def test_release_time_is_always_in_the_future_and_within_a_day():
    for hour in range(0, 24):
        at = utc(2026, 6, 1, hour)
        end = quiet_hours_end_utc(QH, at)
        if end is None:
            assert not in_quiet_hours(QH, at)
            continue
        assert end > at
        assert end - at <= timedelta(days=1)


def test_window_that_does_not_cross_midnight():
    qh = {"enabled": True, "start_minutes": 13 * 60, "end_minutes": 15 * 60, "tz_offset_minutes": 0}
    at = utc(2026, 6, 1, 14)
    assert in_quiet_hours(qh, at)
    assert quiet_hours_end_utc(qh, at) == utc(2026, 6, 1, 15)
