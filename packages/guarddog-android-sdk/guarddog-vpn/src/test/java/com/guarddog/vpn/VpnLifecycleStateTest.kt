package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
}
