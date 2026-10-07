package com.guarddog.core.rules

import com.guarddog.core.clock.Clock
import com.guarddog.core.clock.SystemClock
import java.time.Instant

/**
 * Validation result for a rule bundle received over authenticated HTTPS.
 * No cryptographic verification — the transport layer (TLS + baked-in URL) provides authentication.
 */
sealed class ValidationResult {
    data class Accepted(val bundle: RuleBundle) : ValidationResult()
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
}

/**
 * Validates rule bundles delivered over authenticated HTTPS. Enforces:
 * - Strict JSON schema (no unknown keys via kotlinx.serialization strict mode)
 * - Non-empty rules with valid action/matchType
 * - Temporal validity (issuedAt in past, expiresAt in future)
 * - Version rollback protection (bundleVersion must be >= last accepted)
 * - Version conflict detection (same version must have identical rulesetId)
 */
class RuleBundleValidator(
    private val versionStore: BundleVersionStore,
    private val clock: Clock = SystemClock,
) {
    fun validate(rawJson: String): ValidationResult {
        // 1. Parse
        val bundle: RuleBundle
        try {
            bundle = BundleJson.decodeFromString(RuleBundle.serializer(), rawJson)
        } catch (_: Exception) {
            return ValidationResult.Rejected(RejectionReason.INVALID_JSON)
        }

        // 2. Schema checks
        if (bundle.schemaVersion.isBlank() || bundle.rulesetId.isBlank() || bundle.bundleVersion < 1) {
            return ValidationResult.Rejected(RejectionReason.INVALID_SCHEMA)
        }

        // 3. Rules validation
        if (bundle.payload.rules.isEmpty()) {
            return ValidationResult.Rejected(RejectionReason.EMPTY_RULES)
        }
        for (rule in bundle.payload.rules) {
            if (rule.ruleId.isBlank() || rule.host.isBlank() || rule.action !in setOf("block", "allow") || rule.matchType != "exact") {
                return ValidationResult.Rejected(RejectionReason.INVALID_RULE)
            }
        }

        // 4. Temporal validity
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

        // 5. Rollback protection
        val highest = versionStore.highestAccepted(bundle.rulesetId)
        if (highest != null) {
            if (bundle.bundleVersion < highest.bundleVersion) {
                return ValidationResult.Rejected(RejectionReason.ROLLBACK)
            }
            if (bundle.bundleVersion == highest.bundleVersion && highest.contentHash != null) {
                val contentHash = sha256Hex(rawJson)
                if (contentHash != highest.contentHash) {
                    return ValidationResult.Rejected(RejectionReason.VERSION_CONFLICT)
                }
            }
        }

        // 6. Record accepted version
        val contentHash = sha256Hex(rawJson)
        versionStore.recordAccepted(bundle.rulesetId, bundle.bundleVersion, contentHash)

        return ValidationResult.Accepted(bundle)
    }

    companion object {
        fun sha256Hex(input: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            return digest.digest(input.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        }
    }
}
