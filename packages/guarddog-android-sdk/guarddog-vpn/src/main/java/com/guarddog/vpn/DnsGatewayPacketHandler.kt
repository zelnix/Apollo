package com.guarddog.vpn

import com.guarddog.core.net.HostCanonicalizer

/**
 * Gate Guard M2 Website Gate: the decision-wiring orchestrator for a single UDP/53 packet already
 * classified by [DnsPacketClassifier] as addressed to the virtual DNS endpoint. Composes the small
 * pieces -- [DnsQueryParser], [SinkholeBindingStore] (which itself calls into the shared-core
 * `GuardDogSDKEngine` for the actual rule decision), [DnsResponseSynthesizer], and
 * [UpstreamDnsForwarder] -- without duplicating any of their logic. Never itself produces
 * enforcement evidence: DNS is authorization input only.
 *
 * Fail-open by construction: any parse failure, canonicalization failure, or rejected arming falls
 * through to [forwarder] untouched. A BLOCK decision for an AAAA question never forwards (would
 * risk leaking the real IPv6 address of an already-adjudicated-BLOCK host) -- it answers NXDOMAIN
 * instead, since there is no IPv6 sinkhole pool in this frozen design.
 */
class DnsGatewayPacketHandler(
    private val bindingStore: SinkholeBindingStore,
    private val forwarder: UpstreamDnsForwarder,
    private val onUnsupported: (reason: String) -> Unit = {},
) {
    /** Returns the raw IPv4/UDP response packet to write back to the TUN, or null to send nothing at all (fail open by silence). */
    fun handle(queryPacket: Ipv4PacketInfo, rawBuffer: ByteArray, length: Int): ByteArray? {
        val udpRange = Ipv4PacketParser.udpPayloadRange(rawBuffer, length) ?: run {
            onUnsupported("not a well-formed UDP/IPv4 packet")
            return null
        }
        val dnsQuery = DnsQueryParser.parse(rawBuffer, udpRange.first, udpRange.last - udpRange.first + 1)
        if (dnsQuery == null) {
            onUnsupported("unparseable or unsupported DNS query shape")
            return forward(queryPacket, rawBuffer, udpRange)
        }
        val canonicalHost = HostCanonicalizer.canonicalize(dnsQuery.qname)
        if (canonicalHost == null) {
            onUnsupported("host failed canonicalization")
            return forward(queryPacket, rawBuffer, udpRange)
        }
        val sinkholeIpv4 = bindingStore.arm(canonicalHost)
        if (sinkholeIpv4 == null) {
            // allow / warn / unknown / provider-unavailable: fail open, forward the REAL query untouched.
            return forward(queryPacket, rawBuffer, udpRange)
        }
        return when (dnsQuery.qtype) {
            DnsQueryParser.TYPE_A -> DnsResponseSynthesizer.synthesizeSinkholeAnswer(queryPacket, dnsQuery, sinkholeIpv4)
            else -> DnsResponseSynthesizer.synthesizeNxDomain(queryPacket, dnsQuery) // AAAA: never leak a real IPv6 answer for a BLOCK host
        }
    }

    private fun forward(queryPacket: Ipv4PacketInfo, rawBuffer: ByteArray, udpRange: IntRange): ByteArray? =
        forwarder.forward(queryPacket, rawBuffer, udpRange)?.let { DnsResponseSynthesizer.wrapRawAnswer(queryPacket, it) }
}
