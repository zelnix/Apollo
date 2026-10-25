"""Times a person reads are their own local time on the 12-hour clock, never UTC: the investigation report PDF and
the admin portal (which converts in the admin's browser)."""
from datetime import datetime, timezone

from core import local_time
from routers import admin_portal
from services.higgins.pdf_export import generate_pdf


AT = datetime(2026, 10, 25, 4, 16, tzinfo=timezone.utc)


def test_local_label_is_the_phones_time_on_the_12_hour_clock():
    assert local_time.label(AT, 660) == "25 Oct 2026, 3:16 pm"
    assert local_time.label(AT, 480) == "25 Oct 2026, 12:16 pm"
    assert local_time.label("2026-10-24T23:30:00Z", 660) == "25 Oct 2026, 10:30 am", "the local date, not the UTC date"
    assert local_time.label(datetime(2026, 10, 25, 0, 5), 0) == "25 Oct 2026, 12:05 am", "naive values are UTC"
    assert local_time.label(None, 0) == "—" and local_time.label("not a time", 0) == "—"
    assert local_time.clamp("9999") == 840 and local_time.clamp(None) == 0
    assert local_time.zone_label(-330) == "UTC-05:30"


def _pdf_text(tz: int) -> str:
    from pypdf import PdfReader
    import io
    case = {"id": "case-1234567890", "createdAt": "2026-10-25T04:16:00+00:00", "evidenceExpiresAt": "2026-10-26T04:16:00+00:00",
            "response": {"overview": "A test.", "assessment": "concern_found", "findings": []}}
    pdf = generate_pdf(case, [], subject="Test", generated_at=AT, tz_offset_minutes=tz)
    return "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)


def test_the_report_pdf_reads_in_the_phones_local_time():
    text = " ".join(_pdf_text(660).split())
    assert "25 Oct 2026, 3:16 pm" in text
    assert "26 Oct 2026, 3:16 pm" in text
    assert "phone's local time (UTC+11:00)" in text
    assert "04:16" not in text


def test_the_admin_portal_sends_utc_for_the_browser_to_show_locally():
    html = admin_portal._t(AT)
    assert 'class="lt"' in html and 'datetime="2026-10-25T04:16:00+00:00"' in html
    assert admin_portal._t(None) == "—" and admin_portal._t("abc") == "—"
    page = admin_portal._shell("x", "/", "body", admin={"email": "a@b.c"})
    assert "hour12:true" in page and "time.lt" in page
