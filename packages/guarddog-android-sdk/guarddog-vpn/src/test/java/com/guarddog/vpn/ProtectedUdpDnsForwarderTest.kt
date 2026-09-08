package com.guarddog.vpn

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertNull

/**
 * Uses only java.net (no Android imports), so this exercises the real wire-format handling
 * against a local loopback fake resolver -- independent of the Phase 6 physical-device proof,
 * which additionally exercises the real android.net.VpnService.protect() call this class wraps.
 */
class ProtectedUdpDnsForwarderTest {
    private val alwaysProtect = SocketProtector { true }
    private val neverProtect = SocketProtector { false }

    private fun fakeQueryPacket() = Ipv4PacketInfo("10.255.255.5", "192.0.2.53", Ipv4PacketParser.PROTO_UDP, 60, 55123, 53)

    @Test fun forwardsToARealLocalResolverAndReturnsItsRawResponseUntouched() {
        val resolverSocket = DatagramSocket(0, InetAddress.getLoopbackAddress())
        val query = byteArrayOf(1, 2, 3, 4)
        val answer = byteArrayOf(5, 6, 7, 8, 9)
        val server = thread {
            val buf = ByteArray(512)
            val incoming = DatagramPacket(buf, buf.size)
            resolverSocket.receive(incoming)
            resolverSocket.send(DatagramPacket(answer, answer.size, incoming.address, incoming.port))
        }
        try {
            val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), resolverSocket.localPort, alwaysProtect, timeoutMillis = 2_000)
            val rawQuery = ByteArray(20) + query // fake 20-byte IP header prefix + the 4-byte "UDP payload"
            val result = forwarder.forward(fakeQueryPacket(), rawQuery, 20 until 24)
            server.join(2_000)
            assertContentEquals(answer, result)
        } finally {
            resolverSocket.close()
        }
    }

    @Test fun neverSendsWhenProtectFails() {
        val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), 5300, neverProtect, timeoutMillis = 200)
        val result = forwarder.forward(fakeQueryPacket(), ByteArray(24), 20 until 24)
        assertNull(result)
    }

    @Test fun timesOutAndFailsOpenByReturningNullWhenNothingIsListening() {
        val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), 1, alwaysProtect, timeoutMillis = 300)
        val result = forwarder.forward(fakeQueryPacket(), ByteArray(24), 20 until 24)
        assertNull(result)
    }
}
