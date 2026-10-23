"""The preview simulator can never run in production — only APOLLO_PREVIEW_SIMULATOR=on admits it.

APOLLO_ENV is deliberately not the switch: the deployment's secrets still hold an old "preview" value of it.

Emergent deploys the whole project, `services/higgins/preview/` included, so the directory's presence
proves nothing (it was the guard before, and production ended up answering from the simulator).
The decision is now ONE explicit value: APOLLO_PREVIEW_SIMULATOR=on in the preview slot only. A missing,
empty or any other value is production — `register_preview_handler()` refuses, `get_provider_mode()` answers
"live" and `generate()` reaches live Gemini only.

Run: cd /app/backend && python -m pytest tests/test_provider_environment_guard.py -q
"""
from __future__ import annotations

import pathlib

import pytest

from services.higgins import provider
from services.higgins.provider import ProviderFailure

SOURCE = pathlib.Path(provider.__file__).read_text()
SERVER = (pathlib.Path(__file__).resolve().parents[1] / "server.py").read_text()


async def _handler(*_args, **_kwargs):
    raise AssertionError("the handler itself is not exercised here")


@pytest.mark.parametrize("value", [None, "", "off", "preview", "production", "true", "1", "yes", "onn"])
def test_anything_but_preview_refuses_the_simulator_and_stays_live(monkeypatch, value):
    monkeypatch.setattr(provider, "_preview_generate", None)
    if value is None:
        monkeypatch.delenv("APOLLO_PREVIEW_SIMULATOR", raising=False)
    else:
        monkeypatch.setenv("APOLLO_PREVIEW_SIMULATOR", value)
    assert provider.preview_environment() is False
    with pytest.raises(RuntimeError):
        provider.register_preview_handler(_handler)
    assert provider.get_provider_mode() == "live"


@pytest.mark.parametrize("value", ["on", " ON "])
def test_explicit_preview_installs_the_simulator_and_blocks_the_live_client(monkeypatch, value):
    monkeypatch.setattr(provider, "_preview_generate", None)
    monkeypatch.setenv("APOLLO_PREVIEW_SIMULATOR", value)
    provider.register_preview_handler(_handler)  # monkeypatch restores the real value afterwards
    assert provider.get_provider_mode() == "preview"
    # With the simulator answering, the live client must be unreachable — not merely unused.
    with pytest.raises(ProviderFailure):
        provider.client()


def test_a_stale_apollo_env_preview_cannot_switch_production_to_the_simulator(monkeypatch):
    """The deployment still carries APOLLO_ENV=preview from an earlier design; it must decide nothing."""
    monkeypatch.setattr(provider, "_preview_generate", None)
    monkeypatch.delenv("APOLLO_PREVIEW_SIMULATOR", raising=False)
    monkeypatch.setenv("APOLLO_ENV", "preview")
    monkeypatch.setenv("APOLLO_PROVIDER_MODE", "simulated")
    assert provider.preview_environment() is False
    with pytest.raises(RuntimeError):
        provider.register_preview_handler(_handler)
    assert provider.get_provider_mode() == "live"


def test_the_production_gateway_names_no_preview_module():
    for forbidden in ("preview_simulator", "mock_provider", "from services.higgins.preview"):
        assert forbidden not in SOURCE, f"provider.py must not reference {forbidden}"


def test_startup_installs_the_dispatch_only_behind_the_explicit_switch():
    install = "from services.higgins.preview.dispatch import install_preview_provider"
    assert install in SERVER
    guard = SERVER.index("if preview_environment():")
    assert guard < SERVER.index(install), "the import must sit behind the explicit switch"
    assert "except ImportError" not in SERVER, "a missing module must not be the production signal"
