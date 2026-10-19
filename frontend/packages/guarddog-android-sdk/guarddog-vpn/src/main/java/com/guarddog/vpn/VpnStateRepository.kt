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

    /**
     * Optional LIVE query of Android's own authoritative consent answer (wired by the bridge to
     * `VpnService.prepare(context) == null`; see GuardDogExpoModule.kt). A real device run showed
     * [consentGranted] going stale/wrong after a genuine OS-level revoke that no live `VpnService`
     * instance was around to observe via [onRevoke]-driven [transition] -- so a cached boolean must
     * never be treated as the final authority for a *query* when the OS itself can be asked fresh.
     * Left null by plain unit tests (and briefly at process start before the bridge wires it), in
     * which case [current] falls back to the cached value exactly as before -- no regression.
     */
    @Volatile var osConsentCheck: (() -> Boolean)? = null

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

    @Synchronized
    override fun current(): ProtectionRuntimeState {
        // Re-derive from the OS every time this is queried, when we can: never let a cached flag
        // outlive what Android itself would say right now (see [osConsentCheck] doc above). The
        // cache is corrected in place too, so it can't keep drifting further from the truth between
        // queries.
        osConsentCheck?.invoke()?.let { consentGranted = it }
        return ProtectionRuntimeState(
            state = lifecycle.toProtectionState(),
            consentGranted = consentGranted,
            reason = lifecycle.reason(),
            updatedAtEpochMillis = clock.nowEpochMillis(),
        )
    }

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
