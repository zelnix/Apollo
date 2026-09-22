"""Bounded source/configuration checks only; no device, provider, network or scenario execution."""
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_production_engine_is_explicit_and_not_default():
    eas = json.loads(text("eas.json"))
    assert eas["build"]["app-bundle"]["env"]["EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE"] == "legacy"
    assert eas["build"]["guarddog-production"]["env"]["EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE"] == "guarddog_production"


def test_apollo_is_single_bridge_owner():
    package = json.loads(text("package.json"))
    assert "guarddog-expo-module" in package["expo"]["autolinking"]["android"]["exclude"]
    assert "guarddog-expo-module" in package["expo"]["autolinking"]["ios"]["exclude"]
    module = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt")
    assert "getGuardDogProductionStatus" in module and "refreshGuardDogProductionAuthority" in module


def test_primary_recovery_and_test_key_boundaries_exist():
    trust = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionTrust.kt")
    assert "disabledPrimaryRoots" in trust and "recoveryFloor" in trust
    assert "M1_TEST_KEY_ID" in trust and "M1_TEST_PUBLIC_KEY_B64" in trust
    assert "primary authority is disabled or below recovery floor" in trust


def test_runtime_stages_updates_and_enforces_expiry():
    runtime = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionRuntime.kt")
    for required in ["rollbackProtected = false", "stopLocked()", "pending.isEmpty()", "clearAuthorization()", "rebuild(staged.state)",
                     "ApolloGuardDogExpiryWorker", "ApolloGuardDogRefreshWorker", "authorityCurrent()"]:
        assert required in runtime


def test_repository_contains_no_private_key_material():
    forbidden = ("BEGIN" + " PRIVATE KEY", "BEGIN" + " ED25519 PRIVATE KEY", "BEGIN" + " OPENSSH PRIVATE KEY")
    for path in ROOT.parent.rglob("*"):
        if not path.is_file() or any(part in {"node_modules", ".git", ".expo"} for part in path.parts):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        assert not any(marker in content for marker in forbidden), path