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

    @Test fun recoverySnapshotIsCleanOnlyAfterSessionClosedAndStateLeftRunning() {
        val clock = FixedClock(0)
        val repo = VpnStateRepository(clock)
        val stream = BlockingStream()
        val reporter = PacketDropReporter("52.25.179.131", BlockedFlowDeduper(5_000, clock), { }, clock)
        val session = TunSession(Closeable { stream.close() }, TunPacketReader(stream, reporter), null)
        repo.recordConsent(true)
        repo.transition(VpnLifecycleState.Running(0, "52.25.179.131/32"))

        val enforcing = RecoveryInspector.fromRuntime(repo, session, reporter, vpnTransportPresent = true)
        assertTrue(enforcing.tunOpen && enforcing.selectiveRouteActive && enforcing.dropReporterAttached)
        assertEquals("52.25.179.131/32", enforcing.routeCidr)
        assertFalse(enforcing.recovered)

        session.close()
        repo.transition(VpnLifecycleState.Stopped("stopped by user"))
        val stillVpnTransport = RecoveryInspector.fromRuntime(repo, session, null, vpnTransportPresent = true)
        assertFalse(stillVpnTransport.recovered) // OS still reports a VPN transport -> not recovered yet

        val recovered = RecoveryInspector.fromRuntime(repo, null, null, vpnTransportPresent = false)
        assertEquals("STOPPED", recovered.lifecycle)
        assertFalse(recovered.tunOpen || recovered.selectiveRouteActive || recovered.dropReporterAttached)
        assertTrue(recovered.recovered)
    }
}
