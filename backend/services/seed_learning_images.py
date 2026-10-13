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
    # ── Original 6 ──
    "recognising-phone-scams": "https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=400&q=80",
    "protecting-yourself-from-phishing": "https://images.unsplash.com/photo-1683117927786-f146451082fb?w=400&q=80",
    "investment-scam-red-flags": "https://images.unsplash.com/photo-1653378972336-103e1ea62721?w=400&q=80",
    "online-shopping-safety": "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=400&q=80",
    "protecting-older-australians-from-scams": "https://images.unsplash.com/photo-1584515933487-779824d29309?w=400&q=80",
    "securing-your-devices-and-accounts": "https://images.unsplash.com/photo-1584433144859-1fc3ab64a957?w=400&q=80",
    # ── Identity & accounts ──
    "sim-swap": "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&q=80",
    "identity-document": "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=400&q=80",
    "data-breach-notices": "https://images.unsplash.com/photo-1510511459019-5dda7724fd87?w=400&q=80",
    "social-media-account-takeover": "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&q=80",
    "account-alert": "https://images.unsplash.com/photo-1633265486064-086b219458ec?w=400&q=80",
    "recovery-contact": "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&q=80",
    "password-reuse": "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=400&q=80",
    "secure-accounts": "https://images.unsplash.com/photo-1618044619888-009e412ff12a?w=400&q=80",
    # ── After a scam ──
    "contact-bank": "https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=400&q=80",
    "preserve-evidence": "https://images.unsplash.com/photo-1586282391129-76a6df230234?w=400&q=80",
    "recover-confidence": "https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=400&q=80",
    "report-scam": "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=400&q=80",
    # ── Call scams ──
    "bank-impersonation": "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=400&q=80",
    "caller-id-spoofing": "https://images.unsplash.com/photo-1523966211575-eb4a01e7dd51?w=400&q=80",
    "deepfake-voice-and-video": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=400&q=80",
    "family-emergency-call": "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80",
    "government-impersonation": "https://images.unsplash.com/photo-1555848962-6e79363ec58f?w=400&q=80",
    "online-blackmail-and-sextortion": "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=400&q=80",
    "remote-access-call": "https://images.unsplash.com/photo-1563206767-5b18f218e8de?w=400&q=80",
    # ── Device & app security ──
    "fake-security-app": "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=400&q=80",
    "qr-code-scam": "https://images.unsplash.com/photo-1595079676339-1534801ad6cf?w=400&q=80",
    "device-warning": "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=400&q=80",
    "unsafe-app-permissions": "https://images.unsplash.com/photo-1522125670776-3c7abb882bc2?w=400&q=80",
    "public-wifi": "https://images.unsplash.com/photo-1562577309-4932fdd64cd1?w=400&q=80",
    # ── People & verification ──
    "trusted-family-check": "https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400&q=80",
    "verify-independently": "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&q=80",
    "keeping-codes-private": "https://images.unsplash.com/photo-1633265486064-086b219458ec?w=400&q=80",
    # ── Tactics ──
    "job-and-recruitment-scams": "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80",
    "too-good-to-be-true": "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=400&q=80",
    "urgency-and-pressure": "https://images.unsplash.com/photo-1508962914676-134849a727f0?w=400&q=80",
    # ── Messages & links ──
    "fake-invoice": "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&q=80",
    "phishing-email": "https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=400&q=80",
    "scam-texts": "https://images.unsplash.com/photo-1577563908411-5077b6dc7624?w=400&q=80",
    "unexpected-attachments": "https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?w=400&q=80",
    "dangerous-links": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=400&q=80",
    # ── Money scams ──
    "charity-and-donation-scams": "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=400&q=80",
    "fake-online-store": "https://images.unsplash.com/photo-1556742111-a301076d9d18?w=400&q=80",
    "gift-card-crypto": "https://images.unsplash.com/photo-1559526324-593bc073d938?w=400&q=80",
    "investment-scam": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&q=80",
    "marketplace-scam": "https://images.unsplash.com/photo-1556742393-d75f468bfcb0?w=400&q=80",
    "rental-scams": "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&q=80",
    "romance-payment": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80",
    "subscription-traps": "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=400&q=80",
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
    """Download images, upload to Emergent storage, update MongoDB articles.
    Skips articles that already have a thumbnail_path set."""
    results: dict[str, str] = {}
    for slug, url in ARTICLE_IMAGES.items():
        try:
            # Skip if article already has an image
            existing = await db.learning_articles.find_one({"slug": slug, "thumbnail_path": {"$exists": True, "$ne": None}})
            if existing and existing.get("thumbnail_path"):
                results[slug] = f"SKIPPED (already has: {existing['thumbnail_path']})"
                continue
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
    from core.db import db
    result = await seed_images(db)
    return {"seeded": result}
