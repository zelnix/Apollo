"""Shared pytest fixtures. Uses the local Mongo with an isolated test database."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ["DB_NAME"] = f"guarddog_m1_test_{os.environ.get('PYTEST_XDIST_WORKER', 'gw0')}"

from app.main import create_app  # noqa: E402
from app.core.settings import get_settings  # noqa: E402

VECTORS = Path(__file__).resolve().parents[2] / "security" / "test-vectors"
FROZEN_NOW = datetime(2026, 6, 15, tzinfo=timezone.utc)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    settings = get_settings()
    mongo = AsyncIOMotorClient(settings.mongo_url)
    await mongo.drop_database(settings.db_name)
    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            c.app = app  # type: ignore[attr-defined]
            yield c
    await mongo.drop_database(settings.db_name)
    mongo.close()


@pytest.fixture
def admin_headers():
    return {"X-GuardDog-Admin-Token": get_settings().admin_token}
