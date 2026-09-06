"""Distribution-only mode: the backend can serve signed bundles + public keys without any private signing material.

This is the mode a build pipeline or read replica would run in. It must never be able to sign.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.core import settings as settings_mod
from app.services.key_registry_service import KeyRegistryService


class _NoRepo:
    async def get(self, key_id):  # pragma: no cover - not reached
        return None

    async def upsert(self, meta):  # pragma: no cover - not reached
        raise AssertionError("must not seed keys without private material")

    async def list_all(self):
        return []


def test_settings_do_not_require_private_key_when_signing_disabled(monkeypatch):
    monkeypatch.setenv("GD_SIGNING_ENABLED", "false")
    monkeypatch.setenv("GD_M1_SIGNING_PRIVATE_KEY_B64", "")
    monkeypatch.delenv("GD_M1_SECONDARY_PRIVATE_KEY_B64", raising=False)
    settings_mod.get_settings.cache_clear()
    try:
        s = settings_mod.get_settings()
        assert s.signing_enabled is False
        assert s.signing_private_key_b64 is None
        assert s.secrets() == [s.admin_token]  # nothing else secret is loaded
    finally:
        settings_mod.get_settings.cache_clear()


def test_settings_require_private_key_when_signing_enabled(monkeypatch):
    monkeypatch.setenv("GD_SIGNING_ENABLED", "true")
    monkeypatch.setenv("GD_M1_SIGNING_PRIVATE_KEY_B64", "")
    settings_mod.get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError):
            settings_mod.get_settings()
    finally:
        settings_mod.get_settings.cache_clear()


@pytest.mark.anyio
async def test_key_registry_without_private_key_cannot_sign_or_seed():
    s = dataclasses.replace(settings_mod.get_settings(), signing_private_key_b64=None, secondary_private_key_b64=None, signing_enabled=False)
    registry = KeyRegistryService(s, _NoRepo())
    assert registry.can_sign is False
    await registry.ensure_seeded()  # no-op: nothing to seed, nothing written
    with pytest.raises(KeyError):
        registry.private_key(s.signing_key_id)
