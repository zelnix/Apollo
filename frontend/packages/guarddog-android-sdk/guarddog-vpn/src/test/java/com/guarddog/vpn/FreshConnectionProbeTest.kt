package com.guarddog.vpn

import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Fresh-connection probe (harness instrumentation). Fully offline: loopback servers only, DNS injected through [HostResolver].
 * The probe must (1) connect only to the configured IPv4, (2) report the phase it reached, (3) never list unrelated addresses,
 * and (4) recognise exactly one shape — TCP connect timeout to the configured IPv4 — as consistent with a SYN dropped in the TUN.
 */
class FreshConnectionProbeTest {
    private val loopback = HostResolver { listOf("127.0.0.1") }

    /** Minimal loopback responder: optionally reads the request head, answers with [response], closes. */
    private fun serve(response: String, readRequest: Boolean = true, onRequest: (String) -> Unit = {}): ServerSocket {
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            try {
                server.accept().use { s ->
                    if (readRequest) onRequest(readHead(s))
                    s.getOutputStream().write(response.toByteArray())
                    s.getOutputStream().flush()
                }
            } catch (_: IOException) { }
        }
        return server
    }

    private fun readHead(s: Socket): String {
        val input = s.getInputStream()
        val sb = StringBuilder()
        while (!sb.endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0) break
            sb.append(b.toChar())
        }
        return sb.toString()
    }

    @Test fun plainHttp200OverAFreshSocketReportsHttpOk() {
        var request = ""
        val server = serve("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n") { request = it }
        server.use {
            val r = FreshConnectionProbe.run("http://probe.test:${it.localPort}/", "127.0.0.1", 2_000, loopback)
            assertEquals(FreshConnectionProbe.PHASE_HTTP, r.phase)
            assertEquals(FreshConnectionProbe.OUTCOME_OK, r.outcome)
            assertEquals(200, r.httpStatus)
            assertEquals("127.0.0.1", r.resolvedIpv4)
            assertFalse(r.isSynDropShape)
        }
        assertTrue(request.startsWith("GET / HTTP/1.1\r\n"), request)
        assertTrue(request.contains("Host: probe.test\r\n"), "original hostname must be kept for the server")
        assertTrue(request.contains("Connection: close\r\n"), "no connection may be left for reuse")
    }

    @Test fun non2xxIsAnHttpErrorNotProof() {
        serve("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n").use {
            val r = FreshConnectionProbe.run("http://probe.test:${it.localPort}/", "127.0.0.1", 2_000, loopback)
            assertEquals(FreshConnectionProbe.PHASE_HTTP, r.phase)
            assertEquals(FreshConnectionProbe.OUTCOME_HTTP_ERROR, r.outcome)
            assertEquals(503, r.httpStatus)
            assertFalse(r.isSynDropShape)
        }
    }

    @Test fun refusedConnectIsNotTheSynDropShape() {
        val port = ServerSocket(0).use { it.localPort } // closed again: nothing listens
        val r = FreshConnectionProbe.run("http://probe.test:$port/", "127.0.0.1", 2_000, loopback)
        assertEquals(FreshConnectionProbe.PHASE_TCP, r.phase)
        assertEquals(FreshConnectionProbe.OUTCOME_REFUSED, r.outcome)
        assertNull(r.httpStatus)
        assertFalse(r.isSynDropShape) // a RST came back: the packet was NOT dropped
    }

    @Test fun tlsAgainstAPlainServerReachesTheTlsPhaseAndFails() {
        // The plain server answers the ClientHello with an HTTP line: the client sees a non-TLS record and fails the handshake.
        serve("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n", readRequest = false).use {
            val r = FreshConnectionProbe.run("https://probe.test:${it.localPort}/", "127.0.0.1", 2_000, loopback)
            assertEquals(FreshConnectionProbe.PHASE_TLS, r.phase) // TCP connected — so traffic was NOT blocked
            assertEquals(FreshConnectionProbe.OUTCOME_TLS_FAILED, r.outcome)
            assertFalse(r.isSynDropShape)
        }
    }

    @Test fun dnsWithoutTheConfiguredIpv4FailsBeforeAnySocketAndListsNoAddresses() {
        val r = FreshConnectionProbe.run("https://probe.test/", "52.25.179.131", 2_000, HostResolver { listOf("198.51.100.7", "198.51.100.8") })
        assertEquals(FreshConnectionProbe.PHASE_DNS, r.phase)
        assertEquals(FreshConnectionProbe.OUTCOME_DNS_FAILED, r.outcome)
        assertNull(r.resolvedIpv4)
        assertFalse(r.detail.contains("198.51.100"), "unrelated addresses must never be recorded: ${r.detail}")
        assertTrue(r.detail.contains("2 IPv4 address(es)"))
        assertFalse(r.isSynDropShape)
        val empty = FreshConnectionProbe.run("https://probe.test/", "52.25.179.131", 2_000, HostResolver { emptyList() })
        assertEquals(FreshConnectionProbe.OUTCOME_DNS_FAILED, empty.outcome)
    }

    @Test fun onlyTcpConnectTimeoutToTheConfiguredIpv4CountsAsSynDrop() {
        fun shape(phase: String, outcome: String, resolved: String?) =
            FreshProbeResult("52.25.179.131", resolved, phase, outcome, null, 6_000, "").isSynDropShape
        assertTrue(shape(FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_TIMEOUT, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_TIMEOUT, null))
        assertFalse(shape(FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_REFUSED, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_UNREACHABLE, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_ERROR, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_DNS, FreshConnectionProbe.OUTCOME_DNS_FAILED, null))
        assertFalse(shape(FreshConnectionProbe.PHASE_TLS, FreshConnectionProbe.OUTCOME_TIMEOUT, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_TLS, FreshConnectionProbe.OUTCOME_TLS_FAILED, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_HTTP, FreshConnectionProbe.OUTCOME_TIMEOUT, "52.25.179.131"))
        assertFalse(shape(FreshConnectionProbe.PHASE_HTTP, FreshConnectionProbe.OUTCOME_HTTP_ERROR, "52.25.179.131"))
        assertEquals(true, FreshProbeResult("52.25.179.131", "52.25.179.131", FreshConnectionProbe.PHASE_TCP, FreshConnectionProbe.OUTCOME_TIMEOUT, null, 6_000, "").toMap()["synDropShape"])
    }
}
