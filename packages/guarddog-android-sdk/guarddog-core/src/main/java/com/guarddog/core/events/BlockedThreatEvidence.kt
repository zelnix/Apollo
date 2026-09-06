package com.guarddog.core.events

/**
 * Evidence that a real packet was observed on the TUN interface and dropped.
 * Produced exclusively by the VPN enforcement layer (PacketDropReporter).
 *
 * Audit chain: signed rule -> /32 route -> packet observation -> drop -> evidence -> SecurityEvent
 */
data class BlockedThreatEvidence(
    val enforcementEvidenceId: String,
    val destinationIpv4: String,
    val destinationPort: Int?,
    val sourcePort: Int?,
    /** IANA protocol number (6 = TCP, 17 = UDP, ...). */
    val ipProtocol: Int,
    val packetLength: Int,
    val observedAtEpochMillis: Long,
    /** Short-lived flow identity used for deduplication (proto/src/dst/dport). */
    val flowKey: String,
    val enforcementLayer: String = ENFORCEMENT_LAYER_ANDROID_TUN_DROP,
) {
    companion object {
        const val ENFORCEMENT_LAYER_ANDROID_TUN_DROP = "android-vpn-tun-drop"
    }
}
