package com.guarddog.vpn

import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * NOTE: same convention as GuardDogSDKEngineTest -- code-review ready / not runtime-verified in
 * this environment (no JVM toolchain here), verified compilable/passing by the native-gates CI job.
 */
class SinkholeBindingStoreTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")
    private fun read(path: String) = File(vectors, path).readText()
    private val clock = FixedClock(Instant.parse("2026-09-15T00:00:00Z").toEpochMilli())
    private val pool = listOf("192.0.2.240", "192.0.2.241")

    private class FakeRuntimeState : ProtectionRuntimeStateProvider {
        override fun current(): ProtectionRuntimeState = ProtectionRuntimeState(ProtectionState.ACTIVE, consentGranted = true, updatedAtEpochMillis = 0)
        override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit = {}
    }

    private fun engineWithAcceptedM2Bundle(): GuardDogSDKEngine {
        val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), clock)
        val eng = GuardDogSDKEngine(verifier, FakeRuntimeState(), clock)
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        return eng
    }

    @Test fun armsABlockedHostAndReturnsAPoolAddress() {
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock)
        val ip = store.arm("bad-test.guarddog.example")
        assertNotNull(ip)
        assertTrue(pool.contains(ip))
    }

    @Test fun rejectsAnAllowedHost_fallsOpen() {
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock)
        assertNull(store.arm("good-test.guarddog.example"))
    }

    @Test fun rejectsAnUnknownHost_fallsOpen() {
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock)
        assertNull(store.arm("unknown.guarddog.example"))
    }

    @Test fun repeatedArmingOfTheSameHostReusesTheSameSinkholeIp() {
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock)
        val first = store.arm("bad-test.guarddog.example")
        val second = store.arm("bad-test.guarddog.example")
        assertEquals(first, second)
    }

    @Test fun withNoAcceptedBundleEverythingFallsOpen() {
        val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), clock)
        val eng = GuardDogSDKEngine(verifier, FakeRuntimeState(), clock)
        val store = SinkholeBindingStore(eng, pool, 5_000, clock)
        assertNull(store.arm("bad-test.guarddog.example"))
    }

    @Test fun armingAloneNeverEmitsAnyEvent() {
        val eng = engineWithAcceptedM2Bundle()
        val emitted = mutableListOf<com.guarddog.core.events.SecurityEvent>()
        eng.addEventListener { emitted.add(it) }
        val store = SinkholeBindingStore(eng, pool, 5_000, clock)
        store.arm("bad-test.guarddog.example")
        assertTrue(emitted.isEmpty()) // DNS is authorization input, never enforcement evidence
    }

    // --- Gate Guard M2 Phase 5: local ALLOW-only override, additive default (WebsiteGateOverrideStoreTest covers the store itself in isolation). ---

    @Test fun aLocalAllowOverrideBeatsARealBlockRuleAndNeverArms() {
        val overrides = MutableWebsiteGateOverrideStore()
        overrides.setAllowed("bad-test.guarddog.example", true)
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock, overrides)
        assertNull(store.arm("bad-test.guarddog.example")) // overridden even though the signed rule says block
    }

    @Test fun removingTheOverrideRestoresTheRuleDecision() {
        val overrides = MutableWebsiteGateOverrideStore()
        overrides.setAllowed("bad-test.guarddog.example", true)
        overrides.setAllowed("bad-test.guarddog.example", false)
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock, overrides)
        assertNotNull(store.arm("bad-test.guarddog.example")) // reversible: back to the real rule decision
    }

    @Test fun anOverrideForAnUnrelatedHostDoesNotAffectAnything() {
        val overrides = MutableWebsiteGateOverrideStore()
        overrides.setAllowed("some-other-host.example", true)
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock, overrides)
        assertNotNull(store.arm("bad-test.guarddog.example"))
    }

    @Test fun defaultOverrideStoreParameterPreservesExactPhase4Behavior() {
        // Same construction as Phase 4's tests above (no 5th argument) -- proves the new
        // parameter is genuinely additive/opt-in, not a behavior change for existing callers.
        val store = SinkholeBindingStore(engineWithAcceptedM2Bundle(), pool, 5_000, clock)
        assertNotNull(store.arm("bad-test.guarddog.example"))
    }
}
