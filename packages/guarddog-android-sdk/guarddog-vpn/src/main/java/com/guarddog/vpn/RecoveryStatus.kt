package com.guarddog.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * Snapshot used by the recovery proof (AC-06). Every field is read from the real runtime:
 *  - tunOpen: the retained TUN ParcelFileDescriptor session exists and has not been closed
 *  - selectiveRouteActive: the authoritative lifecycle is Running (the /32 route only exists while the TUN fd is open)
 *  - vpnTransportPresent: the OS reports any network with TRANSPORT_VPN (ConnectivityManager), independent of our own state
 * Nothing here is inferred from HTTP results; the harness performs the real HTTPS re-check separately.
 */
data class RecoveryStatus(
    val lifecycle: String,
    val tunOpen: Boolean,
    val selectiveRouteActive: Boolean,
    val vpnTransportPresent: Boolean,
    val routeCidr: String?,
    val dropReporterAttached: Boolean,
) {
    val recovered: Boolean get() = !tunOpen && !selectiveRouteActive && !vpnTransportPresent && !dropReporterAttached
}

object RecoveryInspector {
    /** Pure snapshot from runtime objects (unit-testable). */
    fun fromRuntime(state: VpnStateRepository, session: TunSession?, dropReporter: PacketDropReporter?, vpnTransportPresent: Boolean): RecoveryStatus {
        val lifecycle = state.lifecycle
        return RecoveryStatus(
            lifecycle = lifecycle.toProtectionState().name,
            tunOpen = session != null && !session.closed,
            selectiveRouteActive = lifecycle.isEnforcing,
            vpnTransportPresent = vpnTransportPresent,
            routeCidr = (lifecycle as? VpnLifecycleState.Running)?.routeCidr,
            dropReporterAttached = dropReporter != null,
        )
    }

    /** OS-level check: is any VPN transport currently present on the device? Requires ACCESS_NETWORK_STATE. */
    @Suppress("DEPRECATION")
    fun vpnTransportPresent(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }

    fun inspect(context: Context, state: VpnStateRepository = VpnStateRepository.shared): RecoveryStatus =
        fromRuntime(state, GuardDogVpnRuntime.activeSession, GuardDogVpnRuntime.dropReporter, vpnTransportPresent(context))
}
