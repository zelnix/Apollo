package com.guarddog.core.rules

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Strict envelope models. Mirrors backend/app/domain/models/rule_bundle.py. */
@Serializable
data class RuleEntry(
    val ruleId: String,
    val host: String,
    val action: String,
    val matchType: String = "exact",
    val category: String = "uncategorized",
)

@Serializable
data class RulePayload(val rules: List<RuleEntry>)

@Serializable
data class SignedRuleBundle(
    val schemaVersion: String,
    val rulesetId: String,
    val bundleVersion: Long,
    val issuedAt: String,
    val expiresAt: String,
    val keyId: String,
    val payload: RulePayload,
    val payloadHash: String,
    val signature: String,
) {
    fun exactMatch(canonicalHost: String): RuleEntry? =
        payload.rules.firstOrNull { it.matchType == "exact" && it.host == canonicalHost }
}

/** Strict JSON: unknown keys rejected, no lenient coercion ("3" is not a Long, 3.0 is not a Long). */
val StrictJson: Json = Json {
    ignoreUnknownKeys = false
    isLenient = false
    coerceInputValues = false
    explicitNulls = false
}
