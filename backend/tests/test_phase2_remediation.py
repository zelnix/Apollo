from pathlib import Path
from urllib.parse import urlparse

from services import government_alerts, learning
from services.higgins import context_tools


ROOT = Path(__file__).resolve().parents[2]


def test_learning_library_has_35_backend_owned_articles():
    assert len(learning.SEEDS) == 35
    assert len({seed[0] for seed in learning.SEEDS}) == 35
    assert set(seed[2] for seed in learning.SEEDS) == set(learning.GROUP_ACTIONS)
    for seed in learning.SEEDS:
        article = learning._article(seed)
        assert article["published"] is True
        assert len(article["body"]) > 300
        assert article["source_names"] == ["Scamwatch", "Australian Cyber Security Centre"]
        assert article["review_after"] > article["updated_at"]


def test_consumer_learning_bundle_contains_no_article_bodies():
    source = (ROOT / "frontend" / "app" / "higgins" / "learning.tsx").read_text()
    assert "Urgency and pressure" not in source
    assert "Scammers rely on a believable story" not in source
    assert "learningArticles(" in source


def test_registered_chat_context_tools_are_read_only_and_bounded():
    assert set(context_tools.READERS) == {
        "get_protection_summary", "get_recent_cases", "get_last_relevant_outcome", "get_saved_reports",
        "get_recent_patrol_outcomes", "get_user_learning_preferences", "get_new_scams_digest",
    }
    chat_source = (ROOT / "backend" / "services" / "higgins" / "chat.py").read_text()
    for forbidden in ("coordinator", "investigation_evidence", "web_search", "url_fetch", "file_scrape"):
        assert forbidden not in chat_source


def test_new_scams_sources_and_fallback_are_recognised_government_only():
    allowed = {"www.cyber.gov.au", "cyber.gov.au", "www.scamwatch.gov.au", "scamwatch.gov.au"}
    assert {cfg["source"] for cfg in government_alerts.FEEDS.values()} == {"Australian Cyber Security Centre", "Scamwatch"}
    for cfg in government_alerts.FEEDS.values():
        assert urlparse(cfg["url"]).hostname in allowed
        assert set(cfg["article_hosts"]).issubset(allowed)
    for item in government_alerts.FALLBACK:
        assert urlparse(item["url"]).hostname in allowed
        assert item["source_type"] == "official_advice"


def test_history_is_persisted_by_the_projector_before_case_cleanup():
    projector = (ROOT / "backend" / "services" / "investigation_projector.py").read_text()
    assert "higgins_investigation_history.update_one" in projector
    assert '"conclusion": overview[:600]' in projector
    assert '"deleted": False' in projector