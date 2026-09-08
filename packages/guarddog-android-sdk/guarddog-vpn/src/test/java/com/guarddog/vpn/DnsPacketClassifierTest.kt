package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DnsPacketClassifierTest {
    private val gateway = "192.0.2.53"

    @Test fun recognizesUdp53ToTheGateway() {
        val info = Ipv4PacketInfo("10.0.0.5", gateway, Ipv4PacketParser.PROTO_UDP, 60, 5353, 53)
        assertTrue(DnsPacketClassifier.isDnsGatewayQuery(info, gateway))
    }

    @Test fun rejectsWrongPort() {
        val info = Ipv4PacketInfo("10.0.0.5", gateway, Ipv4PacketParser.PROTO_UDP, 60, 5353, 853)
        assertFalse(DnsPacketClassifier.isDnsGatewayQuery(info, gateway))
    }

    @Test fun rejectsWrongDestination() {
        val info = Ipv4PacketInfo("10.0.0.5", "192.0.2.240", Ipv4PacketParser.PROTO_UDP, 60, 5353, 53)
        assertFalse(DnsPacketClassifier.isDnsGatewayQuery(info, gateway))
    }

    @Test fun rejectsTcp() {
        val info = Ipv4PacketInfo("10.0.0.5", gateway, Ipv4PacketParser.PROTO_TCP, 60, 5353, 53)
        assertFalse(DnsPacketClassifier.isDnsGatewayQuery(info, gateway))
    }

    @Test fun rejectsNullInfo() {
        assertFalse(DnsPacketClassifier.isDnsGatewayQuery(null, gateway))
    }
}
