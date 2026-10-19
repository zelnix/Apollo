package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Unit tests for LiveReputationStore — the in-memory cache of live reputation verdicts.
 */
class LiveReputationStoreTest {

    private fun verdict(
        hostname: String,
        verdict: String = "clean",
        confidence: String = "medium",
        expiresAt: Long = System.currentTimeMillis() + 300_000,
    ) = LiveReputationStore.CachedVerdict(
        hostname = hostname,
        verdict = verdict,
        confidence = confidence,
        source = "test",
        checkedAt = System.currentTimeMillis(),
        expiresAt = expiresAt,
        inActiveBundleAtCheck = false,
        investigationComplete = true,
    )

    @Test fun getReturnsCachedEntry() {
        val store = LiveReputationStore()
        val entry = verdict("example.com")
        store.put(entry)
        val result = store.get("example.com")
        assertNotNull(result)
        assertEquals("example.com", result.hostname)
        assertEquals("clean", result.verdict)
    }

    @Test fun getReturnsNullForMissingEntry() {
        val store = LiveReputationStore()
        assertNull(store.get("nonexistent.com"))
    }

    @Test fun getReturnsNullForExpiredEntry() {
        val store = LiveReputationStore()
        val expired = verdict("expired.com", expiresAt = System.currentTimeMillis() - 1)
        store.put(expired)
        assertNull(store.get("expired.com"))
    }

    @Test fun putOverwritesExistingEntry() {
        val store = LiveReputationStore()
        store.put(verdict("example.com", verdict = "clean"))
        store.put(verdict("example.com", verdict = "malicious"))
        val result = store.get("example.com")
        assertNotNull(result)
        assertEquals("malicious", result.verdict)
    }

    @Test fun invalidateRemovesEntry() {
        val store = LiveReputationStore()
        store.put(verdict("example.com"))
        store.invalidate("example.com")
        assertNull(store.get("example.com"))
    }

    @Test fun clearRemovesAllEntries() {
        val store = LiveReputationStore()
        store.put(verdict("a.com"))
        store.put(verdict("b.com"))
        store.put(verdict("c.com"))
        assertEquals(3, store.size())
        store.clear()
        assertEquals(0, store.size())
    }

    @Test fun evictionTriggersWhenMaxEntriesReached() {
        val store = LiveReputationStore(maxEntries = 10)
        for (i in 1..10) {
            store.put(verdict("host$i.com"))
        }
        assertEquals(10, store.size())
        // Adding one more should trigger eviction of the oldest 10%
        store.put(verdict("host11.com"))
        // After eviction of 1 (10% of 10), adding 1 new = 10 total
        assertEquals(10, store.size())
        // The newest entry should still be there
        assertNotNull(store.get("host11.com"))
    }

    @Test fun sizeReflectsCurrentEntries() {
        val store = LiveReputationStore()
        assertEquals(0, store.size())
        store.put(verdict("a.com"))
        assertEquals(1, store.size())
        store.put(verdict("b.com"))
        assertEquals(2, store.size())
    }
}
