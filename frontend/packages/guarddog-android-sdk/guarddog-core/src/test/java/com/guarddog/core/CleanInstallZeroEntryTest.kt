package com.guarddog.core

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventType
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleValidator
import com.guarddog.core.rules.ThreatDomainListTestKit
import com.guarddog.core.rules.ValidationResult
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A fresh install whose first Threat Domain List has zero entries: the list is accepted into both
 * engine slots and initialisation continues, but accepting it proves nothing about protection. The
 * runtime's own state is untouched and nothing is ever reported as blocked.
 */
class CleanInstallZeroEntryTest {
    private val kit = ThreatDomainListTestKit()
    private val clock = FixedClock(Instant.parse("2026-07-01T00:00:00Z").toEpochMilli())

    private class RuntimeState(initial: ProtectionState) : ProtectionRuntimeStateProvider {
        @Volatile private var state = ProtectionRuntimeState(initial, consentGranted = false, updatedAtEpochMillis = 0)
        private val listeners = CopyOnWriteArrayList<(ProtectionRuntimeState) -> Unit>()
        override fun current(): ProtectionRuntimeState = state
        override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit { listeners.add(listener); return { listeners.remove(listener) } }
        fun set(next: ProtectionState) { state = ProtectionRuntimeState(next, consentGranted = true, updatedAtEpochMillis = 0); listeners.forEach { it(state) } }
    }

    private fun evidence(ipv4: String) = BlockedThreatEvidence(
        enforcementEvidenceId = "ev-$ipv4", destinationIpv4 = ipv4, destinationPort = 443, sourcePort = 50000, ipProtocol = 6,
        packetLength = 60, observedAtEpochMillis = clock.nowEpochMillis(), flowKey = "6/10.0.0.2/$ipv4/443",
        enforcementLayer = BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP,
    )

    @Test fun freshInstallAcceptsAZeroEntryListAndContinues() {
        val store = InMemoryBundleVersionStore() // nothing accepted yet: a clean install
        val runtime = RuntimeState(ProtectionState.INACTIVE)
        val engine = GuardDogSDKEngine(RuleBundleValidator(store, clock, kit.publicKeyB64), runtime, clock)
        val events = mutableListOf<SecurityEvent>()
        engine.addEventListener { events.add(it) }
        val raw = kit.signed(kit.content(emptyList(), bundleVersion = 3))

        assertIs<ValidationResult.Accepted>(engine.acceptRuleBundle(raw))
        assertIs<ValidationResult.Accepted>(engine.acceptWebsiteGateRuleBundle(raw))
        assertEquals(0, assertNotNull(engine.acceptedBundle()).payload.rules.size)
        assertNotNull(engine.acceptedWebsiteGateBundle())
        assertTrue(events.none { it.type == SecurityEventType.RULE_BUNDLE_REJECTED })
        assertEquals(2, events.count { it.type == SecurityEventType.RULE_BUNDLE_ACCEPTED })

        // Accepting the list is not protection: the runtime decides that, and it hasn't changed.
        assertEquals(ProtectionState.INACTIVE, engine.protectionState().state)
        assertTrue(events.none { it.type == SecurityEventType.PROTECTION_STATE_CHANGED })

        // With no entries nothing is authorised, detected or blocked — the list is current, just empty of threats.
        val gate = assertIs<WebsiteGateAuthorization.Rejected>(engine.authorizeWebsiteGateTarget("example.com", "10.0.0.99", clock.nowEpochMillis() + 5_000))
        assertTrue(gate.reason.startsWith("no exact-host rule"), gate.reason)
        assertIs<BlockAuthorization.NotAuthorized>(engine.authorizeControlledTarget("example.com", "93.184.216.34"))
        assertEquals("unknown", assertNotNull(engine.analyzeUrl("https://example.com/")).verdict)

        runtime.set(ProtectionState.ACTIVE) // even once the runtime reports ACTIVE …
        engine.reportBlockedPacket(evidence("10.0.0.99"))
        engine.reportBlockedPacket(evidence("93.184.216.34"))
        assertTrue(events.none { it.type == SecurityEventType.THREAT_BLOCKED || it.type == SecurityEventType.THREAT_DETECTED })
    }

    @Test fun restartRestoresTheSameZeroEntryList() {
        val store = InMemoryBundleVersionStore()
        val raw = kit.signed(kit.content(emptyList(), bundleVersion = 3))
        val first = GuardDogSDKEngine(RuleBundleValidator(store, clock, kit.publicKeyB64), RuntimeState(ProtectionState.INACTIVE), clock)
        assertIs<ValidationResult.Accepted>(first.acceptRuleBundle(raw))
        // A new engine (app restart) re-reading the persisted list against the same version store.
        val restored = GuardDogSDKEngine(RuleBundleValidator(store, clock, kit.publicKeyB64), RuntimeState(ProtectionState.INACTIVE), clock)
        assertIs<ValidationResult.Accepted>(restored.acceptRuleBundle(raw))
        assertIs<ValidationResult.Accepted>(restored.acceptWebsiteGateRuleBundle(raw))
    }

    @Test fun aLaterPopulatedListBlocksOnlyThroughRealEvidence() {
        val store = InMemoryBundleVersionStore()
        val runtime = RuntimeState(ProtectionState.ACTIVE)
        val engine = GuardDogSDKEngine(RuleBundleValidator(store, clock, kit.publicKeyB64), runtime, clock)
        val events = mutableListOf<SecurityEvent>()
        engine.addEventListener { events.add(it) }
        assertIs<ValidationResult.Accepted>(engine.acceptWebsiteGateRuleBundle(kit.signed(kit.content(emptyList(), bundleVersion = 3))))
        assertIs<ValidationResult.Accepted>(engine.acceptWebsiteGateRuleBundle(kit.signed(kit.content(listOf(kit.entry("ti-1", "bad-one.example")), bundleVersion = 4))))
        assertIs<WebsiteGateAuthorization.Bound>(engine.authorizeWebsiteGateTarget("bad-one.example", "10.0.0.98", clock.nowEpochMillis() + 5_000))
        assertTrue(events.none { it.type == SecurityEventType.THREAT_BLOCKED }) // a binding alone is never a block
        engine.reportBlockedPacket(evidence("10.0.0.98"))
        assertEquals(1, events.count { it.type == SecurityEventType.THREAT_BLOCKED })
    }
}
