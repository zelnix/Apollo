package com.guarddog.core

import com.guarddog.core.clock.Clock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventSource
import com.guarddog.core.events.SecurityEventType
import com.guarddog.core.net.HostCanonicalizer
import com.guarddog.core.net.UrlSanitizer
import com.guarddog.core.protection.ProtectionEnforcementReporter
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.SignedRuleBundle
import com.guarddog.core.rules.VerificationResult
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/** Result of asking the engine whether a controlled target is authorized for enforcement. */
sealed class BlockAuthorization {
    data class Authorized(val host: String, val ipv4: String, val ruleId: String, val rulesetId: String, val bundleVersion: Long) : BlockAuthorization()
    data class NotAuthorized(val reason: String) : BlockAuthorization()
}

data class LocalAnalysis(val sanitizedUrl: String, val host: String, val verdict: String, val ruleId: String?)

/**
 * Platform-agnostic SDK engine. Does NOT import com.guarddog.vpn. Lifecycle state
 * arrives through [ProtectionRuntimeStateProvider]; enforcement evidence arrives
 * through [ProtectionEnforcementReporter]. The engine is the ONLY producer of
 * THREAT_BLOCKED, and it only does so from [BlockedThreatEvidence] whose destination
 * equals the currently authorized target (signed rule + verified resolution).
 */
class GuardDogSDKEngine(
    private val verifier: RuleBundleVerifier,
    private val runtimeState: ProtectionRuntimeStateProvider,
    private val clock: Clock,
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
) : ProtectionEnforcementReporter {

    private val listeners = CopyOnWriteArrayList<(SecurityEvent) -> Unit>()
    @Volatile private var acceptedBundle: SignedRuleBundle? = null
    @Volatile private var authorization: BlockAuthorization.Authorized? = null

    init {
        runtimeState.addListener { onRuntimeStateChanged(it) }
    }

    fun addEventListener(listener: (SecurityEvent) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun acceptedBundle(): SignedRuleBundle? = acceptedBundle
    fun currentAuthorization(): BlockAuthorization.Authorized? = authorization
    fun protectionState(): ProtectionRuntimeState = runtimeState.current()

    /** Independent on-device verification. Emits RULE_BUNDLE_ACCEPTED / REJECTED (never THREAT_BLOCKED). */
    fun acceptRuleBundle(rawJson: String): VerificationResult {
        val result = verifier.verify(rawJson)
        when (result) {
            is VerificationResult.Accepted -> {
                acceptedBundle = result.bundle
                authorization = null
                emit(
                    SecurityEventType.RULE_BUNDLE_ACCEPTED, SecurityEventSource.RULE_VERIFIER,
                    rulesetId = result.bundle.rulesetId, bundleVersion = result.bundle.bundleVersion,
                )
            }
            is VerificationResult.Rejected -> emit(
                SecurityEventType.RULE_BUNDLE_REJECTED, SecurityEventSource.RULE_VERIFIER, reason = result.reason.name,
            )
        }
        return result
    }

    /**
     * Rule authority chain: accepted bundle -> canonical host exact match -> action=block.
     * The VPN layer must call this with the dedicated IPv4 it verified via DNS/IP binding
     * immediately before installing the /32 route. Authorization alone emits nothing.
     */
    fun authorizeControlledTarget(host: String, resolvedIpv4: String): BlockAuthorization {
        val bundle = acceptedBundle ?: return BlockAuthorization.NotAuthorized("no accepted rule bundle")
        val canonical = HostCanonicalizer.canonicalize(host) ?: return BlockAuthorization.NotAuthorized("invalid host")
        if (HostCanonicalizer.canonicalize(resolvedIpv4) != resolvedIpv4 || resolvedIpv4.contains(':')) {
            return BlockAuthorization.NotAuthorized("resolved address is not a canonical IPv4")
        }
        val rule = bundle.exactMatch(canonical) ?: return BlockAuthorization.NotAuthorized("no exact-host rule for $canonical")
        if (rule.action != "block") return BlockAuthorization.NotAuthorized("rule action is ${rule.action}, not block")
        val auth = BlockAuthorization.Authorized(canonical, resolvedIpv4, rule.ruleId, bundle.rulesetId, bundle.bundleVersion)
        authorization = auth
        return auth
    }

    fun clearAuthorization() { authorization = null }

    /** Local analysis of the ORIGINAL candidate. Emits THREAT_DETECTED (a verdict, never a block claim). */
    fun analyzeUrl(rawUrl: String): LocalAnalysis? {
        val parsed = UrlSanitizer.sanitize(rawUrl) ?: return null
        val rule = acceptedBundle?.exactMatch(parsed.host)
        val verdict = rule?.action ?: "unknown"
        if (rule != null) {
            emit(
                SecurityEventType.THREAT_DETECTED, SecurityEventSource.LOCAL_ANALYSIS,
                sanitizedUrl = parsed.sanitizedUrl, host = parsed.host, ruleId = rule.ruleId,
                rulesetId = acceptedBundle?.rulesetId, bundleVersion = acceptedBundle?.bundleVersion, verdict = verdict,
            )
        }
        return LocalAnalysis(parsed.sanitizedUrl, parsed.host, verdict, rule?.ruleId)
    }

    /**
     * The only THREAT_BLOCKED path. Called by the enforcement layer after a real packet
     * was observed on TUN and dropped. Evidence for any destination other than the
     * authorized target is discarded (no overclaiming).
     */
    override fun reportBlockedPacket(evidence: BlockedThreatEvidence) {
        val auth = authorization ?: return
        if (evidence.destinationIpv4 != auth.ipv4) return
        if (runtimeState.current().state != com.guarddog.core.protection.ProtectionState.ACTIVE) return
        emit(
            SecurityEventType.THREAT_BLOCKED, SecurityEventSource.ANDROID_VPN_ENFORCEMENT,
            host = auth.host, destinationIp = evidence.destinationIpv4, sanitizedUrl = "https://${auth.host}/",
            ruleId = auth.ruleId, rulesetId = auth.rulesetId, bundleVersion = auth.bundleVersion,
            enforcementEvidenceId = evidence.enforcementEvidenceId, verdict = "block",
        )
    }

    private fun onRuntimeStateChanged(state: ProtectionRuntimeState) {
        // Authorization is kept for audit; enforcement is gated on ACTIVE in reportBlockedPacket.
        emit(
            SecurityEventType.PROTECTION_STATE_CHANGED, SecurityEventSource.PROTECTION_LIFECYCLE,
            protectionState = state.state.name, reason = state.reason,
        )
    }

    private fun emit(
        type: SecurityEventType,
        source: SecurityEventSource,
        sanitizedUrl: String? = null,
        host: String? = null,
        destinationIp: String? = null,
        ruleId: String? = null,
        rulesetId: String? = null,
        bundleVersion: Long? = null,
        enforcementEvidenceId: String? = null,
        verdict: String? = null,
        protectionState: String? = null,
        reason: String? = null,
    ) {
        val event = SecurityEvent(
            id = idGenerator(), type = type, source = source,
            occurredAt = Instant.ofEpochMilli(clock.nowEpochMillis()).toString().replace(Regex("\\.\\d+Z$"), "Z"),
            sanitizedUrl = sanitizedUrl, host = host, destinationIp = destinationIp, ruleId = ruleId, rulesetId = rulesetId,
            bundleVersion = bundleVersion, enforcementEvidenceId = enforcementEvidenceId, verdict = verdict,
            protectionState = protectionState, reason = reason,
        )
        listeners.forEach { it(event) }
    }
}
