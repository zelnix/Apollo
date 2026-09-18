package com.guarddog.vpn

import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Harness-only diagnostic (NOT part of the public SDK surface, never used by enforcement).
 *
 * Outcome of ONE fresh-connection probe of the controlled endpoint: which phase was reached and how it ended.
 * Privacy: the only address ever recorded is the configured controlled IPv4 (echoed back when it was the address connected to);
 * other resolved addresses are counted, never listed.
 */
data class FreshProbeResult(
    val expectedIpv4: String,
    /** The address the new socket actually connected to (always the configured IPv4) or null when DNS did not yield it. */
    val resolvedIpv4: String?,
    val phase: String,
    val outcome: String,
    val httpStatus: Int?,
    val elapsedMs: Long,
    val detail: String,
) {
    /**
     * The ONLY network-level shape consistent with the SYN having been routed into the /32 TUN and dropped there:
     * DNS still worked (not intercepted), the new socket targeted the configured IPv4 and the TCP connect timed out.
     * DNS failure, another address, refused/unreachable, TLS or HTTP failures are NOT evidence of enforcement.
     */
    val isSynDropShape: Boolean
        get() = phase == FreshConnectionProbe.PHASE_TCP && outcome == FreshConnectionProbe.OUTCOME_TIMEOUT && resolvedIpv4 == expectedIpv4

    fun toMap(): Map<String, Any?> = mapOf(
        "freshSocket" to true, "expectedIpv4" to expectedIpv4, "resolvedIpv4" to resolvedIpv4, "phase" to phase, "outcome" to outcome,
        "httpStatus" to httpStatus, "elapsedMs" to elapsedMs, "detail" to detail, "synDropShape" to isSynDropShape,
    )
}

/**
 * Opens a BRAND-NEW TCP socket for every call (never a pooled HTTP-client connection), performs the TLS handshake on it with the
 * original hostname (SNI + certificate hostname verification) and issues a single `GET` with `Connection: close`.
 * The socket is deliberately NOT passed to VpnService.protect(): it must stay subject to Guard Dog's own /32 route so that a probe
 * issued while protection is ACTIVE exercises the very packet path the proof is about.
 */
object FreshConnectionProbe {
    const val PHASE_DNS = "dns"
    const val PHASE_TCP = "tcp-connect"
    const val PHASE_TLS = "tls-handshake"
    const val PHASE_HTTP = "http"

    const val OUTCOME_OK = "ok"
    const val OUTCOME_TIMEOUT = "timeout"
    const val OUTCOME_REFUSED = "refused"
    const val OUTCOME_UNREACHABLE = "unreachable"
    const val OUTCOME_DNS_FAILED = "dns-failed"
    const val OUTCOME_TLS_FAILED = "tls-failed"
    const val OUTCOME_HTTP_ERROR = "http-error"
    const val OUTCOME_ERROR = "error"

    fun run(
        url: String,
        expectedIpv4: String,
        timeoutMs: Int,
        resolver: HostResolver = SystemHostResolver,
        sslFactory: SSLSocketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory,
        clock: () -> Long = System::currentTimeMillis,
    ): FreshProbeResult {
        val started = clock()
        val uri = URI(url)
        val host = requireNotNull(uri.host) { "probe url has no host" }
        val tls = uri.scheme.equals("https", ignoreCase = true)
        val port = if (uri.port > 0) uri.port else if (tls) 443 else 80
        val path = uri.rawPath.ifEmpty { "/" } + (uri.rawQuery?.let { "?$it" } ?: "")
        fun result(resolved: String?, phase: String, outcome: String, status: Int?, detail: String) =
            FreshProbeResult(expectedIpv4, resolved, phase, outcome, status, clock() - started, detail)

        // 1. DNS (system resolver, never intercepted): the configured IPv4 must be among the answers and is the ONLY address we connect to.
        val resolved = resolver.resolveIpv4(host)
        if (expectedIpv4 !in resolved) {
            return result(null, PHASE_DNS, OUTCOME_DNS_FAILED, null, "resolved ${resolved.size} IPv4 address(es); configured controlled IPv4 not among them")
        }

        // 2. New TCP socket → configured IPv4. A SYN dropped inside the TUN can only surface here as a connect timeout.
        val tcp = Socket()
        try {
            try {
                tcp.connect(InetSocketAddress(InetAddress.getByName(expectedIpv4), port), timeoutMs)
                tcp.soTimeout = timeoutMs
            } catch (e: SocketTimeoutException) {
                return result(expectedIpv4, PHASE_TCP, OUTCOME_TIMEOUT, null, "TCP connect to configured IPv4:$port timed out after ${timeoutMs}ms")
            } catch (e: NoRouteToHostException) {
                return result(expectedIpv4, PHASE_TCP, OUTCOME_UNREACHABLE, null, "TCP connect: ${e.message}")
            } catch (e: ConnectException) {
                val m = e.message ?: ""
                val outcome = when {
                    m.contains("refused", ignoreCase = true) -> OUTCOME_REFUSED
                    m.contains("unreachable", ignoreCase = true) -> OUTCOME_UNREACHABLE
                    m.contains("timed out", ignoreCase = true) || m.contains("ETIMEDOUT", ignoreCase = true) -> OUTCOME_TIMEOUT
                    else -> OUTCOME_ERROR
                }
                return result(expectedIpv4, PHASE_TCP, outcome, null, "TCP connect: $m")
            } catch (e: IOException) {
                return result(expectedIpv4, PHASE_TCP, OUTCOME_ERROR, null, "TCP connect: ${e.message}")
            }

            // 3. TLS on that same socket, keeping the canonical hostname for SNI and certificate hostname verification.
            val stream: Socket = if (tls) {
                try {
                    val ssl = sslFactory.createSocket(tcp, host, port, true) as SSLSocket
                    ssl.soTimeout = timeoutMs
                    ssl.startHandshake()
                    if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.session)) {
                        return result(expectedIpv4, PHASE_TLS, OUTCOME_TLS_FAILED, null, "certificate does not match $host")
                    }
                    ssl
                } catch (e: SocketTimeoutException) {
                    return result(expectedIpv4, PHASE_TLS, OUTCOME_TIMEOUT, null, "TLS handshake timed out after ${timeoutMs}ms")
                } catch (e: SSLException) {
                    return result(expectedIpv4, PHASE_TLS, OUTCOME_TLS_FAILED, null, "TLS handshake: ${e.message}")
                } catch (e: IOException) {
                    return result(expectedIpv4, PHASE_TLS, OUTCOME_TLS_FAILED, null, "TLS handshake: ${e.message}")
                }
            } else tcp

            // 4. One request, connection closed by both sides afterwards (nothing is left for anyone to reuse).
            return try {
                stream.getOutputStream().write("GET $path HTTP/1.1\r\nHost: $host\r\nConnection: close\r\nUser-Agent: GuardDog-M1-FreshProbe\r\n\r\n".toByteArray())
                stream.getOutputStream().flush()
                val status = readStatusCode(stream)
                if (status == null) result(expectedIpv4, PHASE_HTTP, OUTCOME_HTTP_ERROR, null, "no HTTP status line")
                else if (status in 200..299) result(expectedIpv4, PHASE_HTTP, OUTCOME_OK, status, "HTTP $status over a fresh TCP${if (tls) "+TLS" else ""} connection")
                else result(expectedIpv4, PHASE_HTTP, OUTCOME_HTTP_ERROR, status, "HTTP $status")
            } catch (e: SocketTimeoutException) {
                result(expectedIpv4, PHASE_HTTP, OUTCOME_TIMEOUT, null, "HTTP exchange timed out after ${timeoutMs}ms")
            } catch (e: IOException) {
                result(expectedIpv4, PHASE_HTTP, OUTCOME_HTTP_ERROR, null, "HTTP exchange: ${e.message}")
            }
        } finally {
            try { tcp.close() } catch (_: IOException) { }
        }
    }

    /** Reads the first response line and returns its status code (`HTTP/1.x NNN ...`). */
    internal fun readStatusCode(socket: Socket): Int? {
        val input = socket.getInputStream()
        val line = StringBuilder()
        while (line.length < 512) {
            val b = input.read()
            if (b < 0) break
            if (b == '\n'.code) break
            if (b != '\r'.code) line.append(b.toChar())
        }
        val parts = line.toString().split(' ')
        if (parts.size < 2 || !parts[0].startsWith("HTTP/")) return null
        return parts[1].toIntOrNull()
    }
}
