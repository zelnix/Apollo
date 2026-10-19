"""Quick DB status check."""
import asyncio
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017/apollo")

async def check():
    client = AsyncIOMotorClient(MONGO_URL)
    db_name = MONGO_URL.rsplit("/", 1)[-1].split("?")[0] if "/" in MONGO_URL else "apollo"
    db = client[db_name]
    
    colls = await db.list_collection_names()
    print("=== COLLECTIONS ===")
    for c in sorted(colls):
        count = await db[c].count_documents({})
        print(f"  {c}: {count} docs")
    
    total = await db.gemini_usage.count_documents({})
    print(f"\n=== GEMINI USAGE: {total} total records ===")
    
    if total > 0:
        earliest = await db.gemini_usage.find_one({}, sort=[("timestamp", 1)])
        latest = await db.gemini_usage.find_one({}, sort=[("timestamp", -1)])
        print(f"Earliest: {earliest.get('timestamp')}")
        print(f"Latest: {latest.get('timestamp')}")
        
        pipeline = [{"$group": {"_id": "$purpose", "count": {"$sum": 1}, "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}]
        rows = await db.gemini_usage.aggregate(pipeline).to_list(50)
        print("\nBy purpose:")
        for r in rows:
            print(f"  {r['_id']}: {r['count']} calls, ${r['cost']:.4f}")
        
        # By trigger_source
        ts_pipeline = [{"$group": {"_id": "$extra.trigger_source", "count": {"$sum": 1}, "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}]
        ts_rows = await db.gemini_usage.aggregate(ts_pipeline).to_list(50)
        print("\nBy trigger_source:")
        for r in ts_rows:
            print(f"  {r['_id']}: {r['count']} calls, ${r['cost']:.4f}")
        
        # By correlation_id pattern
        corr_pipeline = [{"$group": {"_id": "$correlation_id", "count": {"$sum": 1}}}]
        corr_rows = await db.gemini_usage.aggregate(corr_pipeline).to_list(500)
        print(f"\nUnique correlation_ids: {len(corr_rows)}")
        for r in sorted(corr_rows, key=lambda x: x['count'], reverse=True)[:10]:
            print(f"  {r['_id']}: {r['count']} calls")
    else:
        print("Database is EMPTY - no gemini_usage records.")
    
    # Check investigation_cases
    for cname in ["investigation_cases", "cases", "investigation_reports"]:
        if cname in colls:
            count = await db[cname].count_documents({})
            print(f"\n{cname}: {count} docs")
            if count > 0:
                sample = await db[cname].find_one({})
                print(f"  Fields: {list(sample.keys())}")
    
    client.close()

asyncio.run(check())
