package com.guarddog.vpn

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotSame
import kotlin.test.assertTrue

/**
 * Regression for the proof-phone crash: the DNS/IP binding check inside GuardDogVpnService ran on the main thread
 * (NetworkOnMainThreadException). The check must execute on a different thread than the caller and never propagate resolver failures.
 */
class OffThreadBindingCheckTest {
    private val config = VpnConfig(controlledHost = "blocktest.example", controlledIpv4 = "203.0.113.10", controlledUrl = "https://blocktest.example/", rulesetId = "gd-m1-controlled-block")

    private fun await(latch: CountDownLatch) = assertTrue(latch.await(5, TimeUnit.SECONDS), "binding result not delivered")

    @Test fun resolverRunsOffTheCallerThreadAndDeliversMatch() {
        val caller = Thread.currentThread()
        val resolverThread = AtomicReference<Thread>()
        val result = AtomicReference<BindingResult>()
        val done = CountDownLatch(1)
        OffThreadBindingCheck(Executors.newSingleThreadExecutor()).run(config, { resolverThread.set(Thread.currentThread()); listOf("203.0.113.10") }) { result.set(it); done.countDown() }
        await(done)
        assertNotSame(caller, resolverThread.get(), "DNS lookup must not run on the calling (main) thread")
        assertEquals(BindingResult.Match("203.0.113.10"), result.get())
    }

    @Test fun mismatchAndResolverExceptionsFailClosedInsteadOfCrashing() {
        val results = mutableListOf<BindingResult>()
        val done = CountDownLatch(2)
        val check = OffThreadBindingCheck(Executors.newSingleThreadExecutor())
        check.run(config, { listOf("198.51.100.1") }) { synchronized(results) { results += it }; done.countDown() }
        check.run(config, { throw IllegalStateException("simulated NetworkOnMainThreadException / resolver failure") }) { synchronized(results) { results += it }; done.countDown() }
        await(done)
        assertEquals(BindingResult.Mismatch("203.0.113.10", listOf("198.51.100.1")), results[0])
        assertEquals(BindingResult.ResolutionFailed("blocktest.example"), results[1])
    }

    @Test fun refusesToResolveOnTheCallerThread() {
        // A same-thread executor reproduces the original defect shape; the guard must reject it rather than perform the lookup.
        val sameThread = Executor { it.run() }
        assertFailsWith<IllegalStateException> { OffThreadBindingCheck(sameThread).run(config, { listOf("203.0.113.10") }) { } }
    }
}
