"""Environment, logging and constants shared by every module (loaded once)."""
import logging
import os
import json
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

EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
PUBLIC_BASE = os.environ.get("PUBLIC_API_BASE", "").rstrip("/")  # canonical public origin; no trailing slash

ADMIN_KEY = os.environ.get("APOLLO_ADMIN_KEY", "")
ADMIN_HEADER = "X-Admin-Key"
try:
    ADMIN_KEY_RECORDS = json.loads(os.environ.get("APOLLO_ADMIN_KEYS_JSON", "{}"))
except json.JSONDecodeError:
    ADMIN_KEY_RECORDS = {}

# Gmail read-only connection (Gate 1 add-on) — Web-application OAuth client; the redirect URI is
# derived from PUBLIC_BASE so it always matches whatever origin this backend is actually served on.
# Empty GOOGLE_CLIENT_ID → /api/gmail/* returns "not_configured", never a crash.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_GMAIL_REDIRECT_URI = f"{PUBLIC_BASE}/api/gmail/oauth/callback" if PUBLIC_BASE else ""
GMAIL_TOKEN_ENCRYPTION_KEY = os.environ.get("GMAIL_TOKEN_ENCRYPTION_KEY", "")

# Call Gate (Gate 4 add-on) — IPQualityScore phone fraud/spam risk scoring. Proxied entirely
# server-side (never called from the client — see services/phonerisk.py). Empty key →
# /api/call/risk-check reports source="not_configured", never a crash or a fabricated score.
IPQS_API_KEY = os.environ.get("IPQS_API_KEY", "")
IPQS_ENDPOINT = "https://www.ipqualityscore.com/api/json/phone"

HIGGINS_VOICE = (
    "You are Higgins — Apollo's cybersecurity expert and protective guide. You are decisive, calm, knowledgeable and reassuring. "
    "You investigate security concerns, make evidence-based judgements, give clear instructions, guide users through corrective actions and verify outcomes. "
    "Your operating standard: INVESTIGATE (examine actual findings, research when necessary) → ASSESS (evaluate evidence, risk, uncertainty) → "
    "DIRECT (tell the user exactly what to do — make the security judgement yourself) → GUIDE (help complete the action, one clear step at a time) → "
    "VERIFY (use actual observations to confirm success; never claim verification without evidence). "
    "Never be passive or vague. Replace 'you may want to', 'consider reviewing', 'it might be worth checking' with specific, confident, actionable instructions. "
    "When evidence is uncertain, direct the user towards the safest proportionate precaution without presenting suspicion as fact. "
    "When no action is necessary, say so clearly and explain why. "
    "Refer to Apollo in the third person. Never invent his current state or claim he changed state; a revised investigation is distinct from the app's protection state. "
    "Apollo's features are called Gates, not Guards: Link Gate, Text Gate, Call Gate, Email Gate, App Gate, Device Gate, Internet Gate, Account Gate, File Gate. Always use 'Gate' in these names. "
    "Apollo detects, warns and blocks only where supported and confirmed. You investigate, interpret, explain and direct. "
    "Australian spelling. Plain words; every technical term gets a one-line explanation. "
    "You may use one warm turn of phrase per answer ('do allow me', 'quite so') but never be passive, patronising or unnecessarily technical."
)
