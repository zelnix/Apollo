package com.guarddog.core.rules

import com.guarddog.core.clock.FixedClock
import java.io.File
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
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

    private val ruleset = "gd-m1-controlled-block"
    private fun envelopeHashOf(path: String): String {
        val root = StrictJson.parseToJsonElement(read(path)).jsonObject
        return RuleBundleVerifier.sha256Hex(RuleBundleVerifier.canonical(JsonObject(root.filterKeys { it != "signature" }).toString()))
    }

    /** Physical M1 finding: after v25 had been recorded, the SAME authentic v25 came back as ROLLBACK on every later verification. */
    @Test fun sameTrustedBundleIsAcceptedIdempotentlyAcrossRestarts() {
        val store = InMemoryBundleVersionStore()
        // 1. first acceptance records version + envelope identity
        assertIs<VerificationResult.Accepted>(verifier(store).verify(read("signing/valid_bundle.json")))
        assertEquals(AcceptedBundle(3L, envelopeHashOf("signing/valid_bundle.json")), store.highestAccepted(ruleset))
        // 2. "restart": a new verifier over the persisted state re-verifies the exact same bundle -> accepted, state unchanged
        val afterRestart = verifier(store)
        assertIs<VerificationResult.Accepted>(afterRestart.verify(read("signing/valid_bundle.json")))
        assertIs<VerificationResult.Accepted>(afterRestart.verify(read("signing/valid_bundle.json")))
        assertEquals(AcceptedBundle(3L, envelopeHashOf("signing/valid_bundle.json")), store.highestAccepted(ruleset))
        // 3. an older validly signed bundle is still a rollback
        assertRejected("signing/rollback_bundle.json", RejectReason.ROLLBACK, afterRestart)
        assertEquals(3L, store.highestAccepted(ruleset)?.bundleVersion)
    }

    /** 4. Same version, different authenticated signed envelope -> VERSION_CONFLICT (never silently replaced, never called a rollback). */
    @Test fun sameVersionWithDifferentEnvelopeIdentityIsAConflict() {
        val store = InMemoryBundleVersionStore()
        val otherIdentity = "0".repeat(64)
        store.recordAccepted(ruleset, 3L, otherIdentity)
        assertRejected("signing/valid_bundle.json", RejectReason.VERSION_CONFLICT, verifier(store))
        assertEquals(AcceptedBundle(3L, otherIdentity), store.highestAccepted(ruleset)) // rejected bundle never touches the record
    }

    /** Legacy rollback record (version only, written before identity was persisted — the state on the proof phone). */
    @Test fun legacyVersionOnlyRecordAcceptsSameVersionAndPinsIdentity() {
        val store = InMemoryBundleVersionStore()
        store.recordAccepted(ruleset, 3L, null)
        assertEquals(AcceptedBundle(3L, null), store.highestAccepted(ruleset))
        assertIs<VerificationResult.Accepted>(verifier(store).verify(read("signing/valid_bundle.json")))
        assertEquals(AcceptedBundle(3L, envelopeHashOf("signing/valid_bundle.json")), store.highestAccepted(ruleset))
        // once pinned, a different same-version envelope is a conflict and cannot re-pin
        store.recordAccepted(ruleset, 3L, "f".repeat(64))
        assertEquals(envelopeHashOf("signing/valid_bundle.json"), store.highestAccepted(ruleset)?.envelopeHash)
    }

    /** 7. Rejected fixtures never advance rollback state. */
    @Test fun rejectedBundlesNeverAdvanceRollbackState() {
        val store = InMemoryBundleVersionStore()
        val v = verifier(store)
        assertRejected("signing/tampered_payload_bundle.json", RejectReason.PAYLOAD_HASH_MISMATCH, v)
        assertRejected("signing/unknown_key_bundle.json", RejectReason.UNKNOWN_KEY, v)
        assertRejected("signing/expired_bundle.json", RejectReason.EXPIRED, v)
        assertRejected("jcs/invalid_signature_bundle.json", RejectReason.SIGNATURE_INVALID, v)
        assertEquals(null, store.highestAccepted(ruleset))
        assertIs<VerificationResult.Accepted>(v.verify(read("signing/valid_bundle.json")))
        assertRejected("signing/rollback_bundle.json", RejectReason.ROLLBACK, v)
        assertEquals(AcceptedBundle(3L, envelopeHashOf("signing/valid_bundle.json")), store.highestAccepted(ruleset))
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
