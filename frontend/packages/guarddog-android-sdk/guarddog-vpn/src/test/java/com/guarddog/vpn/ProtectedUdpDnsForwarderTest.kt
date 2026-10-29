package com.guarddog.vpn

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
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
        val answer = byteArrayOf(1, 2, 7, 8, 9) // same transaction ID as the query (0x0102), or it is rejected
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

    // Battery fix: one socket for every query, not a new socket per lookup.
    @Test fun reusesOneSocketForEveryQuery() {
        val resolverSocket = DatagramSocket(0, InetAddress.getLoopbackAddress())
        val ports = mutableListOf<Int>()
        val server = thread {
            repeat(2) {
                val buf = ByteArray(512)
                val incoming = DatagramPacket(buf, buf.size)
                resolverSocket.receive(incoming)
                ports.add(incoming.port)
                // Echo the query back: same transaction ID, so it is accepted as the answer.
                resolverSocket.send(DatagramPacket(buf, incoming.length, incoming.address, incoming.port))
            }
        }
        val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), resolverSocket.localPort, alwaysProtect, timeoutMillis = 2_000)
        try {
            val query = ByteArray(20) + byteArrayOf(7, 7, 1, 2)
            assertContentEquals(byteArrayOf(7, 7, 1, 2), forwarder.forward(fakeQueryPacket(), query, 20 until 24))
            assertContentEquals(byteArrayOf(7, 7, 1, 2), forwarder.forward(fakeQueryPacket(), query, 20 until 24))
            server.join(2_000)
            assertEquals(2, ports.size)
            assertEquals(ports[0], ports[1])
        } finally {
            forwarder.close()
            resolverSocket.close()
        }
    }

    @Test fun skipsALateAnswerToAnEarlierQueryAndReturnsThisQuerysOwnAnswer() {
        val resolverSocket = DatagramSocket(0, InetAddress.getLoopbackAddress())
        val stale = byteArrayOf(0, 1, 9, 9) // transaction ID 0x0001 (an earlier query)
        val own = byteArrayOf(0, 2, 5, 5)   // transaction ID 0x0002 (this query)
        val server = thread {
            val buf = ByteArray(512)
            val incoming = DatagramPacket(buf, buf.size)
            resolverSocket.receive(incoming)
            resolverSocket.send(DatagramPacket(stale, stale.size, incoming.address, incoming.port))
            resolverSocket.send(DatagramPacket(own, own.size, incoming.address, incoming.port))
        }
        val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), resolverSocket.localPort, alwaysProtect, timeoutMillis = 2_000)
        try {
            val result = forwarder.forward(fakeQueryPacket(), ByteArray(20) + byteArrayOf(0, 2, 1, 1), 20 until 24)
            server.join(2_000)
            assertContentEquals(own, result)
        } finally {
            forwarder.close()
            resolverSocket.close()
        }
    }

    @Test fun opensNoSocketAfterClose() {
        var protects = 0
        val counting = SocketProtector { protects++; true }
        val forwarder = ProtectedUdpDnsForwarder(InetAddress.getLoopbackAddress(), 5300, counting, timeoutMillis = 200)
        forwarder.close()
        assertNull(forwarder.forward(fakeQueryPacket(), ByteArray(24), 20 until 24))
        assertEquals(0, protects)
    }
}
