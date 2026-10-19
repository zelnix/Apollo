package com.guarddog.core.rules

import com.guarddog.core.clock.Clock
import com.guarddog.core.clock.SystemClock
import java.time.Instant

/**
 * Validation result for a rule bundle.
 * Stage 4: Now includes Ed25519 signature verification as the first check.
 */
sealed class ValidationResult {
    data class Accepted(val bundle: RuleBundle, val signatureVerified: Boolean = false) : ValidationResult()
    data class Rejected(val reason: RejectionReason) : ValidationResult()
}

enum class RejectionReason {
    INVALID_JSON,
    INVALID_SCHEMA,
    EMPTY_RULES,
    INVALID_RULE,
    EXPIRED,
    NOT_YET_VALID,
    ROLLBACK,
    VERSION_CONFLICT,
    /** Stage 4: The Ed25519 signature is invalid — bundle was tampered with. */
    SIGNATURE_INVALID,
    /** Stage 4: Signing key is configured but the bundle has no signature — possible signature-stripping attack. */
    SIGNATURE_MISSING,
}

/**
 * Validates rule bundles. Enforces:
 * - Ed25519 signature verification (Stage 4, when a public key is configured)
 * - Strict JSON schema (no unknown keys via kotlinx.serialization strict mode)
 * - Non-empty rules with valid action/matchType
 * - Temporal validity (issuedAt in past, expiresAt in future)
 * - Version rollback protection (bundleVersion must be >= last accepted)
 * - Version conflict detection (same version must have identical rulesetId)
 *
 * Signature verification is the FIRST check — if it fails, no further validation is performed.
 * If no public key is configured (null), signature verification is skipped (HTTPS-only mode).
 */
class RuleBundleValidator(
    private val versionStore: BundleVersionStore,
    private val clock: Clock = SystemClock,
    /** Base64-encoded raw Ed25519 public key (32 bytes) for signature verification.
     * Null = signature verification disabled (HTTPS-only authentication). */
    private val signingPublicKeyB64: String? = null,
) {
    fun validate(rawJson: String): ValidationResult {
        // ── Stage 4: Signature verification (FIRST, before any parsing) ──
        var signatureVerified = false
        if (signingPublicKeyB64 != null) {
            when (val sigResult = Ed25519BundleVerifier.verify(rawJson, signingPublicKeyB64)) {
                is Ed25519BundleVerifier.VerifyResult.Valid -> {
                    signatureVerified = true
                }
                is Ed25519BundleVerifier.VerifyResult.Invalid -> {
                    // Tampered or forged bundle — reject immediately
                    return ValidationResult.Rejected(RejectionReason.SIGNATURE_INVALID)
                }
                is Ed25519BundleVerifier.VerifyResult.Unsigned -> {
                    // Signing key is configured but the bundle carries no signature.
                    // Reject to prevent signature-stripping attacks.
                    return ValidationResult.Rejected(RejectionReason.SIGNATURE_MISSING)
                }
                is Ed25519BundleVerifier.VerifyResult.Unavailable -> {
                    // Ed25519 not available on this Android version (API 26–32).
                    // Gracefully degrade to HTTPS-only authentication.
                    signatureVerified = false
                }
            }
        }

        // ── 1. Parse ──
        val bundle: RuleBundle
        try {
            bundle = BundleJson.decodeFromString(RuleBundle.serializer(), rawJson)
        } catch (_: Exception) {
            return ValidationResult.Rejected(RejectionReason.INVALID_JSON)
        }

        // ── 2. Schema checks — only the current "2.0" schema is accepted. ──
        if (bundle.schemaVersion != "2.0" || bundle.rulesetId.isBlank() || bundle.bundleVersion < 1) {
            return ValidationResult.Rejected(RejectionReason.INVALID_SCHEMA)
        }

        // ── 3. Rules validation ──
        if (bundle.payload.rules.isEmpty()) {
            return ValidationResult.Rejected(RejectionReason.EMPTY_RULES)
        }
        for (rule in bundle.payload.rules) {
            if (rule.ruleId.isBlank() || rule.host.isBlank() || rule.action !in setOf("block", "allow") || rule.matchType != "exact") {
                return ValidationResult.Rejected(RejectionReason.INVALID_RULE)
            }
        }

        // ── 4. Temporal validity ──
        val now = Instant.ofEpochMilli(clock.nowEpochMillis())
        val issued: Instant
        val expires: Instant
        try {
            issued = Instant.parse(bundle.issuedAt)
            expires = Instant.parse(bundle.expiresAt)
        } catch (_: Exception) {
            return ValidationResult.Rejected(RejectionReason.INVALID_SCHEMA)
        }
        if (issued.isAfter(now)) return ValidationResult.Rejected(RejectionReason.NOT_YET_VALID)
        if (!expires.isAfter(now)) return ValidationResult.Rejected(RejectionReason.EXPIRED)

        // ── 5. Rollback protection ──
        val canonicalJson = BundleJson.encodeToString(RuleBundle.serializer(), bundle)
        val highest = versionStore.highestAccepted(bundle.rulesetId)
        if (highest != null) {
            if (bundle.bundleVersion < highest.bundleVersion) {
                return ValidationResult.Rejected(RejectionReason.ROLLBACK)
            }
            if (bundle.bundleVersion == highest.bundleVersion && highest.contentHash != null) {
                val contentHash = sha256Hex(canonicalJson)
                if (contentHash != highest.contentHash) {
                    return ValidationResult.Rejected(RejectionReason.VERSION_CONFLICT)
                }
            }
        }

        // ── 6. Record accepted version ──
        val contentHash = sha256Hex(canonicalJson)
        versionStore.recordAccepted(bundle.rulesetId, bundle.bundleVersion, contentHash)

        return ValidationResult.Accepted(bundle, signatureVerified = signatureVerified)
    }

    companion object {
        fun sha256Hex(input: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            return digest.digest(input.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        }
    }
}
