"""Guard Dog M1 backend: signed rule distribution, key metadata, provider-abstracted intelligence.

MongoDB usage is limited to: rule_bundles, rule_versions, key_metadata, provider_cache, service_config.
No Threat Scent records, browsing history or security-event history are accepted or stored.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

from app.api.routes import config, health, intelligence, keys, rules
from app.core.logging import configure_logging, get_logger
from app.core.settings import get_settings
from app.providers.google_webrisk import GoogleWebRiskProvider
from app.repositories.config_repository import ConfigRepository
from app.repositories.key_metadata_repository import KeyMetadataRepository
from app.repositories.provider_cache_repository import ProviderCacheRepository
from app.repositories.rules_repository import RulesRepository
from app.services.intelligence_service import IntelligenceService
from app.services.key_registry_service import KeyRegistryService
from app.services.provider_cache_service import ProviderCacheService
from app.services.rule_bundle_service import RuleBundleService

ALLOWED_COLLECTIONS = {"rule_bundles", "rule_versions", "key_metadata", "provider_cache", "service_config"}
FORBIDDEN_COLLECTIONS = {"threat_scent_records", "browsing_history", "user_security_events"}

log = get_logger("main")


def build_services(app: FastAPI, db) -> None:
    settings = get_settings()
    rules_repo, keys_repo = RulesRepository(db), KeyMetadataRepository(db)
    cache_repo, config_repo = ProviderCacheRepository(db), ConfigRepository(db)
    key_registry = KeyRegistryService(settings, keys_repo)
    rule_service = RuleBundleService(settings, rules_repo, key_registry)
    provider = GoogleWebRiskProvider(settings.webrisk_api_key, settings.webrisk_timeout_seconds, settings.provider_cache_ttl_seconds)
    cache = ProviderCacheService(cache_repo, settings.provider_cache_ttl_seconds)
    app.state.settings = settings
    app.state.repos = (rules_repo, keys_repo, cache_repo, config_repo)
    app.state.key_registry = key_registry
    app.state.rule_service = rule_service
    app.state.provider = provider
    app.state.intelligence = IntelligenceService(rule_service, cache, provider)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongo_url)
    db = client[settings.db_name]
    build_services(app, db)
    rules_repo, keys_repo, cache_repo, config_repo = app.state.repos
    for repo in (rules_repo, keys_repo, cache_repo):
        await repo.ensure_indexes()
    await app.state.key_registry.ensure_seeded()
    await app.state.rule_service.ensure_controlled_block_bundle()
    await config_repo.put(
        "m1",
        {"rulesetId": settings.ruleset_id, "controlledHost": settings.controlled_host, "blockDedupeWindowMs": settings.block_dedupe_window_ms},
    )
    present = set(await db.list_collection_names())
    if present & FORBIDDEN_COLLECTIONS:
        log.error("forbidden M1 collections present: %s", sorted(present & FORBIDDEN_COLLECTIONS))
    log.info("Guard Dog M1 backend ready (ruleset=%s)", settings.ruleset_id)
    yield
    client.close()


def create_app() -> FastAPI:
    app = FastAPI(title="Guard Dog M1 Backend", lifespan=lifespan)
    for router in (health.router, config.router, rules.router, keys.router, intelligence.router):
        app.include_router(router, prefix="/api")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    return app


app = create_app()
