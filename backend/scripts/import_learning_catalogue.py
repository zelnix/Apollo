"""Explicit admin/import path for the Australian starter catalogue. Never runs at app startup."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from services import learning
from core.db import db, now_utc

ROOT = Path(__file__).resolve().parents[1]


def expand_article(raw: dict) -> dict:
    citations = [{"sourceId": source_id, "label": label, "url": url} for source_id, label, url in raw.pop("citations")]
    sections = [
        {"heading": "Recognise what is happening", "paragraphs": [raw.pop("overview") + " Look for the combination of context, behaviour and requested action rather than trusting one familiar logo, name or number."], "bullets": raw.pop("signs")},
        {"heading": "Check and respond safely", "paragraphs": ["Use a separate trusted path and keep control of the pace. These steps are specific to this situation and do not require sharing passwords, verification codes or recovery phrases."], "bullets": raw.pop("actions")},
        {"heading": "If you already acted", "paragraphs": ["Contain the practical risk first, then report through official channels. Keep useful evidence without continuing the conversation or revisiting unsafe links."], "bullets": raw.pop("recovery")},
    ]
    recovery = raw["category"] == "After an incident"
    checklist = raw["slug"] in {"urgency-and-pressure", "verify-independently", "keeping-codes-private", "password-reuse", "contact-bank", "secure-accounts"}
    alert_context = raw["slug"] in {"data-breach-notices", "deepfake-voice-and-video"}
    explanatory = raw["slug"] in {"dangerous-links", "caller-id-spoofing", "public-wifi", "qr-code-scam", "device-warning", "unsafe-app-permissions"}
    content_type = "recovery" if recovery else "checklist" if checklist else "alert_context" if alert_context else "explainer" if explanatory else "guide"
    return {**raw, "audience": "general", "language": "en-AU", "contentType": content_type, "riskContext": raw["category"],
            "sections": sections, "citations": citations, "sourceType": "owner_curated", "evidenceQuality": "official_guidance", "status": "draft"}


async def main(publish: bool) -> None:
    package = json.loads((ROOT / "content" / "learning_catalogue_au.json").read_text())
    package["articles"] = [expand_article(dict(article)) for article in package["articles"]]
    await learning.ensure_indexes()
    feed_ids = [feed["feedId"] for feed in package["feeds"]]
    await db.learning_feeds.update_many({"feed_id": {"$nin": feed_ids}}, {"$set": {"enabled": False, "updated_at": now_utc(), "updated_by": "initial-catalogue-import"}})
    result = await learning.import_package(package, "initial-catalogue-import")
    if publish:
        for article in package["articles"]:
            for target in ("in_review", "approved", "published"):
                await learning.transition(article["slug"], target, "initial-catalogue-reviewer")
    print(json.dumps({**result, "published": publish}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--publish", action="store_true")
    asyncio.run(main(parser.parse_args().publish))