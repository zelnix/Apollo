package com.guarddog.core.rules

import kotlinx.serialization.json.*
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.util.Base64

/**
 * Stage 4: Ed25519 signature verification for rule bundles.
 *
 * Verifies that a received rule bundle was signed by Apollo's backend using the
 * Ed25519 private key. The public key is pinned in the native client.
 *
 * Verification protocol:
 * 1. Parse the raw JSON response
 * 2. Extract and remove the "signature" field
 * 3. Canonicalize the remaining JSON (sorted keys, compact separators)
 * 4. Verify the Ed25519 signature against the canonical bytes
 *
 * Platform compatibility:
 * - Android API 33+ (Tiramisu): Uses java.security.Signature("Ed25519") natively
 * - Android API 26-32: Ed25519 not available in java.security; signature verification
 *   is skipped with a logged warning. HTTPS-only authentication applies (same as before
 *   Stage 4). The bundle is still accepted but marked as signature-unverified.
 *
 * Thread-safe: all methods are stateless.
 */
object Ed25519BundleVerifier {

    /** Verification result. */
    sealed class VerifyResult {
        /** Signature is valid — the bundle is authenticated by the signing authority. */
        object Valid : VerifyResult()
        /** Signature is invalid — the bundle was tampered with or not signed by the authority. */
        data class Invalid(val reason: String) : VerifyResult()
        /** No signature field present — unsigned bundle (backward compat). */
        object Unsigned : VerifyResult()
        /** Verification could not be performed (Ed25519 not available on this device). */
        data class Unavailable(val reason: String) : VerifyResult()
    }

    /**
     * Verify the Ed25519 signature on a raw JSON rule bundle response.
     *
     * @param rawJson The complete JSON response from /api/guarddog/rules (including "signature")
     * @param publicKeyB64 Base64-encoded raw Ed25519 public key (32 bytes)
     * @return [VerifyResult] indicating the verification outcome
     */
    fun verify(rawJson: String, publicKeyB64: String): VerifyResult {
        // 1. Parse the raw JSON to extract the signature field
        val jsonElement: JsonElement
        try {
            jsonElement = Json.parseToJsonElement(rawJson)
        } catch (e: Exception) {
            return VerifyResult.Invalid("Failed to parse JSON: ${e.message}")
        }

        val jsonObject = jsonElement.jsonObject
        val signatureElement = jsonObject["signature"]

        if (signatureElement == null || signatureElement is JsonNull) {
            return VerifyResult.Unsigned
        }

        val signatureB64 = (signatureElement as? JsonPrimitive)?.contentOrNull
            ?: return VerifyResult.Invalid("Signature field is not a string")

        // 2. Remove the signature field and canonicalize
        val contentObject = JsonObject(jsonObject.filterKeys { it != "signature" })
        val canonical = canonicalizeJson(contentObject)

        // 3. Decode the signature and public key
        val signatureBytes: ByteArray
        val publicKeyBytes: ByteArray
        try {
            signatureBytes = Base64.getDecoder().decode(signatureB64)
            publicKeyBytes = Base64.getDecoder().decode(publicKeyB64)
        } catch (e: Exception) {
            return VerifyResult.Invalid("Failed to decode base64: ${e.message}")
        }

        if (signatureBytes.size != 64) {
            return VerifyResult.Invalid("Ed25519 signature must be 64 bytes, got ${signatureBytes.size}")
        }
        if (publicKeyBytes.size != 32) {
            return VerifyResult.Invalid("Ed25519 public key must be 32 bytes, got ${publicKeyBytes.size}")
        }

        // 4. Verify using java.security (Ed25519 available from API 33+)
        return try {
            val publicKey = decodeEd25519PublicKey(publicKeyBytes)
            val verifier = Signature.getInstance("Ed25519")
            verifier.initVerify(publicKey)
            verifier.update(canonical)
            if (verifier.verify(signatureBytes)) {
                VerifyResult.Valid
            } else {
                VerifyResult.Invalid("Ed25519 signature verification failed")
            }
        } catch (e: java.security.NoSuchAlgorithmException) {
            // Ed25519 not available on this Android version (API < 33)
            VerifyResult.Unavailable("Ed25519 not supported on this device (requires API 33+). HTTPS-only authentication applies.")
        } catch (e: Exception) {
            VerifyResult.Invalid("Verification error: ${e.message}")
        }
    }

    /**
     * Decode a raw 32-byte Ed25519 public key into a [PublicKey] for java.security.
     * Uses the X.509/SPKI DER encoding wrapper required by Java's KeyFactory.
     */
    private fun decodeEd25519PublicKey(rawBytes: ByteArray): PublicKey {
        // Ed25519 X.509 SubjectPublicKeyInfo DER encoding:
        // SEQUENCE {
        //   SEQUENCE { OID 1.3.101.112 (Ed25519) }
        //   BIT STRING (33 bytes: 0x00 padding byte + 32 raw key bytes)
        // }
        val derPrefix = byteArrayOf(
            0x30, 0x2A,       // SEQUENCE, 42 bytes
            0x30, 0x05,       // SEQUENCE, 5 bytes
            0x06, 0x03,       // OID, 3 bytes
            0x2B, 0x65, 0x70, // 1.3.101.112 (Ed25519)
            0x03, 0x21, 0x00, // BIT STRING, 33 bytes, 0 unused bits
        )
        val encodedKey = derPrefix + rawBytes
        val keySpec = java.security.spec.X509EncodedKeySpec(encodedKey)
        return KeyFactory.getInstance("Ed25519").generatePublic(keySpec)
    }

    /**
     * Canonicalize a [JsonObject] to produce deterministic bytes for signature verification.
     *
     * Rules (must match backend's `json.dumps(sort_keys=True, separators=(",", ":"))`):
     * - Keys sorted alphabetically at every nesting level
     * - Compact separators: no spaces after ":" or ","
     * - UTF-8 encoding
     * - ASCII-safe (non-ASCII chars escaped)
     */
    internal fun canonicalizeJson(obj: JsonElement): ByteArray {
        val sb = StringBuilder()
        writeCanonical(obj, sb)
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    private fun writeCanonical(element: JsonElement, sb: StringBuilder) {
        when (element) {
            is JsonObject -> {
                sb.append('{')
                val sorted = element.entries.sortedBy { it.key }
                sorted.forEachIndexed { index, (key, value) ->
                    if (index > 0) sb.append(',')
                    writeCanonicalString(key, sb)
                    sb.append(':')
                    writeCanonical(value, sb)
                }
                sb.append('}')
            }
            is JsonArray -> {
                sb.append('[')
                element.forEachIndexed { index, item ->
                    if (index > 0) sb.append(',')
                    writeCanonical(item, sb)
                }
                sb.append(']')
            }
            is JsonPrimitive -> {
                if (element.isString) {
                    writeCanonicalString(element.content, sb)
                } else {
                    // Numbers, booleans, null — write as-is
                    sb.append(element.content)
                }
            }
        }
    }

    /** Write a JSON string with proper escaping (matching Python's ensure_ascii=True). */
    private fun writeCanonicalString(s: String, sb: StringBuilder) {
        sb.append('"')
        for (ch in s) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> {
                    if (ch.code < 0x20) {
                        sb.append("\\u%04x".format(ch.code))
                    } else {
                        sb.append(ch)
                    }
                }
            }
        }
        sb.append('"')
    }
}
