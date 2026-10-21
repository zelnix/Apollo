"""The preview-only provider modes must never be able to run in production."""
import subprocess
import sys

CHECK = (
    "import services.higgins.provider as p; print('IMPORTED', p.get_provider_mode())"
)


def _run(env_overrides: dict[str, str]) -> subprocess.CompletedProcess:
    import os
    env = {**os.environ, **env_overrides}
    return subprocess.run([sys.executable, "-c", CHECK], cwd="/app/backend", env=env,
                          capture_output=True, text=True, timeout=120)


def test_simulated_mode_is_refused_in_production():
    for mode in ("simulated", "mock"):
        result = _run({"APOLLO_ENV": "production", "APOLLO_PROVIDER_MODE": mode})
        assert result.returncode != 0, f"{mode} started in production: {result.stdout}"
        assert "preview-only mode" in result.stderr, result.stderr


def test_unset_environment_is_treated_as_production():
    result = _run({"APOLLO_ENV": "", "APOLLO_PROVIDER_MODE": "simulated"})
    assert result.returncode != 0, result.stdout
    assert "preview-only mode" in result.stderr, result.stderr


def test_preview_environment_still_allows_the_simulator():
    result = _run({"APOLLO_ENV": "preview", "APOLLO_PROVIDER_MODE": "simulated"})
    assert "IMPORTED simulated" in result.stdout, result.stderr


def test_live_mode_runs_in_production():
    result = _run({"APOLLO_ENV": "production", "APOLLO_PROVIDER_MODE": "live"})
    assert "IMPORTED live" in result.stdout, result.stderr
