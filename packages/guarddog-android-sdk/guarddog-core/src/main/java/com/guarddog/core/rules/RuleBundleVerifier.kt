package com.guarddog.core.rules

import com.guarddog.core.clock.Clock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.erdtman.jcs.JsonCanonicalizer
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Base64

enum class RejectReason {
    SCHEMA_INVALID, PAYLOAD_HASH_MISMATCH, UNKNOWN_KEY, SIGNATURE_INVALID, NOT_YET_VALID, EXPIRED, ROLLBACK
}

sealed class VerificationResult {
    data class Accepted(val bundle: SignedRuleBundle) : VerificationResult()
    data class Rejected(val reason: RejectReason, val detail: String? = null) : VerificationResult()
}

/**
 * Independent verification of a signed rule bundle on device.
 *
 * Order (identical on Python/Swift): schema -> payloadHash -> keyId known -> Ed25519
 * signature over JCS(unsigned envelope) -> issuedAt/expiresAt (injected clock) -> rollback.
 *
 * Canonicalization uses erdtman/java-json-canonicalization (RFC 8785 reference by the
 * RFC author) - never hand-rolled. Byte identity is proven against
 * security/test-vectors/jcs/canonical_bytes.hex in RuleBundleVerifierTest.
 */
class RuleBundleVerifier(
    private val keys: TrustedKeyRegistry,
    private val versionStore: BundleVersionStore,
    private val clock: Clock,
) {
    private val idRegex = Regex("^[a-z0-9-]+$")
    private val ruleIdRegex = Regex("^[A-Za-z0-9._:-]+$")
    private val hexRegex = Regex("^[0-9a-f]{64}$")
    private val isoZ = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$")
    private val integerLiteral = Regex("^(0|[1-9][0-9]*)$")

    fun verify(rawJson: String, rollbackProtected: Boolean = true): VerificationResult {
        val root: JsonObject
        val bundle: SignedRuleBundle
        try {
            root = StrictJson.parseToJsonElement(rawJson).jsonObject
            bundle = StrictJson.decodeFromJsonElement(SignedRuleBundle.serializer(), root)
        } catch (e: SerializationException) {
            return VerificationResult.Rejected(RejectReason.SCHEMA_INVALID, e.message)
        } catch (e: IllegalArgumentException) {
            return VerificationResult.Rejected(RejectReason.SCHEMA_INVALID, e.message)
        }
        schemaProblem(bundle, root)?.let { return VerificationResult.Rejected(RejectReason.SCHEMA_INVALID, it) }

        val payloadCanonical = canonical(root.getValue("payload").toString())
        if (sha256Hex(payloadCanonical) != bundle.payloadHash) {
            return VerificationResult.Rejected(RejectReason.PAYLOAD_HASH_MISMATCH)
        }

        val publicKey = keys.publicKeyFor(bundle.keyId)
            ?: return VerificationResult.Rejected(RejectReason.UNKNOWN_KEY, bundle.keyId)

        val unsigned = JsonObject(root.filterKeys { it != "signature" })
        val message = canonical(unsigned.toString())
        if (!verifyEd25519(publicKey, message, bundle.signature)) {
            return VerificationResult.Rejected(RejectReason.SIGNATURE_INVALID)
        }

        val now = Instant.ofEpochMilli(clock.nowEpochMillis())
        val issued = parseInstant(bundle.issuedAt) ?: return VerificationResult.Rejected(RejectReason.SCHEMA_INVALID, "issuedAt")
        val expires = parseInstant(bundle.expiresAt) ?: return VerificationResult.Rejected(RejectReason.SCHEMA_INVALID, "expiresAt")
        if (issued.isAfter(now)) return VerificationResult.Rejected(RejectReason.NOT_YET_VALID)
        if (!expires.isAfter(now)) return VerificationResult.Rejected(RejectReason.EXPIRED)

        if (rollbackProtected) {
            val highest = versionStore.highestAccepted(bundle.rulesetId)
            if (highest != null && bundle.bundleVersion <= highest) {
                return VerificationResult.Rejected(RejectReason.ROLLBACK, "highest accepted $highest")
            }
            versionStore.recordAccepted(bundle.rulesetId, bundle.bundleVersion)
        }
        return VerificationResult.Accepted(bundle)
    }

    /** Strict JSON types: kotlinx decodes quoted numbers leniently, so the raw tree is checked too ("3" and 3.0 are invalid). */
    private fun typeProblem(root: JsonObject): String? {
        fun isString(e: JsonElement?) = e is JsonPrimitive && e.isString
        for (key in listOf("schemaVersion", "rulesetId", "issuedAt", "expiresAt", "keyId", "payloadHash", "signature")) {
            if (!isString(root[key])) return "$key must be a string"
        }
        val version = root["bundleVersion"]
        if (version !is JsonPrimitive || version.isString || !integerLiteral.matches(version.content)) return "bundleVersion must be an integer literal"
        val payload = root["payload"] as? JsonObject ?: return "payload must be an object"
        if (payload.keys != setOf("rules")) return "unexpected payload keys"
        val rules = payload["rules"] as? JsonArray ?: return "rules must be an array"
        val ruleKeys = setOf("ruleId", "host", "action", "matchType", "category")
        for (rule in rules) {
            val obj = rule as? JsonObject ?: return "rule must be an object"
            if (!ruleKeys.containsAll(obj.keys)) return "unexpected rule keys"
            if (obj.values.any { !isString(it) }) return "rule fields must be strings"
        }
        return null
    }

    private fun schemaProblem(b: SignedRuleBundle, root: JsonObject): String? {
        val allowed = setOf("schemaVersion", "rulesetId", "bundleVersion", "issuedAt", "expiresAt", "keyId", "payload", "payloadHash", "signature")
        if (!allowed.containsAll(root.keys)) return "unexpected envelope keys"
        typeProblem(root)?.let { return it }
        if (b.schemaVersion != "1.0") return "schemaVersion"
        if (!idRegex.matches(b.rulesetId)) return "rulesetId"
        if (b.bundleVersion < 1) return "bundleVersion"
        if (!isoZ.matches(b.issuedAt) || !isoZ.matches(b.expiresAt)) return "timestamps"
        if (!idRegex.matches(b.keyId)) return "keyId"
        if (!hexRegex.matches(b.payloadHash)) return "payloadHash"
        if (b.signature.length != 88) return "signature length"
        if (b.payload.rules.isEmpty()) return "empty rules"
        for (r in b.payload.rules) {
            if (!ruleIdRegex.matches(r.ruleId)) return "ruleId"
            if (r.host.isEmpty()) return "host"
            if (r.action != "block" && r.action != "allow") return "action"
            if (r.matchType != "exact") return "matchType"
            if (r.category.isEmpty()) return "category"
        }
        return null
    }

    private fun parseInstant(v: String): Instant? = try { Instant.parse(v) } catch (e: DateTimeParseException) { null }

    companion object {
        fun canonical(json: String): ByteArray = JsonCanonicalizer(json).encodedUTF8

        fun sha256Hex(data: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

        fun verifyEd25519(publicKey: ByteArray, message: ByteArray, signatureB64: String): Boolean {
            val signature = try { Base64.getDecoder().decode(signatureB64) } catch (e: IllegalArgumentException) { return false }
            if (signature.size != 64) return false
            val verifier = Ed25519Signer()
            verifier.init(false, Ed25519PublicKeyParameters(publicKey, 0))
            verifier.update(message, 0, message.size)
            return verifier.verifySignature(signature)
        }
    }
}
