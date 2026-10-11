package com.guarddog.vpn

import java.util.concurrent.ConcurrentHashMap

/**
 * In-memory LRU cache of live reputation verdicts for hostnames.
 *
 * Protection Before Speed principle: this cache enables the DNS handler to
 * make immediate decisions for recently-checked hostnames without another
 * network round-trip. Unknown hostnames trigger a bounded live check.
 *
 * Entries automatically expire after their validity period.
 * Thread-safe for concurrent access from the VPN packet loop and background checker.
 */
class LiveReputationStore(private val maxEntries: Int = 2000) {

    data class CachedVerdict(
        val hostname: String,
        val verdict: String,         // "malicious", "clean", "unknown", "unavailable"
        val confidence: String,      // "high", "medium", "low", "none"
        val source: String,
        val checkedAt: Long,         // System.currentTimeMillis()
        val expiresAt: Long,         // When this entry should be re-checked
        val inActiveBundleAtCheck: Boolean,
        val investigationComplete: Boolean,
    )

    private val cache = ConcurrentHashMap<String, CachedVerdict>()

    /** Get a cached verdict if present and not expired. */
    fun get(hostname: String): CachedVerdict? {
        val entry = cache[hostname] ?: return null
        if (System.currentTimeMillis() > entry.expiresAt) {
            cache.remove(hostname)
            return null
        }
        return entry
    }

    /** Store a verdict. Evicts oldest entries if cache is full. */
    fun put(verdict: CachedVerdict) {
        // Simple eviction: if full, remove oldest 10%
        if (cache.size >= maxEntries) {
            val toRemove = cache.entries
                .sortedBy { it.value.checkedAt }
                .take(maxEntries / 10)
            toRemove.forEach { cache.remove(it.key) }
        }
        cache[verdict.hostname] = verdict
    }

    /** Remove a specific entry (e.g., when a rule bundle update changes its status). */
    fun invalidate(hostname: String) { cache.remove(hostname) }

    /** Clear all entries. */
    fun clear() { cache.clear() }

    /** Number of cached entries. */
    fun size(): Int = cache.size
}
