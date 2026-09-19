package com.guarddog.core.protection

/**
 * Core-facing view of protection lifecycle. The core never imports `com.guarddog.vpn`;
 * the VPN module implements this interface and is the single authoritative source
 * (service start/stop/death/revocation all flow through it). No duplicate booleans.
 */
enum class ProtectionState { INACTIVE, STARTING, ACTIVE, DEGRADED, STOPPED, REVOKED, FAILED }

data class ProtectionRuntimeState(
    val state: ProtectionState,
    val consentGranted: Boolean,
    val reason: String? = null,
    val updatedAtEpochMillis: Long,
)

interface ProtectionRuntimeStateProvider {
    fun current(): ProtectionRuntimeState

    /** Returns an unsubscribe handle. */
    fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit
}
