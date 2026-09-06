"""Backend settings. Every value comes from the environment (backend/.env in dev)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _req(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    mongo_url: str
    db_name: str
    signing_key_id: str
    signing_private_key_b64: str
    secondary_key_id: str | None
    secondary_private_key_b64: str | None
    admin_token: str
    controlled_host: str
    controlled_ipv4: str
    controlled_url: str
    ruleset_id: str
    bundle_ttl_days: int
    block_dedupe_window_ms: int
    webrisk_api_key: str | None
    webrisk_timeout_seconds: float
    provider_cache_ttl_seconds: int


@lru_cache
def get_settings() -> Settings:
    return Settings(
        mongo_url=_req("MONGO_URL"),
        db_name=_req("DB_NAME"),
        signing_key_id=_req("GD_M1_SIGNING_KEY_ID"),
        signing_private_key_b64=_req("GD_M1_SIGNING_PRIVATE_KEY_B64"),
        secondary_key_id=os.environ.get("GD_M1_SECONDARY_KEY_ID") or None,
        secondary_private_key_b64=os.environ.get("GD_M1_SECONDARY_PRIVATE_KEY_B64") or None,
        admin_token=_req("GD_ADMIN_TOKEN"),
        controlled_host=_req("GD_CONTROLLED_HOST"),
        controlled_ipv4=_req("GD_CONTROLLED_IPV4"),
        controlled_url=_req("GD_CONTROLLED_URL"),
        ruleset_id=_req("GD_RULESET_ID"),
        bundle_ttl_days=int(_req("GD_BUNDLE_TTL_DAYS")),
        block_dedupe_window_ms=int(_req("GD_BLOCK_DEDUPE_WINDOW_MS")),
        webrisk_api_key=os.environ.get("WEBRISK_API_KEY") or None,
        webrisk_timeout_seconds=float(_req("WEBRISK_TIMEOUT_SECONDS")),
        provider_cache_ttl_seconds=int(_req("GD_PROVIDER_CACHE_TTL_SECONDS")),
    )
