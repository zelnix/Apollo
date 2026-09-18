package com.guarddog.vpn

import com.guarddog.core.protection.ProtectionState

/**
 * Authoritative VPN lifecycle. Written only by the service (and the consent flow);
 * there are no parallel `running` booleans anywhere else.
 */
sealed class VpnLifecycleState {
    object Idle : VpnLifecycleState()
    object ConsentRequired : VpnLifecycleState()
    object ConsentGranted : VpnLifecycleState()
    object Starting : VpnLifecycleState()
    data class Running(val startedAtEpochMillis: Long, val routeCidr: String) : VpnLifecycleState()
    data class Degraded(val reason: String) : VpnLifecycleState()
    data class Stopped(val reason: String) : VpnLifecycleState()
    object Revoked : VpnLifecycleState()
    data class Failed(val reason: String) : VpnLifecycleState()

    val isEnforcing: Boolean get() = this is Running

    fun toProtectionState(): ProtectionState = when (this) {
        Idle, ConsentRequired, ConsentGranted -> ProtectionState.INACTIVE
        Starting -> ProtectionState.STARTING
        is Running -> ProtectionState.ACTIVE
        is Degraded -> ProtectionState.DEGRADED
        is Stopped -> ProtectionState.STOPPED
        Revoked -> ProtectionState.REVOKED
        is Failed -> ProtectionState.FAILED
    }

    fun reason(): String? = when (this) {
        is Degraded -> reason
        is Stopped -> reason
        is Failed -> reason
        Revoked -> "VPN permission revoked by system/user"
        else -> null
    }
}
