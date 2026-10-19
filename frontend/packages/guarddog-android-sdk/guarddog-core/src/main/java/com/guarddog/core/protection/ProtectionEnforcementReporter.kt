package com.guarddog.core.protection

import com.guarddog.core.events.BlockedThreatEvidence

/**
 * Core-facing enforcement reporting boundary. Implemented by the SDK engine, called
 * by the enforcement layer (VPN TUN read loop) ONLY after a packet was actually
 * observed on the TUN interface and intentionally dropped.
 *
 * Nothing else (rule match, DNS resolution, VPN start, failed HTTP request, test
 * helper) may call this. It is the only path that can lead to THREAT_BLOCKED.
 */
fun interface ProtectionEnforcementReporter {
    fun reportBlockedPacket(evidence: BlockedThreatEvidence)
}
