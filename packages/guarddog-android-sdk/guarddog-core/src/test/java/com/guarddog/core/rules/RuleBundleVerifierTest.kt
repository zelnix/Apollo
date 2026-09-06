package com.guarddog.core.rules

import com.guarddog.core.clock.FixedClock
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Cross-language parity: consumes security/test-vectors exactly like the Python and Swift suites.
 * Frozen clock 2026-06-15T00:00:00Z; baseline registry = key 001 only.
 * NOTE: code-review ready / not runtime-verified in this environment (no Android toolchain).
 */
class RuleBundleVerifierTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")
    private val frozen = FixedClock(Instant.parse("2026-06-15T00:00:00Z").toEpochMilli())
    private fun read(path: String) = File(vectors, path).readText()
    private fun verifier(store: BundleVersionStore = InMemoryBundleVersionStore(), keys: TrustedKeyRegistry = TrustedKeyRegistry.m1Default()) =
        RuleBundleVerifier(keys, store, frozen)

    @Test fun canonicalBytesMatchReferenceFixture() {
        val expected = read("jcs/canonical_bytes.hex").trim()
        val actual = RuleBundleVerifier.canonical(read("jcs/unsigned_envelope.json")).joinToString("") { "%02x".format(it) }
        assertEquals(expected, actual)
    }

    @Test fun validBundleAccepted() {
        val result = verifier().verify(read("signing/valid_bundle.json"))
        assertIs<VerificationResult.Accepted>(result)
        assertEquals(3L, result.bundle.bundleVersion)
        assertEquals("block", result.bundle.exactMatch("m1-block-test.guarddog.example")?.action)
    }

    private fun assertRejected(path: String, reason: RejectReason, v: RuleBundleVerifier = verifier()) {
        val result = v.verify(read(path))
        assertIs<VerificationResult.Rejected>(result, path)
        assertEquals(reason, result.reason, path)
    }

    @Test fun manifestRejections() {
        assertRejected("jcs/invalid_signature_bundle.json", RejectReason.SIGNATURE_INVALID)
        assertRejected("jcs/modified_payload_bundle.json", RejectReason.SIGNATURE_INVALID)
        assertRejected("jcs/modified_expiry_bundle.json", RejectReason.SIGNATURE_INVALID)
        assertRejected("jcs/modified_bundle_version_bundle.json", RejectReason.SIGNATURE_INVALID)
        assertRejected("jcs/modified_ruleset_id_bundle.json", RejectReason.SIGNATURE_INVALID)
        assertRejected("jcs/modified_key_id_bundle.json", RejectReason.UNKNOWN_KEY)
        assertRejected("jcs/invalid_payload_hash_bundle.json", RejectReason.PAYLOAD_HASH_MISMATCH)
        assertRejected("signing/tampered_payload_bundle.json", RejectReason.PAYLOAD_HASH_MISMATCH)
        assertRejected("signing/expired_bundle.json", RejectReason.EXPIRED)
        assertRejected("signing/unknown_key_bundle.json", RejectReason.UNKNOWN_KEY)
    }

    @Test fun rollbackRejectedAfterNewerVersionAccepted() {
        val store = InMemoryBundleVersionStore()
        val v = verifier(store)
        assertIs<VerificationResult.Accepted>(v.verify(read("signing/valid_bundle.json")))
        assertEquals(3L, store.highestAccepted("gd-m1-controlled-block"))
        assertRejected("signing/rollback_bundle.json", RejectReason.ROLLBACK, v)
        assertRejected("signing/valid_bundle.json", RejectReason.ROLLBACK, v) // same version is a rollback too
    }

    @Test fun keyRolloverWithoutBridgeChanges() {
        val keys = TrustedKeyRegistry.m1Default()
        val v = verifier(keys = keys)
        assertRejected("signing/unknown_key_bundle.json", RejectReason.UNKNOWN_KEY, v)
        keys.trust("gd-m1-test-ed25519-002", "tjHUbcOwKuqnHFAMkoiurrgdJDbO7g6FXV7Y5nMwzSg=")
        assertIs<VerificationResult.Accepted>(v.verify(read("signing/unknown_key_bundle.json")))
        assertRejected("jcs/modified_key_id_bundle.json", RejectReason.SIGNATURE_INVALID, v)
        keys.retire(TrustedKeyRegistry.M1_TEST_KEY_ID)
        assertRejected("signing/valid_bundle.json", RejectReason.UNKNOWN_KEY, verifier(keys = keys))
    }

    @Test fun strictSchema() {
        val valid = read("signing/valid_bundle.json")
        fun reasonOf(json: String) = (verifier().verify(json) as VerificationResult.Rejected).reason
        assertEquals(RejectReason.SCHEMA_INVALID, reasonOf(valid.replaceFirst("\"schemaVersion\"", "\"extra\": 1, \"schemaVersion\"")))
        assertEquals(RejectReason.SCHEMA_INVALID, reasonOf(valid.replace("\"bundleVersion\": 3", "\"bundleVersion\": \"3\"")))
        assertEquals(RejectReason.SCHEMA_INVALID, reasonOf(valid.replace("\"bundleVersion\": 3", "\"bundleVersion\": 3.0")))
    }

    @Test fun serializerSymbolIsReal() {
        // Compile-check: SecurityEvent.serializer()/SignedRuleBundle.serializer() exist (no assumed generated names).
        assertTrue(SignedRuleBundle.serializer().descriptor.serialName.isNotEmpty())
        assertTrue(com.guarddog.core.events.SecurityEvent.serializer().descriptor.serialName.isNotEmpty())
    }
}
