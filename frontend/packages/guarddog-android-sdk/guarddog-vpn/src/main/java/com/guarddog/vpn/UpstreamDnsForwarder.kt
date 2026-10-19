package com.guarddog.vpn

/**
 * Gate Guard M2 Website Gate: sends a DNS query byte-for-byte to a real upstream resolver over a
 * path that bypasses the Apollo tunnel, and returns the raw response untouched, or null on
 * timeout/failure. Null is fail-open by silence -- the querying app simply sees no answer, exactly
 * as if Apollo were not installed, never a fabricated failure signal.
 *
 * Used for every verdict that is NOT a website-gate BLOCK (allow, warn, unknown, provider
 * unavailable) -- the DNS gateway must service ordinary browsing, not merely arm blocks.
 */
fun interface UpstreamDnsForwarder {
    fun forward(queryPacket: Ipv4PacketInfo, rawQueryBuffer: ByteArray, udpPayloadRange: IntRange): ByteArray?
}
