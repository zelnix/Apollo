"""Auditable severity / region / Australian-relevance / growling rules for global scam advisories."""
from datetime import datetime, timedelta, timezone

from services import scam_intel


def _item(title="", summary="", content_type="live_alert", published=None):
    return {"title": title, "summary": summary, "content_type": content_type, "published_at": published}


def test_region_from_source():
    assert scam_intel.region_for("scamwatch") == "AU"
    assert scam_intel.region_for("ftc") == "US"
    assert scam_intel.region_for("ncsc_uk") == "UK"
    assert scam_intel.region_for("europol") == "EU"
    assert scam_intel.region_for("unknown_src") == "GLOBAL"


def test_low_for_official_advice_and_tips():
    sev, _, _ = scam_intel.classify_severity(_item("Stay safe online", "Tips to protect yourself", content_type="official_advice"))
    assert sev == "LOW"
    sev2, _, _ = scam_intel.classify_severity(_item("How to recognise fake texts", "A guide to awareness"))
    assert sev2 == "LOW"


def test_high_and_extreme_need_real_signals():
    high = scam_intel.classify_severity(_item("Bank impersonation scam", "Criminals trick people into transferring money to a safe account."))[0]
    assert high == "HIGH"
    extreme = scam_intel.classify_severity(_item("Urgent: widespread ransomware scam", "A rapidly spreading fraud actively exploited to steal money and credentials."))[0]
    assert extreme == "EXTREME"
    moderate = scam_intel.classify_severity(_item("New phishing emails circulating", "A phishing campaign is impersonating a delivery company."))[0]
    assert moderate == "MODERATE"


def test_alarming_language_alone_is_not_extreme():
    # Urgency words but no concrete scam/harm evidence must not reach Extreme/High.
    sev = scam_intel.classify_severity(_item("Critical emergency update", "An urgent notice about system maintenance."))[0]
    assert sev == "LOW"


def test_australian_relevance_levels():
    assert scam_intel.australian_relevance("AU", "HIGH", _item("x", "y"))[0] == "confirmed"
    assert scam_intel.australian_relevance("US", "HIGH", _item("Scam hits Australian banks", "Reported in Australia"))[0] == "confirmed"
    assert scam_intel.australian_relevance("US", "HIGH", _item("Scam hits US banks", "Reported in the US"))[0] == "potential"
    assert scam_intel.australian_relevance("US", "LOW", _item("General advice", ""))[0] == "overseas_only"


def test_growling_rules():
    assert scam_intel.is_growling("HIGH", "confirmed") is True
    assert scam_intel.is_growling("EXTREME", "potential") is True
    assert scam_intel.is_growling("HIGH", "overseas_only") is False
    assert scam_intel.is_growling("MODERATE", "confirmed") is False
    assert scam_intel.is_growling("LOW", "confirmed") is False


def test_fresh_advisory_window():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    assert scam_intel.is_fresh_advisory({"publishedAt": now - timedelta(days=3)}, now=now) is True
    assert scam_intel.is_fresh_advisory({"publishedAt": now - timedelta(days=40)}, now=now) is False
    assert scam_intel.is_fresh_advisory({"publishedAt": None}, now=now) is False


def test_higgins_explanation_uses_source_facts_and_never_claims_personal_attack():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    item = _item("Bank transfer scam", "Criminals impersonate banks to move money.", published=now)
    out = scam_intel.higgins_explanation(item, severity="HIGH", region="UK", relevance="potential", source_name="NCSC", source_region="UK")
    assert out["source"] == "NCSC"
    assert "United Kingdom" in out["whereHappening"]
    assert "not been confirmed in Australia" in out["whatItMeansForAustralia"]
    assert "has not detected this scam on your device" in out["whatToDo"]
    assert out["publishedAt"] == now.isoformat()


def test_enrich_overseas_high_is_potential_and_growls():
    now = datetime.now(timezone.utc)
    item = _item("Ransomware fraud surges", "Urgent widespread scam stealing money and credentials via remote access.", published=now)
    out = scam_intel.enrich(item, "ftc", "Federal Trade Commission")
    assert out["region"] == "US" and out["severity"] == "EXTREME"
    assert out["australianRelevance"] == "potential" and out["growling"] is True
    assert out["higgins"]["whatHappened"]
