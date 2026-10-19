package com.guarddog.core.rules

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A validated rule bundle delivered over authenticated HTTPS with Ed25519 cryptographic
 * signature verification (Stage 4).
 *
 * The [signature] field (when present) contains the base64-encoded Ed25519 signature of the
 * canonical JSON content (all fields except 'signature', sorted keys, compact separators).
 * Native verification uses the pinned public key to authenticate the bundle before any
 * schema or version checks.
 *
 * Backward compatible: bundles without a [signature] field are accepted but marked as
 * unverified (relying on HTTPS-only authentication).
 */
@Serializable
data class RuleBundle(
    val schemaVersion: String,
    val rulesetId: String,
    val bundleVersion: Long,
    val issuedAt: String,
    val expiresAt: String,
    val payload: RulePayload,
    /** Base64-encoded Ed25519 signature of the canonical bundle content (Stage 4).
     * Null for unsigned bundles (backward compatible with HTTPS-only authentication). */
    val signature: String? = null,
) {
    @Serializable
    data class RulePayload(val rules: List<Rule>)

    @Serializable
    data class Rule(
        val ruleId: String,
        val host: String,
        val action: String,
        val matchType: String,
        val category: String = "",
    )

    /** Exact-host lookup used by the engine for authorization decisions. */
    fun exactMatch(canonicalHost: String): Rule? =
        payload.rules.firstOrNull { it.host == canonicalHost && it.matchType == "exact" }

    companion object {
        /** Parse a rule bundle from raw JSON using the strict bundle parser. */
        fun fromJson(raw: String): RuleBundle = BundleJson.decodeFromString(serializer(), raw)
    }
}

internal val BundleJson = Json {
    ignoreUnknownKeys = true   // Backend may include extra fields (source, evidenceExpires) — accept gracefully
    isLenient = false
    coerceInputValues = false
    explicitNulls = false
}
