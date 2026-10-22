"""The preview simulator can never run in production — the guard is structural, not a flag.

Production does not deploy `services/higgins/preview/`, so nothing can install a preview handler:
`get_provider_mode()` answers "live" and `generate()` reaches live Gemini only. A preview deployment
ships the directory, `server.py` installs the dispatch at startup, and from then on `client()` refuses
to be reached at all. No environment variable takes part in this decision.

Run: cd /app/backend && python -m pytest tests/test_provider_environment_guard.py -q
"""
from __future__ import annotations

import pathlib

import pytest

from services.higgins import provider
from services.higgins.provider import ProviderFailure

SOURCE = pathlib.Path(provider.__file__).read_text()
SERVER = (pathlib.Path(__file__).resolve().parents[1] / "server.py").read_text()


def test_production_has_no_preview_handler_and_reports_live(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    assert provider.get_provider_mode() == "live"


def test_installing_the_dispatch_is_the_only_thing_that_makes_it_preview(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)

    async def handler(*_args, **_kwargs):
        raise AssertionError("the handler itself is not exercised here")

    provider.register_preview_handler(handler)  # monkeypatch restores the real value afterwards
    assert provider.get_provider_mode() == "preview"
    # With the simulator answering, the live client must be unreachable — not merely unused.
    with pytest.raises(ProviderFailure):
        provider.client()


def test_the_production_gateway_names_no_preview_module_and_no_switch():
    for forbidden in ("preview_simulator", "mock_provider", "from services.higgins.preview"):
        assert forbidden not in SOURCE, f"provider.py must not reference {forbidden}"
    for env_var in ("APOLLO_ENV", "APOLLO_PROVIDER_MODE"):
        assert env_var not in SOURCE, f"{env_var} must not decide the provider"


def test_startup_installs_the_dispatch_only_when_the_directory_is_deployed():
    assert "from services.higgins.preview.dispatch import install_preview_provider" in SERVER
    assert "except ImportError" in SERVER, "a production deployment must simply not find the module"
