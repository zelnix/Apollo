"""Apollo Knowledge Base: Tavily discovers and maintains; trusted sources provide authority.

Pins the owner's Rules of Engagement: trusted sources only, provenance on every record, versioned history
(nothing deleted), no near-duplicates, automatic checks before anything goes live, Tavily never used for live
questions or Magnum DI, and KB knowledge always labelled as general knowledge.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from core.db import db
from services import apollo_kb, kb_sources, tavily_client
from services.higgins import knowledge

PAGE = """[Skip to content](#main) [Skip to navigation](#nav)
[![Logo](/logo.svg)](/ "Home")
An official website of the United States government. Here's how you know.
Federal government websites often end in .gov or .mil. Before sharing sensitive information, make sure you're on a federal government site.
* [Home](/)
* [News](/news)
# Fake parcel delivery texts

Scammers are sending text messages that pretend to come from a parcel delivery company and ask you to pay a small fee.

The link in the message goes to a fake website that steals your card details and personal information.

For help, see the [Anti-Phishing Working Group report [PDF]](https://docs.apwg.org/report.pdf) or call [1800 595 160](tel:1800 595 160 "1800 595 160").[[1]](#ftn1)

## Warning signs

- The message asks you to pay a redelivery fee through a link
- The sender's number or address doesn't match the real delivery company
- The message creates urgency so you act before you think

## What to do

- Don't click links in unexpected delivery messages
- Check the delivery status on the company's official app or website
- If you paid, contact your bank straight away and report it to Scamwatch

Scammers change their wording often, so treat any unexpected request for payment with suspicion and take a moment to check it.

## Was this page helpful?
Yes No
"""


def test_page_reading_keeps_the_sources_words_and_drops_the_website():
    page = apollo_kb.parse_page(PAGE)
    text = apollo_kb.page_text(page)
    assert page["title"] == "Fake parcel delivery texts"
    assert "Scammers are sending text messages" in text and "• Don't click links in unexpected delivery messages" in text
    assert "Skip to" not in text and "Was this page helpful" not in text and "Home" not in text.split()
    assert "official website" not in text and ".gov or .mil" not in text and "](" not in text and "[1]" not in text
    assert "Anti-Phishing Working Group report [PDF] or call 1800 595 160." in text
    assert page["words"] >= 100


def test_automatic_checks():
    page = apollo_kb.parse_page(PAGE)
    assert apollo_kb.automatic_checks("https://www.scamwatch.gov.au/types-of-scams/parcel-texts", page) is None
    assert apollo_kb.automatic_checks("https://random-blog.example/parcel-texts", page) == "untrusted_source"
    assert apollo_kb.automatic_checks("https://consumer.ftc.gov/consumer-alerts?page=1", page) == "listing_or_navigation_page"
    assert apollo_kb.automatic_checks("https://www.scamwatch.gov.au/news", page) == "listing_or_navigation_page"
    assert apollo_kb.automatic_checks("https://www.cyber.gov.au/guide.pdf", page) == "document_file"
    thin = apollo_kb.parse_page("# Title here\n\nOnly a short paragraph of words that is not enough.")
    assert apollo_kb.automatic_checks("https://www.cyber.gov.au/learn/thin", thin) == "too_little_content"


def test_trusted_source_hierarchy():
    assert kb_sources.source_for("https://www.scamwatch.gov.au/x").tier == kb_sources.TIER_1
    assert kb_sources.source_for("https://www.welivesecurity.com/x").tier == kb_sources.TIER_2
    assert kb_sources.source_for("https://www.idcare.org/x").tier == kb_sources.TIER_3
    assert kb_sources.source_for("https://consumer.ftc.gov/x").domain == "consumer.ftc.gov"  # most specific wins
    assert kb_sources.source_for("http://www.scamwatch.gov.au/x") is None
    assert kb_sources.source_for("https://scamwatch.gov.au.evil.example/x") is None


def test_url_key_and_change_detection():
    assert apollo_kb.normalise_url("https://WWW.Scamwatch.gov.au/a/?utm_source=x#top") == "https://scamwatch.gov.au/a"
    a = apollo_kb.sketch(apollo_kb.page_text(apollo_kb.parse_page(PAGE)))
    b = apollo_kb.sketch(apollo_kb.page_text(apollo_kb.parse_page(PAGE.replace("small fee", "small fee of $2.99"))))
    assert apollo_kb.similarity(a, a) == 1.0 and apollo_kb.similarity(a, b) > apollo_kb.NEAR_DUPLICATE
    other = apollo_kb.sketch("Romance scammers build trust over months before asking for money for an emergency overseas trip.")
    assert apollo_kb.similarity(a, other) < 0.2


def test_tavily_key_can_be_given_as_the_tavily_address(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-dev-abc123")
    assert tavily_client._api_key() == "tvly-dev-abc123"
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-dev-xyz")
    assert tavily_client._api_key() == "tvly-dev-xyz"


def test_tavily_is_only_used_by_the_knowledge_base():
    """Never by Magnum DI, live investigations or Higgins answering a question as it is asked."""
    root = Path(__file__).resolve().parents[1]
    users = sorted(str(p.relative_to(root)) for p in (root / "services").rglob("*.py")
                   if "tavily_client" in p.read_text() and p.name != "tavily_client.py")
    users += sorted(str(p.relative_to(root)) for p in (root / "routers").rglob("*.py") if "tavily_client" in p.read_text())
    assert users == ["services/apollo_kb.py"]


def _candidate(url: str, raw: str = PAGE, intent: str = "guidance") -> dict:
    return {"url": url, "title": "", "rawContent": raw, "publishedDate": None, "intent": intent}


@pytest.mark.anyio
async def test_ingest_versions_history_and_deduplicates():
    tag = uuid.uuid4().hex[:8]
    url = f"https://www.scamwatch.gov.au/types-of-scams/kb-test-{tag}"
    twin_url = f"https://www.cyber.gov.au/learn/kb-test-twin-{tag}"
    run = {"run_id": f"test-{tag}", "alerts_published": 0, "learn_published": 0, "learn_updated": 0}
    page = PAGE.replace("# Fake parcel delivery texts", f"# Fake parcel delivery texts {tag}")
    key = apollo_kb.normalise_url(url)
    try:
        assert await apollo_kb.ingest(_candidate(url, page), run) == "added"
        record = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0})
        provenance = record["provenance"]
        assert record["status"] == "current" and record["version"] == 1 and record["knowledge_class"] == "general_knowledge"
        assert provenance["source_url"] == url and provenance["publisher"] == "Scamwatch (ACCC)" and provenance["retrieved_via"] == "tavily"
        assert provenance["authority_tier"] == kb_sources.TIER_1 and provenance["jurisdiction"] == "AU" and provenance["licence"]
        assert run["learn_published"] == 1 and record.get("learn_slug")  # republishable Tier 1 guidance → Learn
        article = await db.learning_articles.find_one({"slug": record["learn_slug"]}, {"_id": 0})
        assert article["status"] == "published" and article["citations"][0]["url"] == url

        assert await apollo_kb.ingest(_candidate(url, page), run) == "unchanged"

        changed = page.replace("## What to do", "## What to do now\n\nA brand new paragraph the source added about reporting the scam to your telco provider.")
        changed = changed.replace("The link in the message goes to a fake website that steals your card details and personal information.",
                                  "Criminals now also use QR codes in these messages, sending people to fake payment pages that copy their details.")
        assert await apollo_kb.ingest(_candidate(url, changed), run) == "updated"
        record = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0})
        assert record["status"] == "updated" and record["version"] == 2 and run["learn_updated"] == 1
        old = await db.apollo_kb_history.find_one({"kb_id": record["kb_id"], "version": 1}, {"_id": 0})
        assert old["status"] == "superseded" and "steals your card details" in old["body"]  # history kept, never deleted

        assert await apollo_kb.ingest(_candidate(twin_url, changed), run) == "duplicate"
        record = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0})
        assert any(item["url"] == twin_url for item in record["also_published_at"])
        assert not await db.higgins_knowledge.find_one({"kind": "researched", "key": apollo_kb.normalise_url(twin_url)})

        assert await apollo_kb._failed_check(url) is False
        assert await apollo_kb._failed_check(url) is True
        record = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0})
        assert record["status"] == "historical"

        assert (await apollo_kb.ingest(_candidate(f"https://www.scamwatch.gov.au/news?page=2&t={tag}"), run)).startswith("rejected:")
    finally:
        record = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0}) or {}
        await db.higgins_knowledge.delete_many({"kind": "researched", "key": {"$in": [key, apollo_kb.normalise_url(twin_url)]}})
        await db.apollo_kb_history.delete_many({"kb_id": record.get("kb_id", "")})
        await db.apollo_kb_rejections.delete_many({"run_id": run["run_id"]})
        if record.get("learn_slug"):
            await db.learning_articles.delete_many({"slug": record["learn_slug"]})
            await db.learning_article_versions.delete_many({"slug": record["learn_slug"]})


def test_presentation_carries_provenance_and_the_general_knowledge_label():
    entry = {"kind": "researched", "title": "Fake parcel delivery texts", "publisher": "US Federal Trade Commission",
             "url": "https://consumer.ftc.gov/x", "authority_tier": kb_sources.TIER_1, "jurisdiction": "US", "status": "historical",
             "body": apollo_kb.page_text(apollo_kb.parse_page(PAGE)), "provenance": {"published_at": None, "last_checked_at": None}}
    answer, sources = knowledge.present([entry], "parcel delivery text scam")
    assert "Official authority · United States" in answer and "Historical" in answer
    assert "United States guidance" in answer and "Read the original: https://consumer.ftc.gov/x" in answer
    assert answer.endswith(knowledge.GENERAL_KNOWLEDGE_NOTE) and sources[0]["url"] == "https://consumer.ftc.gov/x"
