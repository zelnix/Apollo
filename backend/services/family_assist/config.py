"""Server-only FF10 configuration. Missing or malformed TURN values fail closed."""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv

load_dotenv()

UNAVAILABLE_COPY = "Family Help is not available yet. Your other Apollo features still work."
PROTOCOL_VERSION = 1


def parse_turn_url(raw: str):
    """TURN URIs are non-hierarchical; normalize only for strict component parsing."""
    if ":" not in raw:
        return urlparse(raw)
    scheme, rest = raw.split(":", 1)
    return urlparse(f"{scheme}://{rest}")


@dataclass(frozen=True)
class FamilyAssistConfig:
    enabled: bool
    turn_urls: tuple[str, ...]
    turn_realm: str
    turn_secret: str
    invitation_seconds: int = 300
    consent_reservation_seconds: int = 120
    active_seconds: int = 1800
    extension_seconds: int = 1800
    hard_max_seconds: int = 7200
    signaling_ticket_seconds: int = 60

    @property
    def turn_valid(self) -> bool:
        if len(self.turn_secret) < 32 or not (3 <= len(self.turn_realm) <= 253):
            return False
        transports: set[str] = set()
        for raw in self.turn_urls:
            parsed = parse_turn_url(raw)
            if parsed.scheme not in {"turn", "turns"} or not parsed.hostname or parsed.username or parsed.password:
                return False
            query = parse_qs(parsed.query)
            transport = (query.get("transport") or ["tls" if parsed.scheme == "turns" else "udp"])[0]
            if transport not in {"udp", "tcp", "tls"}:
                return False
            transports.add("tls" if parsed.scheme == "turns" else transport)
        return bool(self.turn_urls) and "udp" in transports and "tls" in transports

    @property
    def available(self) -> bool:
        return self.enabled and self.turn_valid


def _bounded(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def load_config() -> FamilyAssistConfig:
    urls = tuple(value.strip() for value in os.environ.get("FAMILY_ASSIST_TURN_URLS", "").split(",") if value.strip())
    return FamilyAssistConfig(
        enabled=os.environ.get("FAMILY_ASSIST_ENABLED", "").lower() in {"1", "true", "yes"},
        turn_urls=urls,
        turn_realm=os.environ.get("FAMILY_ASSIST_TURN_REALM", "").strip(),
        turn_secret=os.environ.get("FAMILY_ASSIST_TURN_SHARED_SECRET", ""),
        invitation_seconds=_bounded("FAMILY_ASSIST_INVITATION_SECONDS", 300, 60, 600),
        consent_reservation_seconds=_bounded("FAMILY_ASSIST_CONSENT_SECONDS", 120, 60, 300),
        active_seconds=_bounded("FAMILY_ASSIST_ACTIVE_SECONDS", 1800, 300, 1800),
        extension_seconds=_bounded("FAMILY_ASSIST_EXTENSION_SECONDS", 1800, 300, 1800),
        hard_max_seconds=_bounded("FAMILY_ASSIST_HARD_MAX_SECONDS", 7200, 1800, 7200),
        signaling_ticket_seconds=_bounded("FAMILY_ASSIST_TICKET_SECONDS", 60, 30, 60),
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