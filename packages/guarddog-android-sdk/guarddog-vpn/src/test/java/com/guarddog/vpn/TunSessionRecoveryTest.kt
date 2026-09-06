package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionState
import java.io.Closeable
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Recovery (item 6): stop closes TUN once, service reports inactive, revocation clears consent. */
class TunSessionRecoveryTest {
    private class BlockingStream : InputStream() {
        @Volatile var closed = false
        override fun read(): Int = throw UnsupportedOperationException()
        override fun read(b: ByteArray, off: Int, len: Int): Int { while (!closed) Thread.sleep(5); return -1 }
        override fun close() { closed = true }
    }

    @Test fun stopClosesDescriptorOnceAndStopsReader() {
        val clock = FixedClock(0)
        val stream = BlockingStream()
        var closes = 0
        val descriptor = Closeable { closes++; stream.close() }
        val reader = TunPacketReader(stream, PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock))
        val thread = Thread(reader)
        var cleared = false
        val session = TunSession(descriptor, reader, thread) { cleared = true }
        session.start()
        Thread.sleep(20)
        session.close()
        session.close() // idempotent
        thread.join(1_000)
        assertEquals(1, closes)
        assertTrue(session.closed && cleared)
        assertFalse(thread.isAlive)
    }

    @Test fun lifecycleReportsInactiveAfterStopAndRevocation() {
        val repo = VpnStateRepository(FixedClock(0))
        repo.recordConsent(true)
        repo.transition(VpnLifecycleState.Running(0, "203.0.113.10/32"))
        repo.transition(VpnLifecycleState.Stopped("stopped by user"))
        assertEquals(ProtectionState.STOPPED, repo.current().state)
        assertFalse(repo.lifecycle.isEnforcing)
        assertTrue(repo.consentGranted) // stopping does not revoke consent
        repo.transition(VpnLifecycleState.Running(0, "203.0.113.10/32"))
        repo.transition(VpnLifecycleState.Revoked)
        assertEquals(ProtectionState.REVOKED, repo.current().state)
        assertFalse(repo.consentGranted) // revocation does
    }
}
