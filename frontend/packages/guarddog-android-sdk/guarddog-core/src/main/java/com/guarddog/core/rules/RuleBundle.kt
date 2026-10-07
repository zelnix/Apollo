package com.guarddog.core.rules

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A validated rule bundle delivered over authenticated HTTPS.
 * No cryptographic signature fields — authentication is provided by TLS + baked-in backend URL.
 */
@Serializable
data class RuleBundle(
    val schemaVersion: String,
    val rulesetId: String,
    val bundleVersion: Long,
    val issuedAt: String,
    val expiresAt: String,
    val payload: RulePayload,
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
    ignoreUnknownKeys = false
    isLenient = false
    coerceInputValues = false
    explicitNulls = false
}
