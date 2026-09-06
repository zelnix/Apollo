package com.guarddog.expo

import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventSource
import com.guarddog.core.events.SecurityEventType
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.rules.RejectReason
import com.guarddog.core.rules.VerificationResult
import com.guarddog.expo.dto.BridgeCapabilityRecord
import com.guarddog.expo.dto.BridgeProtectionConfigRecord
import com.guarddog.expo.dto.BridgeProtectionStateRecord
import com.guarddog.expo.dto.BridgeRuleBundleRecord
import com.guarddog.expo.dto.BridgeSecurityEventRecord
import com.guarddog.vpn.VpnConfig
import java.time.Instant

/** Explicit domain -> bridge DTO adapters. Also the bridge-side truthfulness gate. */
object GuardDogExpoAdapters {
    private val wire = mapOf(
        SecurityEventType.THREAT_BLOCKED to "THREAT_BLOCKED",
        SecurityEventType.THREAT_DETECTED to "THREAT_DETECTED",
        SecurityEventType.PROTECTION_STATE_CHANGED to "PROTECTION_STATE_CHANGED",
        SecurityEventType.RULE_BUNDLE_ACCEPTED to "RULE_BUNDLE_ACCEPTED",
        SecurityEventType.RULE_BUNDLE_REJECTED to "RULE_BUNDLE_REJECTED",
    )
    private val sources = mapOf(
        SecurityEventSource.ANDROID_VPN_ENFORCEMENT to "android-vpn-enforcement",
        SecurityEventSource.LOCAL_ANALYSIS to "local-analysis",
        SecurityEventSource.RULE_VERIFIER to "rule-verifier",
        SecurityEventSource.PROTECTION_LIFECYCLE to "protection-lifecycle",
    )
    private val sanitizedUrlShape = Regex("^https?://[^\\s/?#@]+(/[^\\s?#]*)?$")

    /**
     * Returns null when the event must NOT be emitted: a THREAT_BLOCKED without enforcement
     * evidence/source/observed IP is refused here even if something upstream produced it.
     */
    fun toRecord(event: SecurityEvent): BridgeSecurityEventRecord? {
        if (event.type == SecurityEventType.THREAT_BLOCKED) {
            if (!event.isGenuineBlock || event.destinationIp == null || event.ruleId == null || event.rulesetId == null) return null
        }
        event.sanitizedUrl?.let { if (!sanitizedUrlShape.matches(it.replace(Regex("^(https?://)\\[[^]]+]"), "$1x"))) return null }
        return BridgeSecurityEventRecord().apply {
            id = event.id; type = wire.getValue(event.type); source = sources.getValue(event.source); occurredAt = event.occurredAt
            sanitizedUrl = event.sanitizedUrl; host = event.host; destinationIp = event.destinationIp; ruleId = event.ruleId
            rulesetId = event.rulesetId; bundleVersion = event.bundleVersion?.toDouble(); enforcementEvidenceId = event.enforcementEvidenceId
            verdict = event.verdict; protectionState = event.protectionState; reason = event.reason
        }
    }

    fun androidCapabilities(): BridgeCapabilityRecord = BridgeCapabilityRecord().apply {
        platform = "android"; selectiveIpBlocking = true; hostnameVisibility = "selective-ip-only"
        dnsInterception = false; dohDotCoverage = false; quicHttp3Coverage = false; perAppAttribution = false
        universalDeviceProtection = false; analysisAndWarningOnly = false; vpnConsentRequired = true
    }

    fun toRecord(result: VerificationResult): BridgeRuleBundleRecord = BridgeRuleBundleRecord().apply {
        when (result) {
            is VerificationResult.Accepted -> {
                accepted = true; rulesetId = result.bundle.rulesetId; bundleVersion = result.bundle.bundleVersion.toDouble()
                keyId = result.bundle.keyId; ruleCount = result.bundle.payload.rules.size.toDouble()
            }
            is VerificationResult.Rejected -> { accepted = false; rejectReason = result.reason.name }
        }
    }

    fun toRecord(state: ProtectionRuntimeState): BridgeProtectionStateRecord = BridgeProtectionStateRecord().apply {
        this.state = state.state.name; consentGranted = state.consentGranted; reason = state.reason
        updatedAt = Instant.ofEpochMilli(state.updatedAtEpochMillis).toString()
    }

    fun toVpnConfig(record: BridgeProtectionConfigRecord): VpnConfig = VpnConfig(
        controlledHost = record.controlledHost, controlledIpv4 = record.controlledIpv4, controlledUrl = record.controlledUrl,
        rulesetId = record.rulesetId, dedupeWindowMillis = record.dedupeWindowMs.toLong(),
    )

    fun rejectReasonName(reason: RejectReason): String = reason.name
}
