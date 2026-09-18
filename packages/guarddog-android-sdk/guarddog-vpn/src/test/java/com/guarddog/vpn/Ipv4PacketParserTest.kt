package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class Ipv4PacketParserTest {
    /** Builds an IPv4 header (+ optional 4 bytes of L4 ports). */
    private fun packet(src: IntArray, dst: IntArray, proto: Int, sport: Int? = null, dport: Int? = null, ihlWords: Int = 5): ByteArray {
        val headerLen = ihlWords * 4
        val total = headerLen + if (sport != null) 4 else 0
        val b = ByteArray(total)
        b[0] = ((4 shl 4) or ihlWords).toByte()
        b[2] = (total ushr 8).toByte(); b[3] = total.toByte()
        b[9] = proto.toByte()
        for (i in 0..3) { b[12 + i] = src[i].toByte(); b[16 + i] = dst[i].toByte() }
        if (sport != null && dport != null) {
            b[headerLen] = (sport ushr 8).toByte(); b[headerLen + 1] = sport.toByte()
            b[headerLen + 2] = (dport ushr 8).toByte(); b[headerLen + 3] = dport.toByte()
        }
        return b
    }

    @Test fun parsesTcpSynToControlledIp() {
        val p = packet(intArrayOf(10, 255, 255, 2), intArrayOf(203, 0, 113, 10), 6, 51000, 443)
        val info = Ipv4PacketParser.parse(p, p.size)!!
        assertEquals("203.0.113.10", info.destinationIpv4)
        assertEquals("10.255.255.2", info.sourceIpv4)
        assertEquals(6, info.protocol); assertEquals(51000, info.sourcePort); assertEquals(443, info.destinationPort)
        assertEquals("6/10.255.255.2:51000->203.0.113.10:443", info.flowKey)
    }

    @Test fun handlesOptionsAndUdp() {
        val p = packet(intArrayOf(1, 2, 3, 4), intArrayOf(203, 0, 113, 10), 17, 5353, 53, ihlWords = 6)
        val info = Ipv4PacketParser.parse(p, p.size)!!
        assertEquals(53, info.destinationPort); assertEquals(17, info.protocol)
    }

    @Test fun rejectsIpv6ShortAndInconsistent() {
        val v6 = ByteArray(40).also { it[0] = 0x60 }
        assertNull(Ipv4PacketParser.parse(v6, v6.size))
        assertNull(Ipv4PacketParser.parse(ByteArray(10), 10))
        val bad = packet(intArrayOf(1, 2, 3, 4), intArrayOf(5, 6, 7, 8), 6, 1, 2)
        bad[3] = 0x01 // total length smaller than header
        assertNull(Ipv4PacketParser.parse(bad, bad.size))
    }

    @Test fun icmpHasNoPorts() {
        val p = packet(intArrayOf(1, 2, 3, 4), intArrayOf(203, 0, 113, 10), 1)
        val info = Ipv4PacketParser.parse(p, p.size)!!
        assertNull(info.sourcePort); assertNull(info.destinationPort)
    }

    /** Builds a full IPv4 + UDP header (+ optional payload) for [udpPayloadRange] tests. */
    private fun udpPacket(payload: ByteArray, ihlWords: Int = 5): ByteArray {
        val headerLen = ihlWords * 4
        val udpLength = 8 + payload.size
        val total = headerLen + udpLength
        val b = ByteArray(total)
        b[0] = ((4 shl 4) or ihlWords).toByte()
        b[2] = (total ushr 8).toByte(); b[3] = total.toByte()
        b[9] = 17 // UDP
        b[headerLen + 4] = (udpLength ushr 8).toByte(); b[headerLen + 5] = udpLength.toByte()
        System.arraycopy(payload, 0, b, headerLen + 8, payload.size)
        return b
    }

    @Test fun udpPayloadRangeCoversExactlyTheDnsMessage() {
        val payload = byteArrayOf(1, 2, 3, 4, 5)
        val p = udpPacket(payload)
        val range = Ipv4PacketParser.udpPayloadRange(p, p.size)!!
        assertEquals(payload.toList(), p.copyOfRange(range.first, range.last + 1).toList())
    }

    @Test fun udpPayloadRangeHonorsIpOptions() {
        val payload = byteArrayOf(9, 8, 7)
        val p = udpPacket(payload, ihlWords = 6) // 4 bytes of IP options before the UDP header
        val range = Ipv4PacketParser.udpPayloadRange(p, p.size)!!
        assertEquals(payload.toList(), p.copyOfRange(range.first, range.last + 1).toList())
    }

    @Test fun udpPayloadRangeIsNullForTcp() {
        val p = packet(intArrayOf(1, 2, 3, 4), intArrayOf(203, 0, 113, 10), 6, 1, 2)
        assertNull(Ipv4PacketParser.udpPayloadRange(p, p.size))
    }

    @Test fun udpPayloadRangeIsNullForTruncatedUdpHeader() {
        val truncated = byteArrayOf(0x45, 0x00, 0x00, 0x14, 0, 0, 0, 0, 0, 17)
        assertNull(Ipv4PacketParser.udpPayloadRange(truncated, truncated.size))
    }

    @Test fun udpPayloadRangeIsNullWhenClaimedUdpLengthExceedsIpTotalLength() {
        val p = udpPacket(byteArrayOf(1, 2, 3))
        p[headerLenIndexFor(p)] = 0xff.toByte() // corrupt the UDP length field to claim more than the packet has
        assertNull(Ipv4PacketParser.udpPayloadRange(p, p.size))
    }

    private fun headerLenIndexFor(packet: ByteArray): Int {
        val ihl = (packet[0].toInt() and 0x0f) * 4
        return ihl + 4 // high byte of the UDP length field
    }
}
