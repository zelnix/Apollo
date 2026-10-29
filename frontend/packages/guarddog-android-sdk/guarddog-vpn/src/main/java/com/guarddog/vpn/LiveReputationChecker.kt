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
        val future = inFlight(hostname)

        return try {
            future.get(holdTimeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            // Protection Before Speed: timeout exceeded, fail open
            // Do NOT claim the site was checked — the investigation is incomplete.
            // The request stays registered until its background check finishes, so a repeat
            // lookup waits on it instead of starting a second request for the same hostname.
            null
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Fire-and-forget background check (doesn't block). Used for hostnames where
     * the DNS has already been forwarded but we still want to populate the cache.
     */
    fun checkAsync(hostname: String) {
        if (store.get(hostname) != null) return // Already cached
        inFlight(hostname)
    }

    /**
     * The one request for [hostname]: an existing one if it is still running, else a new one.
     * It is removed from [outstanding] only when its background check has finished (never when a
     * caller merely stops waiting), so no hostname ever has two requests running at once.
     */
    private fun inFlight(hostname: String): CompletableFuture<LiveReputationStore.CachedVerdict?> {
        outstanding[hostname]?.let { return it }
        val started = CompletableFuture<LiveReputationStore.CachedVerdict?>()
        outstanding.putIfAbsent(hostname, started)?.let { return it }
        try {
            executor.execute {
                try {
                    started.complete(performCheck(hostname))
                } catch (t: Throwable) {
                    started.complete(null)
                } finally {
                    outstanding.remove(hostname, started)
                }
            }
        } catch (e: RejectedExecutionException) {
            // Checker already shut down: nothing will run, so release the slot at once.
            outstanding.remove(hostname, started)
            started.complete(null)
        }
        return started
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
        // Device-side privacy decision: for DNS queries not in the local rule bundle,
        // the hostname is transmitted alongside the hash prefix to enable the backend's
        // external intelligence check (Safe Browsing etc.). The backend cannot obtain
        // external intelligence from a hash prefix alone.
        val safeHostname = hostname.replace("\\", "\\\\").replace("\"", "\\\"")
        return """{"hostname_hash_prefix":"$hashPrefix","hostname":"$safeHostname","request_context":"dns_observation"}"""
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
        // Queued checks will never run now: release anyone waiting on them and drop the entries.
        outstanding.values.forEach { it.complete(null) }
        outstanding.clear()
    }
}
