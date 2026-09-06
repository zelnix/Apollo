package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.protection.ProtectionEnforcementReporter
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TunPacketReaderTest {
    private fun ipv4(dst: IntArray, sport: Int, dport: Int): ByteArray {
        val b = ByteArray(24)
        b[0] = 0x45; b[2] = 0; b[3] = 24; b[9] = 6
        b[12] = 10; b[13] = 255.toByte(); b[14] = 255.toByte(); b[15] = 2
        for (i in 0..3) b[16 + i] = dst[i].toByte()
        b[20] = (sport ushr 8).toByte(); b[21] = sport.toByte(); b[22] = (dport ushr 8).toByte(); b[23] = dport.toByte()
        return b
    }

    /** Emulates the TUN fd: each read() returns exactly one packet. */
    private class PacketStream(private val packets: List<ByteArray>) : java.io.InputStream() {
        private var i = 0
        override fun read(): Int = throw UnsupportedOperationException()
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (i >= packets.size) return -1
            val p = packets[i++]; System.arraycopy(p, 0, b, off, p.size); return p.size
        }
    }

    @Test fun observesDropsAndReportsOnlyAfterRealPacket() {
        val clock = FixedClock(0)
        val evidence = ArrayList<BlockedThreatEvidence>()
        val reporter = ProtectionEnforcementReporter { evidence.add(it) }
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), reporter, clock) { "ev-${evidence.size + 1}" }
        val controlled = intArrayOf(203, 0, 113, 10)
        val other = intArrayOf(198, 51, 100, 7)
        val reader = TunPacketReader(PacketStream(listOf(ipv4(controlled, 51000, 443), ipv4(controlled, 51000, 443), ipv4(other, 1, 2), ipv4(controlled, 51001, 443))), drop)

        assertTrue(evidence.isEmpty()) // nothing before packets are observed
        reader.run()

        assertEquals(4, reader.packetsRead)
        val stats = drop.stats()
        assertEquals(3, stats.observedMatching); assertEquals(3, stats.droppedMatching)
        assertEquals(2, stats.reportedBlocks); assertEquals(1, stats.dedupedRetries); assertEquals(1, stats.unexpectedPackets)
        assertEquals(listOf("ev-1", "ev-2"), evidence.map { it.enforcementEvidenceId })
        assertEquals("203.0.113.10", evidence[0].destinationIpv4); assertEquals(443, evidence[0].destinationPort)
        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_TUN_DROP, evidence[0].enforcementLayer)
    }

    @Test fun nothingIsEverForwarded() {
        val out = ByteArrayOutputStream()
        val clock = FixedClock(0)
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock)
        TunPacketReader(ByteArrayInputStream(ipv4(intArrayOf(203, 0, 113, 10), 1, 443)), drop).run()
        assertEquals(0, out.size()) // reader has no output side at all
    }
}
