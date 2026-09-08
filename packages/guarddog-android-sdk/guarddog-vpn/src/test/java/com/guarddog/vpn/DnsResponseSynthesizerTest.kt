package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DnsResponseSynthesizerTest {
    private fun u16(bytes: ByteArray, offset: Int) = ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)

    private val query = Ipv4PacketInfo(
        sourceIpv4 = "10.255.255.5",
        destinationIpv4 = "192.0.2.53",
        protocol = Ipv4PacketParser.PROTO_UDP,
        totalLength = 60,
        sourcePort = 55123,
        destinationPort = 53,
    )
    private val dnsQuery = DnsQuery(transactionId = 0xBEEF, qname = "bad-test.guarddog.example", qtype = DnsQueryParser.TYPE_A, qclass = DnsQueryParser.CLASS_IN)

    @Test fun sinkholeAnswerIsAWellFormedResponsePacketAddressedBackToTheQuerier() {
        val packet = DnsResponseSynthesizer.synthesizeSinkholeAnswer(query, dnsQuery, "192.0.2.240")
        val info = Ipv4PacketParser.parse(packet, packet.size)!!
        assertEquals("192.0.2.53", info.sourceIpv4) // response "from" the endpoint the app queried
        assertEquals("10.255.255.5", info.destinationIpv4) // response "to" the querying app
        assertEquals(53, info.sourcePort)
        assertEquals(55123, info.destinationPort)

        val range = Ipv4PacketParser.udpPayloadRange(packet, packet.size)!!
        val msg = packet.copyOfRange(range.first, range.last + 1)
        assertEquals(0xBEEF, u16(msg, 0)) // transaction id preserved
        val flags = u16(msg, 2)
        assertEquals(1, (flags ushr 15) and 0x1) // QR=1
        assertEquals(1, u16(msg, 6)) // ANCOUNT=1
        assertContentEquals(byteArrayOf(192.toByte(), 0, 2, 240.toByte()), msg.copyOfRange(msg.size - 4, msg.size)) // rdata = sinkhole IP
    }

    @Test fun aaaaBlockAnswersNxDomainNeverLeakingARealAddress() {
        val aaaaQuery = dnsQuery.copy(qtype = DnsQueryParser.TYPE_AAAA)
        val packet = DnsResponseSynthesizer.synthesizeNxDomain(query, aaaaQuery)
        val range = Ipv4PacketParser.udpPayloadRange(packet, packet.size)!!
        val msg = packet.copyOfRange(range.first, range.last + 1)
        val flags = u16(msg, 2)
        assertEquals(3, flags and 0xf) // RCODE = NXDOMAIN
        assertEquals(0, u16(msg, 6)) // ANCOUNT=0
        assertEquals(1, (flags ushr 15) and 0x1) // still a response, QR=1
    }

    @Test fun rawAnswerIsWrappedUntouched() {
        val rawUpstream = byteArrayOf(0xBE.toByte(), 0xEF.toByte(), 1, 2, 3, 4, 5, 6)
        val packet = DnsResponseSynthesizer.wrapRawAnswer(query, rawUpstream)
        val range = Ipv4PacketParser.udpPayloadRange(packet, packet.size)!!
        assertContentEquals(rawUpstream, packet.copyOfRange(range.first, range.last + 1))
    }

    @Test fun everyResponseIsAddressedBackToTheOriginalQuerierRegardlessOfKind() {
        val nx = DnsResponseSynthesizer.synthesizeNxDomain(query, dnsQuery)
        val raw = DnsResponseSynthesizer.wrapRawAnswer(query, byteArrayOf(1))
        for (packet in listOf(nx, raw)) {
            val info = Ipv4PacketParser.parse(packet, packet.size)!!
            assertTrue(info.sourceIpv4 == query.destinationIpv4 && info.destinationIpv4 == query.sourceIpv4)
        }
    }
}
