package com.guarddog.vpn

import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

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
 */
class ProtectedUdpDnsForwarder(
    private val upstreamResolver: InetAddress,
    private val upstreamPort: Int = 53,
    private val protector: SocketProtector,
    private val timeoutMillis: Int = 3_000,
    private val maxResponseBytes: Int = 4_096,
) : UpstreamDnsForwarder {
    override fun forward(queryPacket: Ipv4PacketInfo, rawQueryBuffer: ByteArray, udpPayloadRange: IntRange): ByteArray? {
        val socket = DatagramSocket()
        return try {
            if (!protector.protect(socket)) return null // fail open: never send un-protected (would loop into the TUN)
            socket.soTimeout = timeoutMillis
            val queryBytes = rawQueryBuffer.copyOfRange(udpPayloadRange.first, udpPayloadRange.last + 1)
            socket.send(DatagramPacket(queryBytes, queryBytes.size, upstreamResolver, upstreamPort))
            val responseBuffer = ByteArray(maxResponseBytes)
            val responsePacket = DatagramPacket(responseBuffer, responseBuffer.size)
            socket.receive(responsePacket)
            responseBuffer.copyOfRange(0, responsePacket.length)
        } catch (e: SocketTimeoutException) {
            null
        } catch (e: IOException) {
            null
        } finally {
            socket.close()
        }
    }
}
