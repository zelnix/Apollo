package com.guarddog.core.rules

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/**
 * Builds Threat Domain Lists for tests, signed with a throwaway Ed25519 key generated per test run
 * (never a real signing key). Entries are real-shaped; nothing here pads a list with placeholders.
 */
class ThreatDomainListTestKit {
    private val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()

    /** Raw 32-byte public key, base64 — the last 32 bytes of the X.509 SubjectPublicKeyInfo. */
    val publicKeyB64: String = Base64.getEncoder().encodeToString(keyPair.public.encoded.takeLast(32).toByteArray())

    fun entry(ruleId: String, host: String, action: String = "block", matchType: String = "exact"): JsonObject = JsonObject(
        mapOf(
            "ruleId" to JsonPrimitive(ruleId), "host" to JsonPrimitive(host), "action" to JsonPrimitive(action),
            "matchType" to JsonPrimitive(matchType), "category" to JsonPrimitive("threat-intelligence"),
        ),
    )

    fun content(
        entries: List<JsonObject>,
        bundleVersion: Long = 5,
        issuedAt: String = "2026-06-01T05:00:00Z",
        expiresAt: String = "2028-06-01T05:00:00Z",
        rulesetId: String = "apollo-rules-v1",
    ): JsonObject = JsonObject(
        mapOf(
            "schemaVersion" to JsonPrimitive("2.0"), "rulesetId" to JsonPrimitive(rulesetId),
            "bundleVersion" to JsonPrimitive(bundleVersion), "issuedAt" to JsonPrimitive(issuedAt),
            "expiresAt" to JsonPrimitive(expiresAt), "payload" to JsonObject(mapOf("rules" to JsonArray(entries))),
        ),
    )

    /** The content with its Ed25519 signature attached, exactly as the backend serves it. */
    fun signed(content: JsonObject): String {
        val signer = Signature.getInstance("Ed25519")
        signer.initSign(keyPair.private)
        signer.update(Ed25519BundleVerifier.canonicalizeJson(content))
        val signature = Base64.getEncoder().encodeToString(signer.sign())
        return JsonObject(content + ("signature" to JsonPrimitive(signature))).toString()
    }

    fun unsigned(content: JsonObject): String = content.toString()
}
