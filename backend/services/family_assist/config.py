"""Server-only FF10 provider configuration. Missing Cloudflare values fail closed."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

UNAVAILABLE_COPY = "Family Help is not available yet. Your other Apollo features still work."
PROTOCOL_VERSION = 1
CLOUDFLARE_PROVIDER = "cloudflare"
CLOUDFLARE_KEY_RE = re.compile(r"^[0-9a-f]{32}$")


@dataclass(frozen=True)
class FamilyAssistConfig:
    enabled: bool
    turn_provider: str
    cloudflare_turn_key_id: str
    cloudflare_turn_api_token: str
    invitation_seconds: int = 300
    consent_reservation_seconds: int = 120
    active_seconds: int = 1800
    extension_seconds: int = 1800
    hard_max_seconds: int = 7200
    signaling_ticket_seconds: int = 60
    relay_ttl_seconds: int = 3600

    @property
    def turn_valid(self) -> bool:
        return (
            self.turn_provider == CLOUDFLARE_PROVIDER
            and bool(CLOUDFLARE_KEY_RE.fullmatch(self.cloudflare_turn_key_id))
            and len(self.cloudflare_turn_api_token) >= 20
        )

    @property
    def available(self) -> bool:
        return self.enabled and self.turn_valid

    @property
    def cloudflare_credentials_url(self) -> str:
        if not CLOUDFLARE_KEY_RE.fullmatch(self.cloudflare_turn_key_id):
            raise ValueError("invalid_cloudflare_turn_key_id")
        return f"https://rtc.live.cloudflare.com/v1/turn/keys/{self.cloudflare_turn_key_id}/credentials/generate-ice-servers"


def _bounded(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def load_config() -> FamilyAssistConfig:
    return FamilyAssistConfig(
        enabled=os.environ.get("FAMILY_ASSIST_ENABLED", "").lower() in {"1", "true", "yes"},
        turn_provider=os.environ.get("FAMILY_ASSIST_TURN_PROVIDER", "").strip().lower(),
        cloudflare_turn_key_id=os.environ.get("CLOUDFLARE_TURN_KEY_ID", "").strip().lower(),
        cloudflare_turn_api_token=os.environ.get("CLOUDFLARE_TURN_API_TOKEN", ""),
        invitation_seconds=_bounded("FAMILY_ASSIST_INVITATION_SECONDS", 300, 60, 600),
        consent_reservation_seconds=_bounded("FAMILY_ASSIST_CONSENT_SECONDS", 120, 60, 300),
        active_seconds=_bounded("FAMILY_ASSIST_ACTIVE_SECONDS", 1800, 300, 1800),
        extension_seconds=_bounded("FAMILY_ASSIST_EXTENSION_SECONDS", 1800, 300, 1800),
        hard_max_seconds=_bounded("FAMILY_ASSIST_HARD_MAX_SECONDS", 7200, 1800, 7200),
        signaling_ticket_seconds=_bounded("FAMILY_ASSIST_TICKET_SECONDS", 60, 30, 60),
        relay_ttl_seconds=_bounded("FAMILY_ASSIST_RELAY_TTL_SECONDS", 3600, 300, 3600),
    )


def capability_record() -> dict:
    config = load_config()
    reason = None if config.available else ("configuration_missing" if not config.turn_valid else "policy_rejected")
    return {
        "enabled": config.available,
        "protocolVersion": PROTOCOL_VERSION,
        "unavailableReason": reason,
        "detail": None if config.available else UNAVAILABLE_COPY,
        "supportedScopes": ["apollo_app", "selected_app", "full_display"] if config.available else [],
        "microphone": "not_supported", "systemAudio": "not_supported", "remoteControl": "not_supported", "recording": "not_supported",
    }