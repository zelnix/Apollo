package com.guarddog.vpn

import java.io.Closeable
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Real Android implementation of [UpstreamDnsForwarder]: sends the untouched DNS query to a fixed
 * upstream resolver over a [protector]-protected UDP socket and returns the raw response.
 *
 * Requires a physical/emulator Android runtime (`VpnService.protect`, real sockets) to actually
 * exercise the network path -- not meaningfully unit-testable against the real Internet in a
 * plain JVM. Exercised end-to-end by the Phase 6 physical-device proof. The class itself uses only
 * `java.net`/`java.io` (no Android imports), so it compiles and can still be unit-tested against a
 * local loopback fake resolver (see ProtectedUdpDnsForwarderTest) to prove the wire-format handling
 * is correct, independent of the real device proof.
 *
 * Battery fix (2026-10-29): one protected, connected socket is reused for every query instead of
 * creating, protecting and closing a new [DatagramSocket] per lookup. The socket is replaced only
 * after a timeout or socket error (so a socket left on a network that went away never keeps timing
 * out), and [close] releases it when the TUN session ends.
 */
class ProtectedUdpDnsForwarder(
    private val upstreamResolver: InetAddress,
    private val upstreamPort: Int = 53,
    private val protector: SocketProtector,
    private val timeoutMillis: Int = 3_000,
    private val maxResponseBytes: Int = 4_096,
) : UpstreamDnsForwarder, Closeable {
    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var closed = false
    private val responseBuffer = ByteArray(maxResponseBytes)

    @Synchronized
    override fun forward(queryPacket: Ipv4PacketInfo, rawQueryBuffer: ByteArray, udpPayloadRange: IntRange): ByteArray? {
        val queryBytes = rawQueryBuffer.copyOfRange(udpPayloadRange.first, udpPayloadRange.last + 1)
        // Extract the DNS transaction ID (first 2 bytes) from the query for response validation.
        if (queryBytes.size < 2) return null
        val queryTxId = transactionId(queryBytes)
        val active = openSocket() ?: return null // fail open: never send un-protected (would loop into the TUN)
        try {
            active.send(DatagramPacket(queryBytes, queryBytes.size))
            val deadline = System.currentTimeMillis() + timeoutMillis
            while (true) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) break
                active.soTimeout = remaining.toInt().coerceAtLeast(1)
                val responsePacket = DatagramPacket(responseBuffer, responseBuffer.size)
                active.receive(responsePacket)
                // Validate the response: at least 2 bytes and the transaction ID must match the query.
                // On a reused socket a late answer to an earlier query can arrive first: skip it
                // (never hand it back) and keep waiting for this query's own answer.
                if (responsePacket.length >= 2 && transactionId(responseBuffer) == queryTxId) {
                    return responseBuffer.copyOfRange(0, responsePacket.length)
                }
            }
        } catch (e: IOException) {
            // Timeout (SocketTimeoutException) or socket error: fall through and fail open.
        }
        drop()
        return null
    }

    /** Releases the socket. Never waits for a query in progress: closing the socket ends its wait. */
    override fun close() {
        closed = true
        socket?.close()
        socket = null
    }

    private fun openSocket(): DatagramSocket? {
        if (closed) return null
        socket?.let { return it }
        val fresh = try { DatagramSocket() } catch (e: IOException) { return null }
        try {
            if (!protector.protect(fresh)) { fresh.close(); return null }
            // Connect the socket to the resolver endpoint so receive() only accepts datagrams
            // from the expected source — prevents forged responses from arbitrary senders.
            fresh.connect(upstreamResolver, upstreamPort)
        } catch (e: Exception) {
            fresh.close()
            return null
        }
        socket = fresh
        if (closed) { drop(); return null } // closed while this socket was being opened
        return fresh
    }

    private fun drop() {
        socket?.close()
        socket = null
    }

    private fun transactionId(bytes: ByteArray): Int = ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
}
