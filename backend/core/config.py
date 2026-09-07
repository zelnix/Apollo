"""Environment, logging and constants shared by every module (loaded once)."""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]  # /app/backend
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("apollo")
# Never log outbound URLs (they carry the API key and the checked link).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

SAFE_BROWSING_API_KEY = os.environ.get("SAFE_BROWSING_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# Gate 8 — optional breach intelligence (Have I Been Pwned). Empty → /api/account/breach reports "not_configured".
HIBP_API_KEY = os.environ.get("HIBP_API_KEY", "")
URL_HMAC_SECRET = os.environ["URL_HMAC_SECRET"]
SB_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
SB_THREAT_TYPES = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"]

TOKEN_TTL_DAYS = 365

EMAIL_BASE_URL = os.environ.get("EMERGENT_INTEGRATIONS_BASE_URL", "https://integrations.emergentagent.com")
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
PUBLIC_BASE = os.environ.get("PUBLIC_API_BASE", "")  # e.g. https://<host>; confirm links are first-party

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
HIGGINS_TTS = {"model": "tts-1", "voice": "fable", "speed": 0.95}

PUSH_BASE_URL = os.environ.get("EMERGENT_INTEGRATIONS_BASE_URL", "https://integrations.emergentagent.com")
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

ADMIN_KEY = os.environ.get("APOLLO_ADMIN_KEY", "")
ADMIN_HEADER = "X-Admin-Key"

HIGGINS_VOICE = ("You speak as Higgins — Apollo's handler: a sophisticated, older English gentleman, very proper and butler-like. Courteous, unhurried, "
                 "dry warmth, never theatrical. Refer to Apollo (the guard dog) in the third person — 'Apollo is growling at this one', 'Apollo has it in hand'. "
                 "Use light butler turns of phrase sparingly ('if I may', 'I would suggest', 'quite so', 'do allow me') — at most one per answer. Do not use 'sir' or 'madam'. "
                 "Australian spelling. Plain words; every technical term gets a one-line explanation.")
