"""Bounded source/configuration checks for the signing-free GuardDog production architecture.

These tests verify that the production source code matches the agreed HTTPS-authenticated,
signing-free trust model documented in memory/GUARDDOG_REVISED_TRUST_MODEL.md.
No device, provider, network or scenario execution."""
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


BACKEND_ROOT = ROOT.parent / "backend"


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def backend_text(relative: str) -> str:
    return (BACKEND_ROOT / relative).read_text(encoding="utf-8")


def test_production_engine_is_the_only_production_default():
    eas = json.loads(text("eas.json"))
    assert eas["build"]["production"]["env"]["EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE"] == "guarddog_production"
    assert eas["build"]["guarddog-production"]["extends"] == "production"
    module = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt")
    assert "GuardDog production is the sole enforcement engine" in module


def test_apollo_is_single_bridge_owner():
    package = json.loads(text("package.json"))
    assert "guarddog-expo-module" in package["expo"]["autolinking"]["android"]["exclude"]
    assert "guarddog-expo-module" in package["expo"]["autolinking"]["ios"]["exclude"]
    module = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt")
    assert "getGuardDogProductionStatus" in module and "refreshGuardDogProductionRules" in module


def test_production_trust_is_manifest_metadata_only():
    """The signing-key trust infrastructure (Ed25519, BouncyCastle, TrustedKeyRegistry) has
    been completely removed. Production eligibility is now controlled solely by a manifest
    meta-data boolean set by the withGuardDogEngine config plugin."""
    lifecycle = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogLifecycle.kt")
    assert "ApolloGuardDogProductionTrust" in lifecycle
    assert "GUARDDOG_PRODUCTION_ENABLED" in lifecycle
    # The old ApolloGuardDogProductionTrust.kt file must not exist as a separate file
    trust_file = ROOT / "modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionTrust.kt"
    assert not trust_file.exists(), "ApolloGuardDogProductionTrust.kt should not exist as a separate file"
    # No Ed25519/BouncyCastle/signing references in the lifecycle
    assert "Ed25519" not in lifecycle
    assert "BouncyCastle" not in lifecycle
    assert "TrustedKeyRegistry" not in lifecycle


def test_no_signing_infrastructure_in_core_sdk():
    """guarddog-core must not contain signing keys, BouncyCastle, TrustedKeyRegistry,
    or SignedRuleBundle. Validation uses RuleBundleValidator (schema + version + expiry only)."""
    build_gradle = text("packages/guarddog-android-sdk/guarddog-core/build.gradle.kts")
    assert "bouncycastle" not in build_gradle.lower()
    assert "bcprov" not in build_gradle
    validator = text("packages/guarddog-android-sdk/guarddog-core/src/main/java/com/guarddog/core/rules/RuleBundleVerifier.kt")
    assert "class RuleBundleValidator" in validator
    assert "Ed25519" not in validator
    assert "TrustedKeyRegistry" not in validator
    assert "SignedRuleBundle" not in validator
    assert "ValidationResult" in validator
    assert "RejectionReason" in validator


def test_runtime_stages_updates_and_enforces_expiry():
    runtime = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionRuntime.kt")
    for required in ["stopLocked()", "pending.isEmpty()", "clearAuthorization()",
                     "ApolloGuardDogExpiryWorker", "ApolloGuardDogRefreshWorker", "ruleBundleCurrent()"]:
        assert required in runtime, f"Missing: {required}"
    # Must not reference old signing infrastructure
    assert "BundleJson" not in runtime  # should use RuleBundle.fromJson()
    assert "RuleBundle.fromJson" in runtime


def test_production_runtime_wires_the_existing_m2_website_gate():
    runtime = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionRuntime.kt")
    for required in ["GuardDogVpnRuntime.websiteGateEngine = activeEngine", "WebsiteGateAddressing.defaultRouteConfig()",
                     "GuardDogVpnRuntime.upstreamDnsResolverIpv4 = upstream", "acceptWebsiteGateRuleBundle(raw)",
                     "GuardDogVpnRuntime.websiteGateActive", "clearWebsiteGateBindings()"]:
        assert required in runtime, f"Missing: {required}"


def test_boot_and_network_change_reconciliation_are_source_wired():
    manifest = text("modules/apollo-security/android/src/main/AndroidManifest.xml")
    observer = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogNetworkObserver.kt")
    receiver = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogRestartReceiver.kt")
    assert "RECEIVE_BOOT_COMPLETED" in manifest and "ApolloGuardDogRestartReceiver" in manifest
    assert "NET_CAPABILITY_NOT_VPN" in observer and "dnsServers" in observer
    assert "ACTION_MY_PACKAGE_REPLACED" in receiver and "ACTION_USER_UNLOCKED" in receiver


def test_production_configuration_is_https_and_redirect_closed():
    runtime = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionRuntime.kt")
    assert 'scheme == "https"' in runtime
    assert "connection.instanceFollowRedirects = false" in runtime


def test_preflight_rejects_competing_bridges():
    preflight = text("scripts/security-preflight.mjs")
    assert "The frozen GuardDog Expo bridge must remain excluded on Android and iOS" in preflight


def test_repository_contains_no_private_key_material():
    forbidden = ("BEGIN" + " PRIVATE KEY", "BEGIN" + " ED25519 PRIVATE KEY", "BEGIN" + " OPENSSH PRIVATE KEY")
    for path in ROOT.parent.rglob("*"):
        if not path.is_file() or any(part in {"node_modules", ".git", ".expo", "offline-keys"} for part in path.parts):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        assert not any(marker in content for marker in forbidden), path


def test_evidence_correlator_satisfies_js_boundary_contract():
    """ApolloGuardDogEvidenceCorrelator.kt must produce the full EnforcementEvidence
    contract expected by GuardDogEvidenceBoundary.ts."""
    correlator = text("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogEvidenceCorrelator.kt")
    for field in ["evidenceId", "platform", "mechanism", "direction", "protocol",
                  "destination", "attribution", "observedAt", "requestedAction",
                  "enforcedAction", "result", "ruleSource", "confidence",
                  "sourceMetadata", "matchedRuleId", "eventId", "deviceId",
                  "osVersion", "sdkVersion", "threatId", "correlationId"]:
        assert f'"{field}"' in correlator, f"Missing field: {field}"
    # Must use the correct mechanism for VpnService
    assert '"packet_filter"' in correlator
    assert '"outbound"' in correlator
    assert '"android"' in correlator


def test_backend_rules_are_deterministic():
    """Backend rule bundle must use deterministic timestamps so server restarts
    don't cause VERSION_CONFLICT rejections on devices."""
    guarddog = backend_text("routers/guarddog.py")
    assert "datetime.now()" not in guarddog, "datetime.now() would change hash on restart"
    assert '"issuedAt"' in guarddog
    assert '"expiresAt"' in guarddog
    assert '"bundleVersion"' in guarddog


def test_rule_bundle_uses_public_factory():
    """The RuleBundle class must expose a public fromJson() factory so the
    apollo-security module can parse bundles without accessing the internal BundleJson."""
    bundle = text("packages/guarddog-android-sdk/guarddog-core/src/main/java/com/guarddog/core/rules/RuleBundle.kt")
    assert "fun fromJson" in bundle
    assert "internal val BundleJson" in bundle  # BundleJson stays internal
