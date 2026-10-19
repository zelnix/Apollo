"""Trace the scam alerts data path end-to-end."""
import asyncio
from datetime import timedelta, timezone
from core.db import db, now_utc
from services import scam_analysis

async def trace():
    now = now_utc()

    # 1. Enabled feeds
    feeds = await db.learning_feeds.find({"enabled": True}, {"_id": 0}).to_list(100)
    print(f"=== ENABLED FEEDS: {len(feeds)} ===")
    for f in feeds:
        print(f"  {f['feed_id']} | source: {f['source_id']} | type: {f['content_type']}")

    # 2. Feed states
    states = await db.learning_feed_state.find({}, {"_id": 0}).to_list(100)
    print(f"\n=== FEED STATES: {len(states)} ===")
    for s in states:
        print(f"  {s['feed_id']} | status: {s.get('status')} | last_success: {s.get('last_success_at')} | error: {s.get('error', '-')}")

    # 3. Total feed items
    total_items = await db.learning_feed_items.count_documents({})
    print(f"\n=== TOTAL FEED ITEMS: {total_items} ===")

    # 4. Items with scam_analysis
    with_analysis = await db.learning_feed_items.count_documents({"scam_analysis": {"$exists": True}})
    print(f"Items WITH scam_analysis: {with_analysis}")

    # 5. Current analysis version
    current_version = scam_analysis.ANALYSIS_VERSION
    print(f"Current ANALYSIS_VERSION: {current_version}")
    with_current = await db.learning_feed_items.count_documents({"scam_analysis.analysisVersion": current_version})
    print(f"Items with CURRENT analysis version: {with_current}")

    # 6. Breakdown by tier
    rows = await db.learning_feed_items.find(
        {"scam_analysis.analysisVersion": current_version},
        {"_id": 0, "title": 1, "source_id": 1, "published_at": 1, "scam_analysis": 1}
    ).to_list(200)
    tiers = {}
    recency_cutoff = now - timedelta(days=180)
    stale_count = 0
    for r in rows:
        a = r.get("scam_analysis", {})
        tier = a.get("tier", "unknown")
        tiers[tier] = tiers.get(tier, 0) + 1
        pub = r.get("published_at")
        if pub:
            pub_aware = pub.replace(tzinfo=timezone.utc) if pub.tzinfo is None else pub
            if pub_aware < recency_cutoff:
                stale_count += 1
    print(f"\n=== TIER BREAKDOWN (current version) ===")
    for t, c in sorted(tiers.items()):
        print(f"  {t}: {c}")
    print(f"Stale (>180 days old): {stale_count}")

    # 7. specific_scam items (these become alerts[])
    print(f"\n=== SPECIFIC_SCAM ITEMS (alerts[]) ===")
    specific_count = 0
    specific_stale = 0
    for r in rows:
        a = r.get("scam_analysis", {})
        if a.get("tier") == "specific_scam":
            specific_count += 1
            pub = r.get("published_at")
            is_stale = False
            if pub:
                pub_aware = pub.replace(tzinfo=timezone.utc) if pub.tzinfo is None else pub
                is_stale = pub_aware < recency_cutoff
                if is_stale:
                    specific_stale += 1
            title = r.get("title", "?")[:70]
            print(f"  \"{title}\" | {r['source_id']} | pub: {pub} | sev: {a.get('severity')} | AU: {a.get('australianRelevance')} | stale: {is_stale}")
    print(f"Total specific_scam: {specific_count}, of which stale: {specific_stale}, non-stale: {specific_count - specific_stale}")

    # 8. emerging_pattern items
    print(f"\n=== EMERGING_PATTERN ITEMS (emerging[]) ===")
    emerging_count = 0
    for r in rows:
        a = r.get("scam_analysis", {})
        if a.get("tier") == "emerging_pattern":
            emerging_count += 1
            title = r.get("title", "?")[:70]
            print(f"  \"{title}\" | {r['source_id']} | sev: {a.get('severity')}")
    print(f"Total emerging_pattern: {emerging_count}")

    # 9. general_education items (excluded from alerts feed)
    gen_ed = sum(1 for r in rows if r.get("scam_analysis", {}).get("tier") == "general_education")
    print(f"\n=== GENERAL_EDUCATION (excluded from alerts): {gen_ed} ===")

    # 10. Pending
    no_analysis = await db.learning_feed_items.count_documents({"scam_analysis": {"$exists": False}})
    wrong_version = with_analysis - with_current
    print(f"\n=== PENDING ===")
    print(f"No analysis at all: {no_analysis}")
    print(f"Wrong analysis version: {wrong_version}")
    print(f"Total pending (not shown): {no_analysis + wrong_version}")

    print(f"\n=== SUMMARY ===")
    print(f"Total items: {total_items}")
    print(f"Analysed (current): {with_current}")
    print(f"  -> specific_scam: {specific_count} (non-stale: {specific_count - specific_stale})")
    print(f"  -> emerging_pattern: {emerging_count}")
    print(f"  -> general_education: {gen_ed}")
    print(f"  -> stale dropped: {stale_count}")
    print(f"Pending: {no_analysis + wrong_version}")
    print(f"\nFinal alerts[] would contain: {specific_count - specific_stale} items")

asyncio.run(trace())
