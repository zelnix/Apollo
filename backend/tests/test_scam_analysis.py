# Deterministic parts of the AI-grounded scam analysis: output coercion (can never fabricate a High
# alert from a malformed model reply), the free pre-filter, JSON parsing, and the growl rule.
import services.scam_analysis as sa
from services import government_alerts as ga


class TestCoerce:
    def test_malformed_falls_back_to_safe_education(self):
        out = sa._coerce({"tier": "nonsense", "severity": "EXTREME"})
        assert out["tier"] == "general_education" and out["severity"] == "LOW"  # unknown tier can't stay EXTREME
        assert out["confidence"] == "low" and out["analysisVersion"] == sa.ANALYSIS_VERSION

    def test_education_tier_forces_low_severity(self):
        out = sa._coerce({"tier": "general_education", "severity": "HIGH"})
        assert out["severity"] == "LOW"

    def test_specific_scam_keeps_valid_severity_and_fields(self):
        out = sa._coerce({"tier": "specific_scam", "severity": "HIGH", "severityReason": "names ATO + money loss",
                          "australianRelevance": "confirmed", "facts": {"who": "ATO"}, "sections": {"whatHappened": "x"}})
        assert out["tier"] == "specific_scam" and out["severity"] == "HIGH"
        assert out["facts"]["who"] == "ATO" and out["sections"]["whatHappened"] == "x"
        assert out["australianRelevance"] == "confirmed"

    def test_unknown_relevance_defaults(self):
        assert sa._coerce({"tier": "specific_scam", "severity": "HIGH", "australianRelevance": "mars"})["australianRelevance"] == "unknown"


class TestPreFilter:
    def test_fragment_urls_and_nav_titles_are_not_alerts(self):
        assert sa._obviously_not_an_alert({"url": "https://x/a#megamenu-skip", "title": "Foo"})
        assert sa._obviously_not_an_alert({"url": "https://x/a", "title": "Skip to content"})
        assert sa._obviously_not_an_alert({"url": "https://x/a", "title": "Next page »"})
        assert sa._obviously_not_an_alert({"url": "https://x/a", "title": "Current page 1"})

    def test_real_alert_titles_pass(self):
        assert not sa._obviously_not_an_alert({"url": "https://x/news-and-alerts/ato-impersonation", "title": "Scam alert: ATO and myGov impersonation"})


class TestParseJson:
    def test_plain_and_fenced_and_embedded(self):
        assert sa._parse_json('{"a": 1}')["a"] == 1
        assert sa._parse_json('```json\n{"a": 2}\n```')["a"] == 2
        assert sa._parse_json('Here it is: {"a": 3} done')["a"] == 3
        assert sa._parse_json("not json") is None


def _analysis(tier, severity, relevance):
    return {"tier": tier, "severity": severity, "australianRelevance": relevance, "australianRelevanceReason": "",
            "severityReason": "r", "confidence": "high", "facts": {}, "sections": {}, "analysisVersion": sa.ANALYSIS_VERSION}


class TestGrowlRule:
    def _row(self):
        from core.db import now_utc
        return {"source_id": "scamwatch", "title": "Scam alert: X", "url": "https://x/news-and-alerts/x", "summary": "s",
                "content_type": "official_advice", "trust_status": "recognised_government", "last_checked_at": now_utc()}

    def test_confirmed_au_high_growls_even_without_date(self):
        from core.db import now_utc
        built = ga._alert(self._row(), {"name": "Scamwatch"}, _analysis("specific_scam", "HIGH", "confirmed"), now_utc())
        assert built["growling"] is True and built["severity"] == "HIGH"

    def test_education_never_growls(self):
        from core.db import now_utc
        built = ga._alert(self._row(), {"name": "Scamwatch"}, _analysis("general_education", "LOW", "confirmed"), now_utc())
        assert built["growling"] is False and built["tier"] == "general_education"

    def test_overseas_potential_without_date_does_not_growl(self):
        from core.db import now_utc
        row = self._row(); row["published_at"] = None
        built = ga._alert(row, {"name": "FTC"}, _analysis("specific_scam", "HIGH", "potential"), now_utc())
        assert built["growling"] is False  # stale/undated overseas technique must not hold a growl
