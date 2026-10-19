package com.guarddog.vpn

/**
 * Gate Guard M2 Website Gate: the very first, cheapest classification step in the DNS/sinkhole
 * pipeline. Answers exactly one question -- is this parsed IPv4 packet a UDP/53 query addressed to
 * the fixed Apollo virtual DNS endpoint? Nothing else in the M2 pipeline (DnsQueryParser,
 * SinkholeBindingStore, DnsResponseSynthesizer, the forwarder) ever runs unless this says yes.
 *
 * Everything that is NOT a DNS gateway query -- the M1 controlled destination, the M2 sinkhole
 * pool, and truly unrelated traffic -- continues down the existing, unmodified
 * [PacketDropReporter] path. This class never drops, never reports, never authorizes anything;
 * it only routes a packet to the right handler.
 */
object DnsPacketClassifier {
    const val DNS_PORT = 53

    fun isDnsGatewayQuery(info: Ipv4PacketInfo?, dnsGatewayIpv4: String): Boolean =
        info != null &&
            info.protocol == Ipv4PacketParser.PROTO_UDP &&
            info.destinationIpv4 == dnsGatewayIpv4 &&
            info.destinationPort == DNS_PORT
}
