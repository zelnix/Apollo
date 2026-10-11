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
 * Stage 3 — Live Reputation (additive, opt-in): When [liveChecker] is wired in, hostnames not in
 * the local rule bundle trigger a bounded live reputation check BEFORE DNS is forwarded upstream.
 * Protection Before Speed: the DNS handler holds for up to ~3 seconds while intelligence is
 * gathered. If the verdict is "malicious", NXDOMAIN is synthesized to prevent access. If "clean",
 * unknown, or timed out, DNS is forwarded normally (fail open).
 */
class DnsGatewayPacketHandler(
    private val bindingStore: SinkholeBindingStore,
    private val forwarder: UpstreamDnsForwarder,
    private val onUnsupported: (reason: String) -> Unit = {},
    /** Stage 3: Optional live reputation checker for unknown hostnames. Null = disabled. */
    private val liveChecker: LiveReputationChecker? = null,
    /** Stage 3: Optional notification callback for live check lifecycle events. */
    private val liveCheckNotifier: LiveCheckNotifier? = null,
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

        // ── Step 2: Live reputation check (bounded hold, opt-in) ──
        if (liveChecker != null) {
            return handleWithLiveCheck(canonicalHost, queryPacket, dnsQuery, rawBuffer, udpRange)
        }

        // ── No live checker: fail open, forward immediately ──
        return forward(queryPacket, rawBuffer, udpRange)
    }

    /**
     * Protection Before Speed: holds the DNS response while querying Apollo's backend for
     * a live reputation verdict on the unknown hostname.
     *
     * - "malicious" → NXDOMAIN (prevents the page from loading)
     * - "clean" / "unknown" / timeout → forward upstream (fail open)
     */
    private fun handleWithLiveCheck(
        hostname: String,
        queryPacket: Ipv4PacketInfo,
        dnsQuery: DnsQuery,
        rawBuffer: ByteArray,
        udpRange: IntRange,
    ): ByteArray? {
        // Notify: "Apollo is checking this website…"
        try { liveCheckNotifier?.onLiveCheckEvent(hostname, LiveCheckEvent.CheckStarted) } catch (_: Throwable) {}

        val verdict = try {
            liveChecker!!.checkBounded(hostname)
        } catch (e: Exception) {
            null
        }

        return if (verdict != null) {
            when (verdict.verdict) {
                "malicious" -> {
                    // Protection Before Speed: block access to known-malicious hostname.
                    // Synthesize NXDOMAIN — the user's browser will show a "can't reach site" error
                    // instead of loading a dangerous page.
                    notifyCompleted(hostname, verdict.verdict, verdict.confidence, blocked = true)
                    DnsResponseSynthesizer.synthesizeNxDomain(queryPacket, dnsQuery)
                }
                else -> {
                    // "clean", "unknown", "unavailable" — forward DNS normally.
                    notifyCompleted(hostname, verdict.verdict, verdict.confidence, blocked = false)
                    forward(queryPacket, rawBuffer, udpRange)
                }
            }
        } else {
            // Timeout or error — fail open, forward DNS without claiming it was checked.
            try { liveCheckNotifier?.onLiveCheckEvent(hostname, LiveCheckEvent.CheckTimedOut) } catch (_: Throwable) {}
            forward(queryPacket, rawBuffer, udpRange)
        }
    }

    private fun notifyCompleted(hostname: String, verdict: String, confidence: String, blocked: Boolean) {
        try {
            liveCheckNotifier?.onLiveCheckEvent(hostname, LiveCheckEvent.CheckCompleted(
                verdict = verdict,
                confidence = confidence,
                blocked = blocked,
            ))
        } catch (_: Throwable) { /* never crash the DNS handler for a notification failure */ }
    }

    private fun forward(queryPacket: Ipv4PacketInfo, rawBuffer: ByteArray, udpRange: IntRange): ByteArray? =
        forwarder.forward(queryPacket, rawBuffer, udpRange)?.let { DnsResponseSynthesizer.wrapRawAnswer(queryPacket, it) }
}
