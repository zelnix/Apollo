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
 *
 * Battery fix (2026-10-29): a hostname that isn't in the local rule bundle is forwarded straight
 * away. It is never sent to Apollo's backend for a live reputation check from here: that check held
 * the single DNS thread for up to ~3 seconds (plus a rule refresh) for every new hostname the phone
 * looked up, which cost a network request, a wake-up and a notification each time. Blocking comes
 * from the signed local rule bundle only, which Apollo refreshes on its own schedule.
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

        // ── Step 1: Check local rule bundle (instant) ──
        val sinkholeIpv4 = bindingStore.arm(canonicalHost)
        if (sinkholeIpv4 != null) {
            // BLOCK match found in local rules — authoritative enforcement.
            return when (dnsQuery.qtype) {
                DnsQueryParser.TYPE_A -> DnsResponseSynthesizer.synthesizeSinkholeAnswer(queryPacket, dnsQuery, sinkholeIpv4)
                else -> DnsResponseSynthesizer.synthesizeNxDomain(queryPacket, dnsQuery)
            }
        }

        // ── Step 2: Not in the local rules: forward straight away (no remote check, no hold) ──
        return forward(queryPacket, rawBuffer, udpRange)
    }

    private fun forward(queryPacket: Ipv4PacketInfo, rawBuffer: ByteArray, udpRange: IntRange): ByteArray? =
        forwarder.forward(queryPacket, rawBuffer, udpRange)?.let { DnsResponseSynthesizer.wrapRawAnswer(queryPacket, it) }
}
