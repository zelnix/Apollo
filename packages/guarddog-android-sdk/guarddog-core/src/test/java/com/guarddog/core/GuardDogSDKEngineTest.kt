package com.guarddog.core

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventType
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.BundleVersionStore
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import com.guarddog.core.rules.VerificationResult
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Gate Guard M2 Website Gate: proves the WebsiteGateBinding table is strictly parallel to the M1
 * BlockAuthorization path, and that DNS is authorization input, never enforcement evidence -- only a
 * real, independently-observed dropped packet (BlockedThreatEvidence) may produce THREAT_BLOCKED.
 *
 * NOTE: code-review ready / not runtime-verified in this environment (no Android/JVM toolchain here);
 * same convention as RuleBundleVerifierTest. Verified compilable/passing by the native-gates CI job.
 */
class GuardDogSDKEngineTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")
    private fun read(path: String) = File(vectors, path).readText()

    // Fixture's issuedAt=2026-09-08T15:07:22Z, expiresAt=2026-10-08T15:07:22Z (see security/test-vectors/
    // m2-website-gate/m2_website_gate_valid_bundle.json's own generation comment in
    // docs/M2_WEBSITE_GATE_DESIGN.md). Lives outside signing/jcs deliberately: it's a live-signed M2 test
    // vector, not one of the M1 generator's official outputs, so it must never be swept into
    // test_regeneration_is_byte_identical's byte-for-byte reproduction check of that directory.
    private val frozen = FixedClock(Instant.parse("2026-09-15T00:00:00Z").toEpochMilli())

    private class FakeRuntimeState(initial: ProtectionState) : ProtectionRuntimeStateProvider {
        @Volatile private var state = ProtectionRuntimeState(initial, consentGranted = true, updatedAtEpochMillis = 0)
        private val listeners = CopyOnWriteArrayList<(ProtectionRuntimeState) -> Unit>()
        override fun current(): ProtectionRuntimeState = state
        override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit {
            listeners.add(listener)
            return { listeners.remove(listener) }
        }
        fun setState(s: ProtectionState) {
            state = ProtectionRuntimeState(s, consentGranted = true, updatedAtEpochMillis = 0)
            listeners.forEach { it(state) }
        }
    }

    private fun engine(
        store: BundleVersionStore = InMemoryBundleVersionStore(),
        clock: FixedClock = frozen,
        runtimeState: FakeRuntimeState = FakeRuntimeState(ProtectionState.ACTIVE),
    ): Triple<GuardDogSDKEngine, FakeRuntimeState, MutableList<SecurityEvent>> {
        val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), store, clock)
        val eng = GuardDogSDKEngine(verifier, runtimeState, clock)
        val emitted = mutableListOf<SecurityEvent>()
        eng.addEventListener { emitted.add(it) }
        return Triple(eng, runtimeState, emitted)
    }

    private fun evidenceFor(destinationIpv4: String, enforcementLayer: String = BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP) =
        BlockedThreatEvidence(
            enforcementEvidenceId = "ev-1", destinationIpv4 = destinationIpv4, destinationPort = 443, sourcePort = 51000,
            ipProtocol = 6, packetLength = 60, observedAtEpochMillis = frozen.nowEpochMillis(), flowKey = "6/10.0.0.2/$destinationIpv4/443",
            enforcementLayer = enforcementLayer,
        )

    @Test fun acceptingWebsiteGateBundleAndBinding_emitsNoThreatBlockedOrDetected() {
        val (eng, _, emitted) = engine()
        assertIs<VerificationResult.Accepted>(eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json")))
        val result = eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 5_000)
        assertIs<WebsiteGateAuthorization.Bound>(result)
        assertEquals("bad-test.guarddog.example", result.binding.host)
        assertEquals("10.0.0.99", result.binding.sinkholeIpv4)
        // DNS is authorization input, never enforcement evidence: no event of any kind from binding alone.
        assertTrue(emitted.none { it.type == SecurityEventType.THREAT_BLOCKED || it.type == SecurityEventType.THREAT_DETECTED })
    }

    @Test fun realDroppedPacketToLiveBinding_producesGenuineThreatBlocked() {
        val (eng, _, emitted) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 5_000)

        eng.reportBlockedPacket(evidenceFor("10.0.0.99"))

        val blocked = emitted.filter { it.type == SecurityEventType.THREAT_BLOCKED }
        assertEquals(1, blocked.size)
        val event = blocked.single()
        assertTrue(event.isGenuineBlock)
        assertEquals("bad-test.guarddog.example", event.host)
        assertEquals("m2-kotlin-test-block-001", event.ruleId)
        assertEquals("gd-m2-website-gate", event.rulesetId)
        assertEquals("ev-1", event.enforcementEvidenceId)
        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP, event.enforcementMechanism)
    }

    @Test fun bindingIsOneShot_secondPacketToSameSinkholeNeverBlocksAgain() {
        val (eng, _, emitted) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 5_000)

        eng.reportBlockedPacket(evidenceFor("10.0.0.99"))
        eng.reportBlockedPacket(evidenceFor("10.0.0.99")) // binding already consumed by the first drop

        assertEquals(1, emitted.count { it.type == SecurityEventType.THREAT_BLOCKED })
    }

    @Test fun packetToSinkholeWithoutAnyLiveBinding_neverBlocks() {
        val (eng, _, emitted) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        // no authorizeWebsiteGateTarget call at all -- nothing was ever bound to this address

        eng.reportBlockedPacket(evidenceFor("10.0.0.123"))

        assertEquals(0, emitted.count { it.type == SecurityEventType.THREAT_BLOCKED })
    }

    @Test fun expiredBinding_isDiscardedWithoutAttributionAndCannotBeReusedAfterward() {
        val (eng, _, emitted) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 1_000)
        frozen.advance(2_000) // now past expiresAtEpochMillis

        eng.reportBlockedPacket(evidenceFor("10.0.0.99"))

        assertEquals(0, emitted.count { it.type == SecurityEventType.THREAT_BLOCKED })
        assertNull(eng.currentWebsiteGateBinding("10.0.0.99")) // consumed/discarded, not left dangling
    }

    @Test fun dnsMatchAloneNeverProducesThreatBlocked_onlyReportBlockedPacketCan() {
        val (eng, _, emitted) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        repeat(3) { eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.9$it", frozen.nowEpochMillis() + 5_000) }
        assertEquals(0, emitted.size) // three DNS-driven bindings, zero events of any kind
    }

    @Test fun websiteGateAuthorizationRejectsAllowRuleAndUnknownHost() {
        val (eng, _, _) = engine()
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        assertIs<WebsiteGateAuthorization.Rejected>(eng.authorizeWebsiteGateTarget("good-test.guarddog.example", "10.0.0.50", frozen.nowEpochMillis() + 1_000))
        assertIs<WebsiteGateAuthorization.Rejected>(eng.authorizeWebsiteGateTarget("unknown.guarddog.example", "10.0.0.51", frozen.nowEpochMillis() + 1_000))
    }

    @Test fun websiteGateAuthorizationRequiresAcceptedBundleAndFutureExpiry() {
        val (eng, _, _) = engine() // no acceptWebsiteGateRuleBundle call at all
        assertIs<WebsiteGateAuthorization.Rejected>(eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 1_000))

        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        assertIs<WebsiteGateAuthorization.Rejected>(eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() - 1))
    }

    @Test fun m1AndM2AuthorizationAndBundleSlotsAreFullyIndependent() {
        val (eng, _, emitted) = engine()

        // M1 bundle (frozen v25-style fixture) into the M1 slot only.
        val m1Frozen = FixedClock(Instant.parse("2026-06-15T00:00:00Z").toEpochMilli())
        val m1Verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), m1Frozen)
        val m1Engine = GuardDogSDKEngine(m1Verifier, FakeRuntimeState(ProtectionState.ACTIVE), m1Frozen)
        m1Engine.addEventListener { emitted.add(it) }
        assertIs<VerificationResult.Accepted>(m1Engine.acceptRuleBundle(read("signing/valid_bundle.json")))
        assertIs<BlockAuthorization.Authorized>(m1Engine.authorizeControlledTarget("m1-block-test.guarddog.example", "203.0.113.7"))
        assertNull(m1Engine.acceptedWebsiteGateBundle()) // M1 slot accept never touches the M2 slot

        // M2 bundle into eng's M2 slot only; eng's M1 slot was never touched.
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 5_000)
        assertNull(eng.acceptedBundle())
        assertNull(eng.currentAuthorization())

        // A packet destined for the M1 target on the M1 engine blocks with M1 attribution.
        m1Engine.reportBlockedPacket(
            BlockedThreatEvidence(
                enforcementEvidenceId = "m1-ev", destinationIpv4 = "203.0.113.7", destinationPort = 443, sourcePort = 51000,
                ipProtocol = 6, packetLength = 60, observedAtEpochMillis = m1Frozen.nowEpochMillis(), flowKey = "6/10.0.0.2/203.0.113.7/443",
            ), // default enforcementLayer = ENFORCEMENT_LAYER_ANDROID_TUN_DROP, unchanged from before this feature existed
        )
        // A packet destined for the M2 sinkhole on eng blocks with M2 attribution.
        eng.reportBlockedPacket(evidenceFor("10.0.0.99"))

        val blocked = emitted.filter { it.type == SecurityEventType.THREAT_BLOCKED }
        assertEquals(2, blocked.size)
        val m1Event = blocked.single { it.host == "m1-block-test.guarddog.example" }
        val m2Event = blocked.single { it.host == "bad-test.guarddog.example" }
        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_TUN_DROP, m1Event.enforcementMechanism)
        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP, m2Event.enforcementMechanism)
        assertEquals("gd-m1-controlled-block", m1Event.rulesetId)
        assertEquals("gd-m2-website-gate", m2Event.rulesetId)
    }

    @Test fun protectionMustBeActiveForWebsiteGateBlockToo_sameGateAsM1() {
        val runtimeState = FakeRuntimeState(ProtectionState.STARTING)
        val (eng, state, emitted) = engine(runtimeState = runtimeState)
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        eng.authorizeWebsiteGateTarget("bad-test.guarddog.example", "10.0.0.99", frozen.nowEpochMillis() + 5_000)

        eng.reportBlockedPacket(evidenceFor("10.0.0.99")) // STARTING, not ACTIVE
        assertFalse(emitted.any { it.type == SecurityEventType.THREAT_BLOCKED })

        state.setState(ProtectionState.ACTIVE)
        eng.reportBlockedPacket(evidenceFor("10.0.0.99")) // binding still live (never consumed by the rejected attempt above)
        assertTrue(emitted.any { it.type == SecurityEventType.THREAT_BLOCKED })
    }
}
