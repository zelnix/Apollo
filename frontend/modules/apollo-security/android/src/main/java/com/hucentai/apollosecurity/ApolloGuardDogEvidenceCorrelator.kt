package com.hucentai.apollosecurity

import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import java.time.Instant

/**
 * Correlates a GuardDog SDK SecurityEvent with the raw BlockedThreatEvidence that triggered it.
 * Produces a structured evidence record suitable for the inbox / JS bridge, or null when the
 * event and evidence don't belong together (mismatched IDs or destination IPs).
 *
 * This is a pure function with no side effects — safe to call from any thread.
 */
internal object ApolloGuardDogEvidenceCorrelator {

    /**
     * Correlate an engine SecurityEvent with the raw packet evidence.
     * Returns null if identifiers or destinations don't match (the event wasn't produced from this evidence).
     */
    fun correlate(event: SecurityEvent, evidence: BlockedThreatEvidence, osVersion: String): Map<String, Any?>? {
        // Guard: event must reference this exact evidence
        if (event.enforcementEvidenceId != evidence.enforcementEvidenceId) return null
        if (event.destinationIp != evidence.destinationIpv4) return null

        val protocol = when (evidence.ipProtocol) {
            6 -> "tcp"
            17 -> "udp"
            else -> "unknown"
        }

        val observedAt = Instant.ofEpochMilli(evidence.observedAtEpochMillis).toString()

        // result is "verified" only when we have a definite port observation
        val result = if (evidence.destinationPort != null) "verified" else "unverified"

        return mapOf(
            "evidenceId" to evidence.enforcementEvidenceId,
            "correlationId" to event.id,
            "protocol" to protocol,
            "observedAt" to observedAt,
            "result" to result,
            "ruleSource" to "local_blocklist",
            "mechanism" to (event.enforcementMechanism ?: "android-vpn-tun-drop"),
            "host" to event.host,
            "ruleId" to event.ruleId,
            "rulesetId" to event.rulesetId,
            "bundleVersion" to event.bundleVersion,
            "osVersion" to osVersion,
            "destination" to mapOf(
                "ip" to evidence.destinationIpv4,
                "port" to evidence.destinationPort,
            ),
            "sourceMetadata" to mapOf(
                "ipProtocolNumber" to evidence.ipProtocol,
                "packetLength" to evidence.packetLength,
                "sourcePort" to evidence.sourcePort,
                "flowKey" to evidence.flowKey,
            ),
        )
    }

    /**
     * Minimal contract check: the evidence record must have the essential fields for the
     * inbox to consider it worth persisting and delivering to the JS bridge.
     */
    fun contractValid(record: Map<String, Any?>): Boolean {
        return record["evidenceId"] != null &&
            record["observedAt"] != null &&
            record["host"] != null &&
            record["ruleId"] != null &&
            record["rulesetId"] != null
    }
}
