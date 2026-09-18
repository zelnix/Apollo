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
 * Gate Guard M2 Website Gate: an ephemeral hostname -> sinkhole binding created from a DNS observation.
 * Strictly parallel to [BlockAuthorization] -- a completely separate table, never merged into it and
 * never consulted by [authorizeControlledTarget]/[reportBlockedPacket]'s M1 branch. A binding is never
 * itself evidence: DNS is authorization input only (see [authorizeWebsiteGateTarget]). It only lets
 * [reportBlockedPacket] attribute a *later*, independently-observed, dropped TUN packet to a host/rule.
 */
data class WebsiteGateBinding(
    val host: String,
    val sinkholeIpv4: String,
    val ruleId: String,
    val rulesetId: String,
    val bundleVersion: Long,
    val expiresAtEpochMillis: Long,
)

/** Outcome of [GuardDogSDKEngine.authorizeWebsiteGateTarget]. Strictly parallel to [BlockAuthorization]. */
sealed class WebsiteGateAuthorization {
    data class Bound(val binding: WebsiteGateBinding) : WebsiteGateAuthorization()
    data class Rejected(val reason: String) : WebsiteGateAuthorization()
}

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

    // --- Gate Guard M2 Website Gate state: strictly parallel to the two fields above, never merged. ---
    @Volatile private var acceptedWebsiteGateBundle: SignedRuleBundle? = null
    private val websiteGateBindings = java.util.concurrent.ConcurrentHashMap<String, WebsiteGateBinding>()

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

    // --- Gate Guard M2 Website Gate: strictly parallel methods. Never called by, and never call into,
    // the M1 methods above. A website-gate bundle can never satisfy authorizeControlledTarget or vice
    // versa -- they read from two entirely separate @Volatile bundle slots. ---

    fun acceptedWebsiteGateBundle(): SignedRuleBundle? = acceptedWebsiteGateBundle

    /** Independent verification slot, parallel to [acceptRuleBundle]. Verifies through the same
     * [RuleBundleVerifier] (signature/expiry/rollback checks are ruleset-agnostic); stored separately. */
    fun acceptWebsiteGateRuleBundle(rawJson: String): VerificationResult {
        val result = verifier.verify(rawJson)
        when (result) {
            is VerificationResult.Accepted -> {
                acceptedWebsiteGateBundle = result.bundle
                websiteGateBindings.clear() // a new bundle invalidates prior bindings' rule/version provenance
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
     * DNS is authorization input, never enforcement evidence. Call this only for a `block` rule match on
     * a DNS-observed hostname, immediately before answering that query with a sinkhole address from the
     * adapter's fixed pool (never the hostile domain's real address). Creates a short-lived binding and
     * emits nothing -- no THREAT_BLOCKED, no THREAT_DETECTED. The real packet drop, independently observed
     * on TUN later, is what [reportBlockedPacket] requires before anything is emitted.
     */
    fun authorizeWebsiteGateTarget(host: String, sinkholeIpv4: String, expiresAtEpochMillis: Long): WebsiteGateAuthorization {
        val bundle = acceptedWebsiteGateBundle ?: return WebsiteGateAuthorization.Rejected("no accepted website-gate rule bundle")
        val canonical = HostCanonicalizer.canonicalize(host) ?: return WebsiteGateAuthorization.Rejected("invalid host")
        if (HostCanonicalizer.canonicalize(sinkholeIpv4) != sinkholeIpv4 || sinkholeIpv4.contains(':')) {
            return WebsiteGateAuthorization.Rejected("sinkhole address is not a canonical IPv4")
        }
        if (expiresAtEpochMillis <= clock.nowEpochMillis()) {
            return WebsiteGateAuthorization.Rejected("expiresAtEpochMillis is already in the past")
        }
        val rule = bundle.exactMatch(canonical) ?: return WebsiteGateAuthorization.Rejected("no exact-host rule for $canonical")
        if (rule.action != "block") return WebsiteGateAuthorization.Rejected("rule action is ${rule.action}, not block")
        val binding = WebsiteGateBinding(canonical, sinkholeIpv4, rule.ruleId, bundle.rulesetId, bundle.bundleVersion, expiresAtEpochMillis)
        websiteGateBindings[sinkholeIpv4] = binding
        return WebsiteGateAuthorization.Bound(binding)
    }

    /** Read-only lookup for tests/adapters; unlike [reportBlockedPacket] this does not consume the binding. */
    fun currentWebsiteGateBinding(sinkholeIpv4: String): WebsiteGateBinding? = websiteGateBindings[sinkholeIpv4]

    fun clearWebsiteGateBindings() { websiteGateBindings.clear() }

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
     *
     * Checks the M1 single-target authorization first, exactly as before (unchanged conditions, order,
     * and emitted fields for that branch). Only when M1's authorization does not cover this destination
     * does it fall through to the strictly parallel Gate Guard M2 Website Gate binding table -- the two
     * models are never merged, and a website-gate binding can never satisfy the M1 branch or vice versa.
     */
    override fun reportBlockedPacket(evidence: BlockedThreatEvidence) {
        val auth = authorization
        if (auth != null && evidence.destinationIpv4 == auth.ipv4) {
            if (runtimeState.current().state != com.guarddog.core.protection.ProtectionState.ACTIVE) return
            emit(
                SecurityEventType.THREAT_BLOCKED, SecurityEventSource.ANDROID_VPN_ENFORCEMENT,
                host = auth.host, destinationIp = evidence.destinationIpv4, sanitizedUrl = "https://${auth.host}/",
                ruleId = auth.ruleId, rulesetId = auth.rulesetId, bundleVersion = auth.bundleVersion,
                enforcementEvidenceId = evidence.enforcementEvidenceId, verdict = "block",
                enforcementMechanism = evidence.enforcementLayer,
            )
            return
        }

        // Gate Guard M2 Website Gate: strictly parallel table. Peek first (not remove): a failed ACTIVE
        // check must not destroy the binding, matching the M1 branch above where a non-ACTIVE rejection
        // never mutates `authorization` either. The binding is only actually consumed (removed) once it
        // is either expired (discarded, no attribution) or has genuinely produced an attributed block.
        val binding = websiteGateBindings[evidence.destinationIpv4] ?: return
        if (binding.expiresAtEpochMillis <= clock.nowEpochMillis()) {
            websiteGateBindings.remove(evidence.destinationIpv4) // expired: discard, never re-attributed
            return
        }
        if (runtimeState.current().state != com.guarddog.core.protection.ProtectionState.ACTIVE) return
        websiteGateBindings.remove(evidence.destinationIpv4) // one-shot: consumed by this genuine drop
        emit(
            SecurityEventType.THREAT_BLOCKED, SecurityEventSource.ANDROID_VPN_ENFORCEMENT,
            host = binding.host, destinationIp = evidence.destinationIpv4, sanitizedUrl = "https://${binding.host}/",
            ruleId = binding.ruleId, rulesetId = binding.rulesetId, bundleVersion = binding.bundleVersion,
            enforcementEvidenceId = evidence.enforcementEvidenceId, verdict = "block",
            enforcementMechanism = evidence.enforcementLayer,
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
        enforcementMechanism: String? = null,
    ) {
        val event = SecurityEvent(
            id = idGenerator(), type = type, source = source,
            occurredAt = Instant.ofEpochMilli(clock.nowEpochMillis()).toString().replace(Regex("\\.\\d+Z$"), "Z"),
            sanitizedUrl = sanitizedUrl, host = host, destinationIp = destinationIp, ruleId = ruleId, rulesetId = rulesetId,
            bundleVersion = bundleVersion, enforcementEvidenceId = enforcementEvidenceId, verdict = verdict,
            protectionState = protectionState, reason = reason, enforcementMechanism = enforcementMechanism,
        )
        listeners.forEach { it(event) }
    }
}
