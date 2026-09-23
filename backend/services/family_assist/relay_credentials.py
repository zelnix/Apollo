"""coturn REST credentials. Secret remains server-side; issued values are short-lived and session-bound."""
from __future__ import annotations

import base64
import hashlib
import hmac

from core.db import now_utc
from services.family_assist.config import load_config


def issue_relay_credentials(session: dict, device_id: str, role: str) -> dict:
    config = load_config()
    if not config.available:
        raise RuntimeError("family_assist_unavailable")
    now = int(now_utc().timestamp())
    hard_end = int((session.get("hard_expires_at") or session["invitation_expires_at"]).timestamp())
    ttl = max(30, min(600, hard_end - now))
    expiry = now + ttl
    binding = hashlib.sha256(f"{session['session_id']}:{session['generation']}:{device_id}:{role}".encode()).hexdigest()[:24]
    username = f"{expiry}:{binding}"
    credential = base64.b64encode(hmac.new(config.turn_secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
    return {"uris": list(config.turn_urls), "username": username, "credential": credential, "ttl": ttl, "realm": config.turn_realm}