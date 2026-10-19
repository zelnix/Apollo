package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BlockedFlowDeduperTest {
    @Test fun oneConnectionAttemptProducesOneReportWithinWindow() {
        val clock = FixedClock(0)
        val d = BlockedFlowDeduper(5_000, clock)
        assertTrue(d.shouldReport("6/a:1->b:443"))
        clock.advance(1_000); assertFalse(d.shouldReport("6/a:1->b:443")) // SYN retry
        clock.advance(2_000); assertFalse(d.shouldReport("6/a:1->b:443")) // another retry
        assertTrue(d.shouldReport("6/a:2->b:443"))                           // different flow
        clock.advance(2_000); assertTrue(d.shouldReport("6/a:1->b:443"))    // window elapsed
    }

    @Test fun prunesExpiredEntries() {
        val clock = FixedClock(0)
        val d = BlockedFlowDeduper(1_000, clock)
        d.shouldReport("x"); d.shouldReport("y")
        assertEquals(2, d.size())
        clock.advance(1_000); d.shouldReport("z")
        assertEquals(1, d.size())
    }
}
