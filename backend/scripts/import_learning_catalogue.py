"""Explicit admin/import path for the Australian starter catalogue.

The articles themselves are now published at startup by services.learning.seed_catalogue_articles, so every
environment has the same library; this script remains for re-importing the sources/feeds/articles package."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from services import learning
from core.db import db, now_utc

ROOT = Path(__file__).resolve().parents[1]
expand_article = learning.expand_catalogue_article


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