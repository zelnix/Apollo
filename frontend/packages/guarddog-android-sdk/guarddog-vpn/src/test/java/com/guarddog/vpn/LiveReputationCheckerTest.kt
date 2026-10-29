package com.guarddog.vpn

import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Unit tests for LiveReputationChecker — specifically the hash prefix computation
 * and JSON body building which don't require network access.
 */
class LiveReputationCheckerTest {

    private fun buildChecker(hashPrefixLength: Int = 8): LiveReputationChecker {
        val store = LiveReputationStore()
        return LiveReputationChecker(
            store = store,
            backendBaseUrl = "http://localhost:8001",
            hashPrefixLength = hashPrefixLength,
        )
    }

    @Test fun computeHashPrefixReturnsCorrectLength() {
        val checker = buildChecker(hashPrefixLength = 8)
        val prefix = checker.computeHashPrefix("example.com")
        assertEquals(8, prefix.length)
    }

    @Test fun computeHashPrefixIsDeterministic() {
        val checker = buildChecker()
        val prefix1 = checker.computeHashPrefix("example.com")
        val prefix2 = checker.computeHashPrefix("example.com")
        assertEquals(prefix1, prefix2)
    }

    @Test fun computeHashPrefixIsCaseInsensitive() {
        val checker = buildChecker()
        val lower = checker.computeHashPrefix("example.com")
        val upper = checker.computeHashPrefix("EXAMPLE.COM")
        val mixed = checker.computeHashPrefix("ExAmPlE.CoM")
        assertEquals(lower, upper)
        assertEquals(lower, mixed)
    }

    @Test fun computeHashPrefixDiffersForDifferentHosts() {
        val checker = buildChecker()
        val a = checker.computeHashPrefix("example.com")
        val b = checker.computeHashPrefix("evil.example.com")
        assertTrue(a != b)
    }

    @Test fun computeHashPrefixRespectsMinLength() {
        val checker = buildChecker(hashPrefixLength = 2) // below min of 4
        val prefix = checker.computeHashPrefix("example.com")
        assertEquals(4, prefix.length) // clamped to minimum of 4
    }

    @Test fun computeHashPrefixRespectsMaxLength() {
        val checker = buildChecker(hashPrefixLength = 100) // above max of 16
        val prefix = checker.computeHashPrefix("example.com")
        assertEquals(16, prefix.length) // clamped to maximum of 16
    }

    @Test fun computeHashPrefixIsHexadecimal() {
        val checker = buildChecker()
        val prefix = checker.computeHashPrefix("test.example.org")
        assertTrue(prefix.all { it in "0123456789abcdef" })
    }

    @Test fun cachedVerdictReturnedWithoutNetworkCall() {
        val store = LiveReputationStore()
        val checker = LiveReputationChecker(
            store = store,
            backendBaseUrl = "http://unreachable:9999", // Would fail if actually called
        )
        // Pre-populate the cache
        store.put(LiveReputationStore.CachedVerdict(
            hostname = "cached.example.com",
            verdict = "clean",
            confidence = "high",
            source = "test",
            checkedAt = System.currentTimeMillis(),
            expiresAt = System.currentTimeMillis() + 300_000,
            inActiveBundleAtCheck = false,
            investigationComplete = true,
        ))
        // Should return the cached result immediately without any network call
        val result = checker.checkBounded("cached.example.com")
        assertNotNull(result)
        assertEquals("clean", result.verdict)
        assertEquals("high", result.confidence)
    }

    // Battery fix: a caller that stops waiting must not drop the request, or the next lookup of the
    // same hostname starts a second request while the first is still running.
    @Test fun aTimedOutWaitKeepsTheRequestSoARepeatLookupNeverStartsASecondOne() {
        val requests = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/api/guarddog/dns-check") { exchange ->
            requests.incrementAndGet()
            Thread.sleep(800) // slower than the hold below
            val body = """{"verdict":"clean","confidence":"high","source":"test"}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.executor = Executors.newCachedThreadPool()
        server.start()
        val store = LiveReputationStore()
        val checker = LiveReputationChecker(store, "http://127.0.0.1:${server.address.port}", holdTimeoutMs = 100)
        try {
            assertNull(checker.checkBounded("slow.example.com")) // gave up waiting; the request keeps running
            assertNull(checker.checkBounded("slow.example.com")) // waits on the same request
            Thread.sleep(1_500)
            assertEquals(1, requests.get())
            assertEquals("clean", checker.checkBounded("slow.example.com")?.verdict) // now answered from the cache
            assertEquals(1, requests.get())
        } finally {
            checker.shutdown()
            server.stop(0)
        }
    }
}
