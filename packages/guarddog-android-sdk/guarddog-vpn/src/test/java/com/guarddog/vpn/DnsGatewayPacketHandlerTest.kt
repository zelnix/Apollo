package com.guarddog.vpn

import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.FixedClock
import com.guarddog.core.protection.ProtectionRuntimeState
import com.guarddog.core.protection.ProtectionRuntimeStateProvider
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Integration test for the decision-wiring orchestrator: DnsQueryParser -> SinkholeBindingStore
 * (-> shared-core GuardDogSDKEngine) -> DnsResponseSynthesizer / UpstreamDnsForwarder. Each piece
 * already has its own focused unit tests; this proves they compose correctly end to end.
 *
 * NOTE: same convention as GuardDogSDKEngineTest -- code-review ready / not runtime-verified in
 * this environment (no JVM toolchain here), verified compilable/passing by the native-gates CI job.
 */
class DnsGatewayPacketHandlerTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")
    private fun read(path: String) = File(vectors, path).readText()
    private val clock = FixedClock(Instant.parse("2026-09-15T00:00:00Z").toEpochMilli())
    private val gateway = "192.0.2.53"
    private val pool = listOf("192.0.2.240", "192.0.2.241")

    private class FakeRuntimeState : ProtectionRuntimeStateProvider {
        override fun current(): ProtectionRuntimeState = ProtectionRuntimeState(ProtectionState.ACTIVE, consentGranted = true, updatedAtEpochMillis = 0)
        override fun addListener(listener: (ProtectionRuntimeState) -> Unit): () -> Unit = {}
    }

    private fun engineWithAcceptedM2Bundle(): GuardDogSDKEngine {
        val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), clock)
        val eng = GuardDogSDKEngine(verifier, FakeRuntimeState(), clock)
        eng.acceptWebsiteGateRuleBundle(read("m2-website-gate/m2_website_gate_valid_bundle.json"))
        return eng
    }

    private fun u16(v: Int) = byteArrayOf(((v ushr 8) and 0xff).toByte(), (v and 0xff).toByte())

    private fun buildDnsQueryMessage(qname: String, qtype: Int = DnsQueryParser.TYPE_A, transactionId: Int = 0xABCD): ByteArray {
        val out = ArrayList<Byte>()
        out.addAll(u16(transactionId).toList())
        out.addAll(u16(0x0100).toList()) // QR=0, RD=1
        out.addAll(u16(1).toList()); out.addAll(u16(0).toList()); out.addAll(u16(0).toList()); out.addAll(u16(0).toList())
        for (label in qname.split('.')) { out.add(label.length.toByte()); out.addAll(label.toByteArray(Charsets.US_ASCII).toList()) }
        out.add(0)
        out.addAll(u16(qtype).toList())
        out.addAll(u16(DnsQueryParser.CLASS_IN).toList())
        return out.toByteArray()
    }

    /** Wraps a DNS query message into a full IPv4/UDP packet from a fake app to the virtual DNS endpoint. */
    private fun buildQueryPacket(dnsMessage: ByteArray, srcIpv4: String = "10.255.255.5", srcPort: Int = 55123): ByteArray {
        val udpLength = 8 + dnsMessage.size
        val totalLength = 20 + udpLength
        val packet = ByteArray(totalLength)
        packet[0] = 0x45
        packet[2] = ((totalLength ushr 8) and 0xff).toByte(); packet[3] = (totalLength and 0xff).toByte()
        packet[9] = Ipv4PacketParser.PROTO_UDP.toByte()
        val src = srcIpv4.split('.').map { it.toInt() }
        val dst = gateway.split('.').map { it.toInt() }
        for (i in 0..3) { packet[12 + i] = src[i].toByte(); packet[16 + i] = dst[i].toByte() }
        packet[20] = ((srcPort ushr 8) and 0xff).toByte(); packet[21] = (srcPort and 0xff).toByte()
        packet[22] = 0; packet[23] = 53
        packet[24] = ((udpLength ushr 8) and 0xff).toByte(); packet[25] = (udpLength and 0xff).toByte()
        System.arraycopy(dnsMessage, 0, packet, 28, dnsMessage.size)
        return packet
    }

    private fun handlerWith(engine: GuardDogSDKEngine, forwarderResponse: ByteArray?): Pair<DnsGatewayPacketHandler, MutableList<String>> {
        val store = SinkholeBindingStore(engine, pool, 5_000, clock)
        val unsupported = mutableListOf<String>()
        val forwarder = UpstreamDnsForwarder { _, _, _ -> forwarderResponse }
        return DnsGatewayPacketHandler(store, forwarder) { reason -> unsupported.add(reason) } to unsupported
    }

    @Test fun blockedHostGetsASinkholeAnswerNeverTheRealAddress() {
        val (handler, _) = handlerWith(engineWithAcceptedM2Bundle(), forwarderResponse = null)
        val packet = buildQueryPacket(buildDnsQueryMessage("bad-test.guarddog.example"))
        val info = Ipv4PacketParser.parse(packet, packet.size)!!

        val response = handler.handle(info, packet, packet.size)!!
        val respInfo = Ipv4PacketParser.parse(response, response.size)!!
        assertEquals(gateway, respInfo.sourceIpv4)
        val range = Ipv4PacketParser.udpPayloadRange(response, response.size)!!
        val rdata = response.copyOfRange(range.last - 3, range.last + 1)
        val rdataAsIp = "${rdata[0].toInt() and 0xff}.${rdata[1].toInt() and 0xff}.${rdata[2].toInt() and 0xff}.${rdata[3].toInt() and 0xff}"
        assertTrue(pool.contains(rdataAsIp))
    }

    @Test fun allowedHostForwardsUpstreamUntouched() {
        val upstreamAnswer = byteArrayOf(0xAB.toByte(), 0xCD.toByte(), 1, 2, 3)
        val (handler, _) = handlerWith(engineWithAcceptedM2Bundle(), forwarderResponse = upstreamAnswer)
        val packet = buildQueryPacket(buildDnsQueryMessage("good-test.guarddog.example"))
        val info = Ipv4PacketParser.parse(packet, packet.size)!!

        val response = handler.handle(info, packet, packet.size)!!
        val range = Ipv4PacketParser.udpPayloadRange(response, response.size)!!
        assertContentEquals(upstreamAnswer, response.copyOfRange(range.first, range.last + 1))
    }

    @Test fun blockedHostAaaaQueryGetsNxDomainNeverARealIpv6Leak() {
        val leakSentinel = byteArrayOf(9, 9, 9)
        val (handler, _) = handlerWith(engineWithAcceptedM2Bundle(), forwarderResponse = leakSentinel)
        val packet = buildQueryPacket(buildDnsQueryMessage("bad-test.guarddog.example", qtype = DnsQueryParser.TYPE_AAAA))
        val info = Ipv4PacketParser.parse(packet, packet.size)!!

        val response = handler.handle(info, packet, packet.size)!!
        val range = Ipv4PacketParser.udpPayloadRange(response, response.size)!!
        val msg = response.copyOfRange(range.first, range.last + 1)
        val flags = ((msg[2].toInt() and 0xff) shl 8) or (msg[3].toInt() and 0xff)
        assertEquals(3, flags and 0xf) // NXDOMAIN
        assertTrue(!msg.contentEquals(leakSentinel)) // never forwarded to the (would-be leaking) upstream path
    }

    @Test fun malformedDnsFallsOpenToForwarder() {
        val upstreamAnswer = byteArrayOf(1, 2, 3)
        val (handler, unsupported) = handlerWith(engineWithAcceptedM2Bundle(), forwarderResponse = upstreamAnswer)
        val garbage = ByteArray(10) // too short to even be a DNS header
        val packet = buildQueryPacket(garbage)
        val info = Ipv4PacketParser.parse(packet, packet.size)!!

        val response = handler.handle(info, packet, packet.size)!!
        assertTrue(unsupported.isNotEmpty())
        val range = Ipv4PacketParser.udpPayloadRange(response, response.size)!!
        assertContentEquals(upstreamAnswer, response.copyOfRange(range.first, range.last + 1))
    }
}
