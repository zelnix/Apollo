"""The Apollo SG banner: the top of every email and printed report."""
from __future__ import annotations

from pathlib import Path

from core.config import PUBLIC_BASE

BANNER_PATH = Path(__file__).resolve().parent.parent / "logo" / "apollo_sg_banner.jpg"
BANNER_WIDTH, BANNER_HEIGHT = 1200, 408
BANNER_ALT = "Apollo SG Scam Guard. Better Protection. Safer You. Safer Tomorrows."
# An email app can't read the server's files, so emails load the banner from Apollo's own public address.
BANNER_URL = f"{PUBLIC_BASE}/api/brand/banner.jpg" if PUBLIC_BASE.startswith("https://") else None
