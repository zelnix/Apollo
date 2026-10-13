"""Seed learning article thumbnail images into Emergent Object Storage
and update the corresponding MongoDB records with the stored paths.

Run via: POST /api/admin/seed-learning-images
"""

import asyncio
import uuid
import httpx
from fastapi import APIRouter
from services import emergent_storage
from motor.motor_asyncio import AsyncIOMotorDatabase

router = APIRouter()

# Map article slug → Unsplash image URL (small size for thumbnails)
ARTICLE_IMAGES: dict[str, str] = {
    "recognising-phone-scams": "https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=400&q=80",
    "protecting-against-phishing": "https://images.unsplash.com/photo-1683117927786-f146451082fb?w=400&q=80",
    "investment-scam-red-flags": "https://images.unsplash.com/photo-1653378972336-103e1ea62721?w=400&q=80",
    "safe-online-shopping": "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=400&q=80",
    "protecting-older-people": "https://images.unsplash.com/photo-1584515933487-779824d29309?w=400&q=80",
    "securing-devices-accounts": "https://images.unsplash.com/photo-1584433144859-1fc3ab64a957?w=400&q=80",
}


async def _download(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        resp = await http.get(url)
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "image/jpeg")
        return resp.content, ct


def _upload_sync(data: bytes, content_type: str, slug: str) -> str:
    ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else "png"
    path = f"{emergent_storage.APP_NAME}/learning/{slug}-{uuid.uuid4().hex[:8]}.{ext}"
    emergent_storage.put_object(path, data, content_type)
    return path


async def seed_images(db: AsyncIOMotorDatabase) -> dict:
    """Download images, upload to Emergent storage, update MongoDB articles."""
    results: dict[str, str] = {}
    for slug, url in ARTICLE_IMAGES.items():
        try:
            data, ct = await _download(url)
            path = await asyncio.to_thread(_upload_sync, data, ct, slug)
            # Update the article record in MongoDB
            await db.learning_articles.update_one(
                {"slug": slug},
                {"$set": {"thumbnail_path": path}},
            )
            results[slug] = path
        except Exception as e:
            results[slug] = f"ERROR: {e}"
    return results


@router.post("/admin/seed-learning-images")
async def seed_learning_images_endpoint():
    from db import db
    result = await seed_images(db)
    return {"seeded": result}
