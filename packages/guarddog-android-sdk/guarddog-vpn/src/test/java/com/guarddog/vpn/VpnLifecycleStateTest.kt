package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VpnLifecycleStateTest {
    @Test fun mapsHonestlyToProtectionState() {
        assertEquals(ProtectionState.INACTIVE, VpnLifecycleState.Idle.toProtectionState())
        assertEquals(ProtectionState.INACTIVE, VpnLifecycleState.ConsentGranted.toProtectionState())
        assertEquals(ProtectionState.STARTING, VpnLifecycleState.Starting.toProtectionState())
        assertEquals(ProtectionState.ACTIVE, VpnLifecycleState.Running(0, "203.0.113.10/32").toProtectionState())
        assertEquals(ProtectionState.DEGRADED, VpnLifecycleState.Degraded("x").toProtectionState())
        assertEquals(ProtectionState.STOPPED, VpnLifecycleState.Stopped("x").toProtectionState())
        assertEquals(ProtectionState.REVOKED, VpnLifecycleState.Revoked.toProtectionState())
        assertEquals(ProtectionState.FAILED, VpnLifecycleState.Failed("x").toProtectionState())
    }

    @Test fun repositoryIsSingleSourceOfTruth() {
        val repo = VpnStateRepository(FixedClock(1_000))
        val seen = ArrayList<ProtectionState>()
        repo.addListener { seen.add(it.state) }
        repo.recordConsent(true)
        assertTrue(repo.consentGranted)
        repo.transition(VpnLifecycleState.Starting)
        repo.transition(VpnLifecycleState.Running(1_000, "203.0.113.10/32"))
        assertTrue(repo.lifecycle.isEnforcing)
        repo.transition(VpnLifecycleState.Revoked)
        assertFalse(repo.consentGranted) // revocation honestly clears consent
        assertFalse(repo.lifecycle.isEnforcing)
        assertEquals(listOf(ProtectionState.INACTIVE, ProtectionState.STARTING, ProtectionState.ACTIVE, ProtectionState.REVOKED), seen)
        assertEquals("VPN permission revoked by system/user", repo.current().reason)
    }

    // Phase 6A / M2.1 freeze regression: a physical device revoked VPN consent while no live
    // VpnService instance was around to call onRevoke() -> transition(Revoked), leaving the cached
    // consentGranted stale at true. current() must re-derive from a live OS check when one is wired.
    @Test fun currentReDerivesConsentFromLiveOsCheckOverStaleCache() {
        val repo = VpnStateRepository(FixedClock(1_000))
        repo.recordConsent(true)
        assertTrue(repo.current().consentGranted)
        // Android's own authoritative answer disagrees with our stale cache (the reported bug).
        repo.osConsentCheck = { false }
        assertFalse(repo.current().consentGranted)
        assertFalse(repo.consentGranted) // the cache itself is corrected too, not just the snapshot returned.
    }

    // No live check wired (plain unit tests, or the brief window before the bridge wires one at
    // process start) -- current() must fall back to the cached value exactly as before this fix.
    @Test fun currentFallsBackToCachedConsentWithoutALiveOsCheck() {
        val repo = VpnStateRepository(FixedClock(1_000))
        repo.recordConsent(true)
        assertNull(repo.osConsentCheck)
        assertTrue(repo.current().consentGranted)
    }

    // After an explicit stop where the OS still genuinely holds consent for this app, consentGranted
    // must legitimately stay true -- never forced false just because the service stopped/destroyed.
    @Test fun currentKeepsConsentTrueAfterExplicitStopWhenOsStillGrantsIt() {
        val repo = VpnStateRepository(FixedClock(1_000))
        repo.recordConsent(true)
        repo.osConsentCheck = { true } // OS still prepared for this app.
        repo.transition(VpnLifecycleState.Stopped("stopped by user"))
        assertTrue(repo.current().consentGranted)
    }
}
