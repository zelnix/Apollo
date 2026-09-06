package com.guarddog.core.events

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors packages/guarddog-contracts/src/securityEvent.ts. Expo-independent. */
@Serializable
enum class SecurityEventType {
    @SerialName("THREAT_BLOCKED") THREAT_BLOCKED,
    @SerialName("THREAT_DETECTED") THREAT_DETECTED,
    @SerialName("PROTECTION_STATE_CHANGED") PROTECTION_STATE_CHANGED,
    @SerialName("RULE_BUNDLE_ACCEPTED") RULE_BUNDLE_ACCEPTED,
    @SerialName("RULE_BUNDLE_REJECTED") RULE_BUNDLE_REJECTED,
}

@Serializable
enum class SecurityEventSource {
    @SerialName("android-vpn-enforcement") ANDROID_VPN_ENFORCEMENT,
    @SerialName("local-analysis") LOCAL_ANALYSIS,
    @SerialName("rule-verifier") RULE_VERIFIER,
    @SerialName("protection-lifecycle") PROTECTION_LIFECYCLE,
}

@Serializable
data class SecurityEvent(
    val id: String,
    val type: SecurityEventType,
    val source: SecurityEventSource,
    /** ISO-8601 UTC, e.g. 2026-06-15T00:00:00Z */
    val occurredAt: String,
    val sanitizedUrl: String? = null,
    val host: String? = null,
    val destinationIp: String? = null,
    val ruleId: String? = null,
    val rulesetId: String? = null,
    val bundleVersion: Long? = null,
    val enforcementEvidenceId: String? = null,
    val verdict: String? = null,
    val protectionState: String? = null,
    val reason: String? = null,
) {
    /** True only for events produced from real packet-drop evidence. */
    val isGenuineBlock: Boolean
        get() = type == SecurityEventType.THREAT_BLOCKED &&
            source == SecurityEventSource.ANDROID_VPN_ENFORCEMENT &&
            !enforcementEvidenceId.isNullOrEmpty()
}
