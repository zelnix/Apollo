"""Where a scam alert applies (services/scam_analysis.applies_in + government_alerts._alert): an overseas alert is
local to its source's country only when its headline or summary names something only that country has. No AI.

Run: cd /app/backend && python -m pytest tests/test_scam_scope.py -q
"""
from datetime import datetime, timezone

import pytest

from services import government_alerts as ga
from services import scam_analysis as sa


@pytest.mark.parametrize("region,title,summary,expected,named", [
    ("US", "The FTC is not calling to deactivate your phone number", "Someone claiming to be an FTC official calls.", "US", "FTC"),
    ("US", "What to know ahead of Open Enrollment to avoid health insurance scams", "They pick up during Open Enrollment for Medicare.", "US", "Open Enrollment"),
    ("US", "Scammers Exploit 2026 U.S. Midterm Election to Perpetrate Multiple Fraud Schemes", "", "US", "U.S."),
    ("US", "Maryland Man Convicted of $18.7 Million Medicare Fraud", "", "US", "Maryland"),
    ("UK", "Fake HMRC tax refund texts", "", "UK", "HMRC"),
    ("AU", "Australian Taxation Office (ATO) and 'myGov' impersonation scams", "", "AU", "Australian"),
    ("NZ", "Inland Revenue phishing emails", "", "NZ", "Inland Revenue"),
    ("CA", "Scammers pretending to be the CRA", "", "CA", "CRA"),
])
def test_naming_something_only_its_country_has_makes_an_alert_local(region, title, summary, expected, named):
    assert sa.applies_in(title, summary, region) == (expected, named)


@pytest.mark.parametrize("region,title,summary", [
    ("US", "Scammers are spoofing car dealership websites: What you need to know", ""),
    ("UK", "UK and partners expose Russian state-supported actors for new 'zero-click' phishing campaign", "International partners issue warning."),
    ("AU", "Scam alert: Fake crypto trading platforms", "Scam alert: Fake crypto trading platforms"),
    ("EU", "Europol urges early action to protect cryptocurrencies", ""),
    ("GLOBAL", "The FTC is not calling", "Unknown source region: nothing to compare against."),
    ("US", "Romance scammers target Americans and Australians", "Naming another country too means it spans countries."),
    ("US", "Contact us if you lost money to a romance scam", "Lower-case 'us' is a word, not the country."),
])
def test_everything_else_applies_everywhere(region, title, summary):
    assert sa.applies_in(title, summary, region) == ("everywhere", "")


def _row(source_id: str, title: str, summary: str = "") -> dict:
    now = datetime.now(timezone.utc)
    return {"source_id": source_id, "title": title, "summary": summary, "url": f"https://example.org/{source_id}", "content_type": "live_alert",
            "trust_status": "recognised_government", "published_at": now, "last_checked_at": now}


HIGH_OVERSEAS = {"tier": "specific_scam", "severity": "HIGH", "australianRelevance": "potential",
                 "australianRelevanceReason": "Reported overseas; it doesn't mention Australia."}


def test_a_us_only_alert_is_overseas_only_and_never_growls():
    alert = ga._alert(_row("ftc", "The FTC is not calling to deactivate your phone number"), {}, HIGH_OVERSEAS, datetime.now(timezone.utc))
    assert alert["appliesIn"] == "US" and alert["appliesInLabel"] == "United States"
    assert alert["appliesInReason"] == 'It names "FTC", which is specific to the United States.'
    assert alert["australianRelevance"] == "overseas_only" and alert["growling"] is False


def test_an_overseas_alert_that_applies_everywhere_keeps_its_relevance_and_growl():
    alert = ga._alert(_row("ftc", "Scam alert: fake car dealership websites are actively targeting buyers"), {}, HIGH_OVERSEAS, datetime.now(timezone.utc))
    assert alert["appliesIn"] == "everywhere" and alert["appliesInLabel"] == "Everywhere"
    assert alert["australianRelevance"] == "potential" and alert["growling"] is True


def test_an_australian_local_alert_still_counts_for_australia():
    analysis = {**HIGH_OVERSEAS, "australianRelevance": "confirmed", "australianRelevanceReason": "Published by Scamwatch."}
    alert = ga._alert(_row("scamwatch", "ATO and myGov impersonation scams"), {}, analysis, datetime.now(timezone.utc))
    assert alert["appliesIn"] == "AU" and alert["australianRelevance"] == "confirmed" and alert["growling"] is True
