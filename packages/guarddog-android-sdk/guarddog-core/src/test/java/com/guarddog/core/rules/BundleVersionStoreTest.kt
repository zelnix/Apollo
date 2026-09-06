package com.guarddog.core.rules

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BundleVersionStoreTest {
    @Test fun recordsHighestVersionPerRuleset() {
        val store = InMemoryBundleVersionStore()
        assertNull(store.highestAccepted("a"))
        store.recordAccepted("a", 3)
        store.recordAccepted("a", 1) // never regresses
        store.recordAccepted("b", 7)
        assertEquals(3L, store.highestAccepted("a"))
        assertEquals(7L, store.highestAccepted("b"))
    }
}
