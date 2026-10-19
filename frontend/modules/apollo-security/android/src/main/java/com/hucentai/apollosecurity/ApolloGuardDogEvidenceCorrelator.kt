package com.hucentai.apollosecurity

import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import java.time.Instant

/**
 * Correlates a GuardDog SDK SecurityEvent with the raw BlockedThreatEvidence that triggered it.
 * Produces a structured evidence record that satisfies the JS `EnforcementEvidence` contract
 * defined in `GuardDogEvidenceBoundary.ts` and `PlatformCapabilityProfile.ts`.
 *
 * Required fields for the JS boundary:
 *   evidenceId, platform="android", mechanism="packet_filter", direction="outbound",
 *   protocol, destination{ip, domain, port}, attribution{appId, processName, confidence},
 *   observedAt, requestedAction, enforcedAction, result, ruleSource, confidence,
 *   sourceMetadata{}, eventId, deviceId, osVersion, sdkVersion, matchedRuleId,
 *   threatId, correlationId
 *
 * Returns null when the event and evidence don't belong together (mismatched IDs or destination IPs).
 * This is a pure function with no side effects — safe to call from any thread.
 */
internal object ApolloGuardDogEvidenceCorrelator {

    /**
     * Correlate an engine SecurityEvent with the raw packet evidence.
     * Returns null if identifiers or destinations don't match.
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

        // "verified" requires: real enforcement + known protocol + known port
        val hasPort = evidence.destinationPort != null
        val result = if (hasPort && protocol != "unknown") "verified" else "unverified"

        return mapOf(
            // ── Identity ──
            "evidenceId" to evidence.enforcementEvidenceId,
            "eventId" to event.id,
            "deviceId" to null,                      // outer native module may enrich later
            "platform" to "android",
            "osVersion" to osVersion,
            "sdkVersion" to "guarddog-production-v2",

            // ── Observation ──
            "observedAt" to observedAt,

            // ── Enforcement source ──
            "mechanism" to "packet_filter",           // VpnService TUN = packet filter
            "direction" to "outbound",                // all VpnService-observed traffic is outbound

            // ── Protocol & destination ──
            "protocol" to protocol,
            "destination" to mapOf(
                "ip" to evidence.destinationIpv4,
                "domain" to (event.host ?: ""),        // host from the matched rule
                "port" to evidence.destinationPort,
            ),

            // ── Attribution (Android VpnService cannot attribute to specific app) ──
            "attribution" to mapOf(
                "appId" to null,
                "processName" to null,
                "confidence" to "unavailable",
            ),

            // ── Rule match ──
            "matchedRuleId" to event.ruleId,
            "threatId" to null,
            "requestedAction" to "block",
            "enforcedAction" to "blocked",
            "result" to result,
            "ruleSource" to "local_blocklist",
            "confidence" to if (result == "verified") "high" else "medium",

            // ── Source metadata (raw packet-level data for audit) ──
            "sourceMetadata" to mapOf(
                "ipProtocolNumber" to evidence.ipProtocol,
                "packetLength" to evidence.packetLength,
                "sourcePort" to (evidence.sourcePort ?: 0),
                "flowKey" to (evidence.flowKey ?: ""),
                "bundleVersion" to event.bundleVersion,
                "rulesetId" to (event.rulesetId ?: ""),
            ),

            "correlationId" to event.id,
        )
    }

    /**
     * Contract check: the evidence record must have the essential fields that the JS
     * boundary (`GuardDogEvidenceBoundary.ts`) validates before accepting. This gates
     * what enters the inbox — a record failing this check is reported as a failure
     * rather than silently delivered and rejected by the JS bridge.
     */
    fun contractValid(record: Map<String, Any?>): Boolean {
        if (record["evidenceId"] == null) return false
        if (record["platform"] != "android") return false
        if (record["mechanism"] != "packet_filter") return false
        if (record["direction"] != "outbound") return false
        if (record["observedAt"] == null) return false
        val destination = record["destination"] as? Map<*, *> ?: return false
        if (destination["ip"] == null) return false
        if (destination["domain"] == null) return false
        val attribution = record["attribution"] as? Map<*, *> ?: return false
        if (attribution["confidence"] == null) return false
        if (record["ruleSource"] == null) return false
        if (record["result"] == null) return false
        if (record["confidence"] == null) return false
        if (record["requestedAction"] == null) return false
        if (record["enforcedAction"] == null) return false
        if (record["sourceMetadata"] == null || record["sourceMetadata"] !is Map<*, *>) return false
        // verified evidence must not be: unknown protocol + null port
        if (record["result"] == "verified") {
            if (record["protocol"] == "unknown") return false
            if (destination["port"] == null) return false
        }
        return true
    }
}
