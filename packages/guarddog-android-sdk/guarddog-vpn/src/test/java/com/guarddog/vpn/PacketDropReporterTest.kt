package com.guarddog.vpn

import com.guarddog.core.clock.FixedClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.protection.ProtectionEnforcementReporter
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Gate Guard M2 Website Gate: proves PacketDropReporter's additive sinkhole-pool recognition
 * (see onPacket) without touching TunPacketReaderTest.kt, which already proves the pure-M1 (no
 * websiteGateAuthorizer) behavior is bit-for-bit unchanged.
 */
class PacketDropReporterTest {
    private fun infoFor(dst: String, protocol: Int = Ipv4PacketParser.PROTO_TCP) =
        Ipv4PacketInfo("10.255.255.2", dst, protocol, 60, 51000, 443)

    @Test fun recognizesASinkholePoolAddressAsMatchingWhenAuthorizerIsWired() {
        val clock = FixedClock(0)
        val evidence = ArrayList<BlockedThreatEvidence>()
        val reporter = ProtectionEnforcementReporter { evidence.add(it) }
        val authorizer = WebsiteGatePacketAuthorizer("203.0.113.10", setOf("192.0.2.240"))
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), reporter, clock, authorizer)

        val decision = drop.onPacket(infoFor("192.0.2.240"), Ipv4PacketParser.Kind.IPV4)

        assertEquals(PacketDropReporter.Decision.DROP_MATCHING, decision)
        assertEquals(1, evidence.size)
        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP, evidence[0].enforcementLayer)
        assertEquals(1, drop.stats().observedMatching)
        assertEquals(0, drop.stats().unexpectedPackets)
    }

    @Test fun m1ControlledDestinationStillTagsTheOriginalTunDropLayer() {
        val clock = FixedClock(0)
        val evidence = ArrayList<BlockedThreatEvidence>()
        val reporter = ProtectionEnforcementReporter { evidence.add(it) }
        val authorizer = WebsiteGatePacketAuthorizer("203.0.113.10", setOf("192.0.2.240"))
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), reporter, clock, authorizer)

        drop.onPacket(infoFor("203.0.113.10"), Ipv4PacketParser.Kind.IPV4)

        assertEquals(BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_TUN_DROP, evidence[0].enforcementLayer)
    }

    @Test fun withoutAnAuthorizerASinkholeAddressIsUnexpectedNoiseExactlyLikeM1() {
        val clock = FixedClock(0)
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock)

        val decision = drop.onPacket(infoFor("192.0.2.240"), Ipv4PacketParser.Kind.IPV4)

        assertEquals(PacketDropReporter.Decision.DROP_UNEXPECTED, decision)
        assertEquals(1, drop.stats().unexpectedPackets)
        assertEquals(1, drop.stats().wrongDestinationIpv4)
    }

    @Test fun anUnrelatedDestinationRemainsUnexpectedEvenWithAnAuthorizerWired() {
        val clock = FixedClock(0)
        val authorizer = WebsiteGatePacketAuthorizer("203.0.113.10", setOf("192.0.2.240"))
        val drop = PacketDropReporter("203.0.113.10", BlockedFlowDeduper(5_000, clock), { }, clock, authorizer)

        drop.onPacket(infoFor("198.51.100.7"), Ipv4PacketParser.Kind.IPV4)

        assertEquals(1, drop.stats().unexpectedPackets)
        assertEquals(1, drop.stats().wrongDestinationIpv4)
    }
}
