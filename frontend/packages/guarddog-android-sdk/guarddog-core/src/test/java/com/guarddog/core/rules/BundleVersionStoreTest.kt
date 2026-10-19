package com.guarddog.core.rules

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BundleVersionStoreTest {
    private val h1 = "1".repeat(64)
    private val h2 = "2".repeat(64)

    @Test fun recordsHighestVersionPerRulesetAndNeverRegresses() {
        val store = InMemoryBundleVersionStore()
        assertNull(store.highestAccepted("a"))
        store.recordAccepted("a", 3, h1)
        store.recordAccepted("a", 1, h2) // lower version ignored
        store.recordAccepted("b", 7, h2)
        assertEquals(AcceptedBundle(3, h1), store.highestAccepted("a"))
        assertEquals(AcceptedBundle(7, h2), store.highestAccepted("b"))
    }

    @Test fun equalVersionOnlyPinsAMissingIdentity() {
        val store = InMemoryBundleVersionStore()
        store.recordAccepted("a", 25, null)            // legacy record (version only)
        store.recordAccepted("a", 25, h1)              // identity pinned in place
        store.recordAccepted("a", 25, h2)              // a different identity can never overwrite the pinned one
        assertEquals(AcceptedBundle(25, h1), store.highestAccepted("a"))
        store.recordAccepted("a", 26, h2)              // higher version replaces the record entirely
        assertEquals(AcceptedBundle(26, h2), store.highestAccepted("a"))
    }
}
