package com.guarddog.core.rules

import com.guarddog.core.clock.FixedClock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Threat Domain List validation. A list with zero Threat Domain Entries is valid (no dangerous domains
 * are listed right now); every other check — signature, format, dates, rollback, version conflict and
 * each entry's shape — applies to it exactly as it does to a populated list.
 */
class RuleBundleValidatorTest {
    private val kit = ThreatDomainListTestKit()
    private val clock = FixedClock(Instant.parse("2026-07-01T00:00:00Z").toEpochMilli())
    private fun validator(store: BundleVersionStore = InMemoryBundleVersionStore()) = RuleBundleValidator(store, clock, kit.publicKeyB64)
    private val populated = listOf(kit.entry("ti-1", "bad-one.example"), kit.entry("ti-2", "bad-two.example"))

    private fun rejected(result: ValidationResult): RejectionReason = assertIs<ValidationResult.Rejected>(result).reason

    @Test fun zeroEntryListIsAcceptedAndSignatureVerified() {
        val accepted = assertIs<ValidationResult.Accepted>(validator().validate(kit.signed(kit.content(emptyList()))))
        assertTrue(accepted.signatureVerified)
        assertEquals(0, accepted.bundle.payload.rules.size)
        assertNull(accepted.bundle.exactMatch("anything.example"))
    }

    @Test fun zeroEntryListIsRecordedForRollbackProtection() {
        val store = InMemoryBundleVersionStore()
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 5))))
        assertEquals(5, assertNotNull(store.highestAccepted("apollo-rules-v1")).bundleVersion)
    }

    @Test fun populatedListIsAccepted() {
        val accepted = assertIs<ValidationResult.Accepted>(validator().validate(kit.signed(kit.content(populated))))
        assertTrue(accepted.signatureVerified)
        assertEquals(2, accepted.bundle.payload.rules.size)
        assertEquals("ti-2", accepted.bundle.exactMatch("bad-two.example")?.ruleId)
    }

    @Test fun invalidSignatureIsRejected() {
        val raw = kit.signed(kit.content(emptyList()))
        // Content changed after signing: a forged entry added to a signed zero-entry list.
        val tampered = raw.replace("\"rules\":[]", "\"rules\":[${kit.entry("ti-9", "forged.example")}]")
        assertEquals(RejectionReason.SIGNATURE_INVALID, rejected(validator().validate(tampered)))
        // Signed by a different key.
        assertEquals(RejectionReason.SIGNATURE_INVALID, rejected(validator().validate(ThreatDomainListTestKit().signed(kit.content(populated)))))
    }

    @Test fun missingSignatureIsRejected() {
        assertEquals(RejectionReason.SIGNATURE_MISSING, rejected(validator().validate(kit.unsigned(kit.content(emptyList())))))
        assertEquals(RejectionReason.SIGNATURE_MISSING, rejected(validator().validate(kit.unsigned(kit.content(populated)))))
    }

    @Test fun expiredListIsRejected() {
        val expired = kit.content(emptyList(), issuedAt = "2026-01-01T00:00:00Z", expiresAt = "2026-06-30T00:00:00Z")
        assertEquals(RejectionReason.EXPIRED, rejected(validator().validate(kit.signed(expired))))
        val expiresNow = kit.content(populated, expiresAt = "2026-07-01T00:00:00Z")
        assertEquals(RejectionReason.EXPIRED, rejected(validator().validate(kit.signed(expiresNow))))
    }

    @Test fun futureDatedListIsRejected() {
        val future = kit.content(emptyList(), issuedAt = "2026-07-02T00:00:00Z")
        assertEquals(RejectionReason.NOT_YET_VALID, rejected(validator().validate(kit.signed(future))))
    }

    @Test fun rollbackIsRejected() {
        val store = InMemoryBundleVersionStore()
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(populated, bundleVersion = 7))))
        assertEquals(RejectionReason.ROLLBACK, rejected(validator(store).validate(kit.signed(kit.content(populated, bundleVersion = 6)))))
        // A zero-entry list never gets round rollback protection.
        assertEquals(RejectionReason.ROLLBACK, rejected(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 6)))))
    }

    @Test fun versionConflictIsRejected() {
        val store = InMemoryBundleVersionStore()
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 8))))
        // The same version again is accepted (an unchanged refresh) …
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 8))))
        // … but the same version with different entries is a conflict.
        assertEquals(RejectionReason.VERSION_CONFLICT, rejected(validator(store).validate(kit.signed(kit.content(populated, bundleVersion = 8)))))
    }

    @Test fun malformedEntryIsRejected() {
        val malformed = listOf(
            kit.entry("ti-1", ""),
            kit.entry("", "bad.example"),
            kit.entry("ti-1", "bad.example", action = "quarantine"),
            kit.entry("ti-1", "bad.example", matchType = "suffix"),
        )
        for (entry in malformed) {
            assertEquals(RejectionReason.INVALID_RULE, rejected(validator().validate(kit.signed(kit.content(populated + entry)))), entry.toString())
        }
        // An entry missing a required field can't be read at all.
        val noHost = JsonObject(kit.entry("ti-3", "bad.example").filterKeys { it != "host" })
        assertEquals(RejectionReason.INVALID_JSON, rejected(validator().validate(kit.signed(kit.content(listOf(noHost))))))
    }

    @Test fun malformedListIsRejected() {
        assertEquals(RejectionReason.INVALID_JSON, rejected(RuleBundleValidator(InMemoryBundleVersionStore(), clock).validate("{\"schemaVersion\":\"2.0\"")))
        val wrongSchema = JsonObject(kit.content(emptyList()) + ("schemaVersion" to JsonPrimitive("1.0")))
        assertEquals(RejectionReason.INVALID_SCHEMA, rejected(validator().validate(kit.signed(wrongSchema))))
    }

    @Test fun entriesCanGoFromNoneToSomeAndBackToNone() {
        val store = InMemoryBundleVersionStore()
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 3))))
        assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(populated, bundleVersion = 4))))
        val cleared = assertIs<ValidationResult.Accepted>(validator(store).validate(kit.signed(kit.content(emptyList(), bundleVersion = 5))))
        assertEquals(0, cleared.bundle.payload.rules.size)
    }

    @Test fun noRejectionReasonTreatsZeroEntriesAsAFault() {
        assertTrue(RejectionReason.entries.none { it.name.contains("EMPTY") })
    }
}
