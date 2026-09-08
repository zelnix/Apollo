"""Gate 3 Phase B — POST /api/page/extract (Gemini vision page-signal extraction).

Uses PIL to synthesise page screenshots (never real images) and asserts the JSON shape
plus scenario-relevant signals. Backend calls Gemini live (5-20s per request)."""
from __future__ import annotations

import base64
import io
import os

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
# python-requests default UA is fine (the ingress only 403s python-urllib), but be explicit.
HEADERS = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 apollo-test"}
GEMINI_TIMEOUT = 90

REQUIRED_KEYS = {
    "visible_url", "claimed_brand", "page_type", "asks_for",
    "virus_or_infection_claim", "phone_number_to_call", "remote_access_tool",
    "captcha_instructions", "wallet_connect_request", "urgency_or_threat_text",
    "prices_look_unrealistic", "payment_methods", "business_identity",
    "os_or_security_branding", "text_excerpt",
}


def _font(size: int) -> ImageFont.ImageFont:
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def make_fake_virus_png() -> str:
    img = Image.new("RGB", (600, 420), (192, 25, 30))
    d = ImageDraw.Draw(img)
    # address bar (grey)
    d.rectangle([(0, 0), (600, 36)], fill=(230, 230, 230))
    d.text((10, 8), "apple-security-alert.top/warning", fill=(30, 30, 30), font=_font(16))
    d.text((30, 60), "APPLE SECURITY WARNING", fill=(255, 255, 255), font=_font(30))
    d.text((30, 120), "Your iPhone has 17 viruses!", fill=(255, 255, 255), font=_font(24))
    d.text((30, 170), "Immediate action required.", fill=(255, 240, 240), font=_font(20))
    d.text((30, 230), "Call Apple Support now: 1800 123 456", fill=(255, 255, 255), font=_font(22))
    d.rectangle([(30, 300), (330, 350)], fill=(255, 255, 255))
    d.text((50, 312), "Download Protection App", fill=(180, 0, 0), font=_font(20))
    return _b64(img)


def make_weather_png() -> str:
    img = Image.new("RGB", (600, 420), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((30, 180), "Weather today: sunny, 24 C", fill=(20, 20, 20), font=_font(26))
    return _b64(img)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


# --- /api/page/extract ------------------------------------------------------

class TestPageExtract:
    def test_fake_virus_warning(self, api):
        body = {"device_id": "gate3page0001", "image_base64": make_fake_virus_png()}
        r = api.post(f"{BASE_URL}/api/page/extract", json=body, timeout=GEMINI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert REQUIRED_KEYS.issubset(data.keys()), f"missing keys: {REQUIRED_KEYS - data.keys()}"
        # Scenario-relevant assertions
        assert data["virus_or_infection_claim"] is True, data
        assert "1800 123 456" in (data["phone_number_to_call"] or ""), data
        assert data["page_type"] in ("security_warning", "tech_support"), data
        assert "apple-security-alert.top" in (data["visible_url"] or "").lower(), data
        # Types
        assert isinstance(data["asks_for"], list)
        assert isinstance(data["payment_methods"], list)
        assert isinstance(data["wallet_connect_request"], bool)
        assert isinstance(data["prices_look_unrealistic"], bool)

    def test_plain_weather_article(self, api):
        body = {"device_id": "gate3page0002", "image_base64": make_weather_png()}
        r = api.post(f"{BASE_URL}/api/page/extract", json=body, timeout=GEMINI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["virus_or_infection_claim"] is False, data
        assert data["page_type"] in ("article", "other"), data
        assert data["phone_number_to_call"] == "" or data["phone_number_to_call"] is None

    def test_short_image_base64_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/page/extract", json={"device_id": "gate3page0003", "image_base64": "abc"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_missing_device_id_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/page/extract", json={"image_base64": "A" * 200}, timeout=15)
        assert r.status_code == 422, r.text
