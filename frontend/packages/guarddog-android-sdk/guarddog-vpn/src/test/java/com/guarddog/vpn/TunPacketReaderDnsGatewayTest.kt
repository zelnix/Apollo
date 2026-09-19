package com.guarddog.vpn

import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Gate Guard M2 Website Gate: proves the read-loop routing added to TunPacketReader -- a DNS
 * gateway packet is diverted to [DnsGatewayPacketHandler] and NEVER reaches [PacketDropReporter],
 * and any response is the only thing written back. TunPacketReaderTest.kt (existing, untouched)
 * separately proves the M1-only (dnsGateway == null) loop is bit-for-bit unchanged.
 */
class TunPacketReaderDnsGatewayTest {
    private val gateway = "192.0.2.53"
    private val clock = FixedClock(0)

    /** Emulates the TUN fd: each read() returns exactly one packet. */
    private class PacketStream(private val packets: List<ByteArray>) : InputStream() {
        private var i = 0
        override fun read(): Int = throw UnsupportedOperationException()
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (i >= packets.size) return -1
            val p = packets[i++]; System.arraycopy(p, 0, b, off, p.size); return p.size
        }
    }

    private class FakeRuntimeState : ProtectionRuntimeStateProvider {
        override fun current(): ProtectionRuntimeState = ProtectionRuntimeState(ProtectionState.ACTIVE, consentGranted = true, updatedAtEpochMillis = 0)
        override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit = {}
    }

    private fun u16(v: Int) = byteArrayOf(((v ushr 8) and 0xff).toByte(), (v and 0xff).toByte())

    private fun dnsQueryPacket(qname: String = "bad-test.guarddog.example"): ByteArray {
        val dns = ArrayList<Byte>()
        dns.addAll(u16(0xABCD).toList()); dns.addAll(u16(0x0100).toList())
        dns.addAll(u16(1).toList()); dns.addAll(u16(0).toList()); dns.addAll(u16(0).toList()); dns.addAll(u16(0).toList())
        for (label in qname.split('.')) { dns.add(label.length.toByte()); dns.addAll(label.toByteArray(Charsets.US_ASCII).toList()) }
        dns.add(0); dns.addAll(u16(DnsQueryParser.TYPE_A).toList()); dns.addAll(u16(DnsQueryParser.CLASS_IN).toList())
        val dnsBytes = dns.toByteArray()

        val udpLength = 8 + dnsBytes.size
        val totalLength = 20 + udpLength
        val packet = ByteArray(totalLength)
        packet[0] = 0x45
        packet[2] = ((totalLength ushr 8) and 0xff).toByte(); packet[3] = (totalLength and 0xff).toByte()
        packet[9] = Ipv4PacketParser.PROTO_UDP.toByte()
        val dst = gateway.split('.').map { it.toInt() }
        val src = listOf(10, 255, 255, 5)
        for (i in 0..3) { packet[12 + i] = src[i].toByte(); packet[16 + i] = dst[i].toByte() }
        packet[20] = 0; packet[21] = 55; packet[22] = 0; packet[23] = 53
        packet[24] = ((udpLength ushr 8) and 0xff).toByte(); packet[25] = (udpLength and 0xff).toByte()
        System.arraycopy(dnsBytes, 0, packet, 28, dnsBytes.size)
        return packet
    }

    /** An ordinary TCP packet addressed elsewhere (not the DNS gateway, not any recognized M1/M2 target). */
    private fun unrelatedTcpPacket(dst: IntArray): ByteArray {
        val b = ByteArray(24)
        b[0] = 0x45; b[3] = 24; b[9] = 6
        b[12] = 10; b[13] = 255.toByte(); b[14] = 255.toByte(); b[15] = 2
        for (i in 0..3) b[16 + i] = dst[i].toByte()
        return b
    }

    private fun engineWithNoAcceptedBundle(): GuardDogSDKEngine {
        val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), clock)
        return GuardDogSDKEngine(verifier, FakeRuntimeState(), clock)
    }

    @Test fun dnsGatewayPacketNeverReachesPacketDropReporterAndWritesAResponseBack() {
        // No accepted M2 bundle at all -> SinkholeBindingStore.arm always fails open -> the handler
        // always forwards. This proves the ROUTING/plumbing in TunPacketReader, independent of any
        // rule decision (that is already covered by DnsGatewayPacketHandlerTest/SinkholeBindingStoreTest).
        val fixedResponse = byteArrayOf(1, 2, 3)
        val gatewayHandler = DnsGatewayPacketHandler(
            SinkholeBindingStore(engineWithNoAcceptedBundle(), listOf("192.0.2.240"), 5_000, clock),
            UpstreamDnsForwarder { _, _, _ -> fixedResponse },
        )
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock)
        val output = ByteArrayOutputStream()
        val other = intArrayOf(198, 51, 100, 7)
        val input = PacketStream(listOf(dnsQueryPacket(), unrelatedTcpPacket(other)))
        val reader = TunPacketReader(
            input = input, dropReporter = drop, output = output, dnsGatewayIpv4 = gateway, dnsGateway = gatewayHandler,
        )

        reader.run()

        assertEquals(2, reader.packetsRead)
        assertEquals(0, drop.stats().observedMatching) // the DNS gateway packet never reached PacketDropReporter
        assertEquals(1, drop.stats().unexpectedPackets) // only the unrelated packet did, correctly as unexpected
        assertTrue(output.size() > 0) // the forwarded (fail-open) response was written back
    }

    @Test fun withNoDnsGatewayWiredTheLoopIsExactlyTheM1LoopEvenForAPacketThatLooksLikeDns() {
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock)
        val output = ByteArrayOutputStream()
        val input = PacketStream(listOf(dnsQueryPacket()))
        val reader = TunPacketReader(input = input, dropReporter = drop, output = output) // dnsGateway/dnsGatewayIpv4 both default null

        reader.run()

        assertEquals(0, output.size()) // nothing is ever written back without an explicitly wired dnsGateway
        assertEquals(1, drop.stats().unexpectedPackets) // falls through to the M1 unexpected-destination path
    }
}
