package com.guarddog.vpn

import com.guarddog.core.clock.Clock
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Single source of truth for VPN lifecycle + consent. The service writes here on
 * start, establish, revoke, stop and destroy; process death resets to Idle because
 * the repository lives in process memory (honest: no persisted "running" flag).
 *
 * Also adapts the state to the core-facing [ProtectionRuntimeStateProvider].
 */
class VpnStateRepository(private val clock: Clock = SystemClock) : ProtectionRuntimeStateProvider {
    private val listeners = CopyOnWriteArrayList<(ProtectionRuntimeState) -> Unit>()
    private val vpnListeners = CopyOnWriteArrayList<(VpnLifecycleState) -> Unit>()

    @Volatile var lifecycle: VpnLifecycleState = VpnLifecycleState.Idle
        private set
    @Volatile var consentGranted: Boolean = false
        private set

    @Synchronized
    fun recordConsent(granted: Boolean) {
        consentGranted = granted
        transition(if (granted) VpnLifecycleState.ConsentGranted else VpnLifecycleState.ConsentRequired)
    }

    @Synchronized
    fun transition(next: VpnLifecycleState) {
        lifecycle = next
        if (next is VpnLifecycleState.Revoked) consentGranted = false
        val snapshot = current()
        vpnListeners.forEach { it(next) }
        listeners.forEach { it(snapshot) }
    }

    override fun current(): ProtectionRuntimeState = ProtectionRuntimeState(
        state = lifecycle.toProtectionState(),
        consentGranted = consentGranted,
        reason = lifecycle.reason(),
        updatedAtEpochMillis = clock.nowEpochMillis(),
    )

    override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun addVpnListener(listener: (VpnLifecycleState) -> Unit): () -> Unit {
        vpnListeners.add(listener)
        return { vpnListeners.remove(listener) }
    }

    companion object {
        /** Process-wide instance shared by the service and the bridge. */
        val shared: VpnStateRepository by lazy { VpnStateRepository() }
    }
}
