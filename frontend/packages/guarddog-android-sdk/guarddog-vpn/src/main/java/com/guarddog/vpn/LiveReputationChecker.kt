package com.guarddog.vpn

import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.*

/**
 * Background live reputation checker — makes bounded HTTP calls to Apollo's
 * backend for DNS hostnames not in the local rule bundle.
 *
 * Protection Before Speed: The DNS handler calls [checkBounded] which waits
 * up to [holdTimeoutMs] for a verdict before falling through to forward.
 *
 * This checker:
 * - Uses a fixed thread pool to avoid thundering herd
 * - Caches results in [LiveReputationStore] for subsequent queries
 * - Limits concurrent outstanding checks via semaphore
 * - Fails open (returns null) on timeout or error
 * - Returns advisory verdicts — the calling DNS handler decides whether to
 *   block (NXDOMAIN) or forward based on the verdict
 */
class LiveReputationChecker(
    private val store: LiveReputationStore,
    private val backendBaseUrl: String,
    private val authToken: String? = null,
    private val holdTimeoutMs: Long = 3000,  // Protection Before Speed: 3 second hold
    private val maxConcurrent: Int = 4,
    private val cleanCacheDurationMs: Long = 5 * 60 * 1000,  // 5 min for clean results
    private val maliciousCacheDurationMs: Long = 60 * 1000,   // 1 min for malicious (re-check sooner)
    private val unknownCacheDurationMs: Long = 2 * 60 * 1000, // 2 min for unknown
    /** Hash prefix length in hex characters (4-16) sent to backend for privacy-preserving lookup. */
    private val hashPrefixLength: Int = 8,
) {
    private val executor = Executors.newFixedThreadPool(2)
    private val outstanding = ConcurrentHashMap<String, CompletableFuture<LiveReputationStore.CachedVerdict?>>()
    private val semaphore = Semaphore(maxConcurrent)

    /**
     * Bounded live reputation check. Blocks the calling thread for up to [holdTimeoutMs].
     *
     * Returns the verdict if completed within the timeout, or null if timed out / failed.
     * The DNS handler should:
     * - If "malicious" returned: synthesize NXDOMAIN to prevent access (Protection Before Speed)
     * - If "clean" returned: forward DNS normally
     * - If null (timeout/error): forward DNS, do NOT claim the site was checked
     */
    fun checkBounded(hostname: String): LiveReputationStore.CachedVerdict? {
        // Fast path: already cached
        val cached = store.get(hostname)
        if (cached != null) return cached

        // Deduplicate: if another thread is already checking this hostname, wait on the same future
        val future = outstanding.computeIfAbsent(hostname) { h ->
            CompletableFuture.supplyAsync({ performCheck(h) }, executor)
        }

        return try {
            future.get(holdTimeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            // Protection Before Speed: timeout exceeded, fail open
            // Do NOT claim the site was checked — the investigation is incomplete
            null
        } catch (e: Exception) {
            null
        } finally {
            outstanding.remove(hostname)
        }
    }

    /**
     * Fire-and-forget background check (doesn't block). Used for hostnames where
     * the DNS has already been forwarded but we still want to populate the cache.
     */
    fun checkAsync(hostname: String) {
        if (store.get(hostname) != null) return // Already cached
        if (outstanding.containsKey(hostname)) return // Already in progress
        outstanding.computeIfAbsent(hostname) { h ->
            CompletableFuture.supplyAsync({ performCheck(h) }, executor)
        }
    }

    private fun performCheck(hostname: String): LiveReputationStore.CachedVerdict? {
        if (!semaphore.tryAcquire(500, TimeUnit.MILLISECONDS)) return null
        try {
            val hashPrefix = computeHashPrefix(hostname)
            val url = URL("$backendBaseUrl/api/guarddog/dns-check")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            if (authToken != null) {
                conn.setRequestProperty("Authorization", "Bearer $authToken")
            }
            conn.connectTimeout = 2500
            conn.readTimeout = 2500
            conn.doOutput = true

            // Privacy Contract: send only the hash prefix for privacy-preserving lookup.
            val body = buildJsonBody(hostname, hashPrefix)
            conn.outputStream.use { it.write(body.toByteArray()) }

            if (conn.responseCode != 200) return null

            val response = conn.inputStream.bufferedReader().readText()
            return parseAndCache(hostname, response)
        } catch (e: Exception) {
            // Network failure — fail open, don't cache the failure as a verdict
            return null
        } finally {
            semaphore.release()
        }
    }

    /** Compute the first [hashPrefixLength] hex characters of SHA-256(lowercase hostname). */
    internal fun computeHashPrefix(hostname: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(hostname.lowercase().toByteArray(Charsets.UTF_8))
        val hex = hash.joinToString("") { "%02x".format(it) }
        return hex.take(hashPrefixLength.coerceIn(4, 16))
    }

    private fun buildJsonBody(hostname: String, hashPrefix: String): String {
        // Privacy Contract: transmit ONLY the hash prefix, never the full hostname.
        // The backend resolves intelligence from the prefix alone.
        return """{"hostname_hash_prefix":"$hashPrefix","request_context":"dns_observation"}"""
    }

    private fun parseAndCache(hostname: String, json: String): LiveReputationStore.CachedVerdict? {
        // Simple JSON parsing (no external library dependency in the SDK)
        val verdict = extractJsonString(json, "verdict") ?: return null
        val confidence = extractJsonString(json, "confidence") ?: "none"
        val source = extractJsonString(json, "source") ?: "none"
        val inBundle = json.contains("\"in_active_bundle\":true") || json.contains("\"in_active_bundle\": true")
        val complete = !json.contains("\"investigation_complete\":false") && !json.contains("\"investigation_complete\": false")

        val now = System.currentTimeMillis()
        val cacheDuration = when (verdict) {
            "malicious" -> maliciousCacheDurationMs
            "clean" -> cleanCacheDurationMs
            else -> unknownCacheDurationMs
        }

        val entry = LiveReputationStore.CachedVerdict(
            hostname = hostname,
            verdict = verdict,
            confidence = confidence,
            source = source,
            checkedAt = now,
            expiresAt = now + cacheDuration,
            inActiveBundleAtCheck = inBundle,
            investigationComplete = complete,
        )
        store.put(entry)
        return entry
    }

    private fun extractJsonString(json: String, key: String): String? {
        val pattern = "\"$key\"\\s*:\\s*\"([^\"]*)\""
        val match = Regex(pattern).find(json) ?: return null
        return match.groupValues[1]
    }

    fun shutdown() {
        executor.shutdownNow()
    }
}
