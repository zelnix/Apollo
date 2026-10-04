package com.guarddog.vpn

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Blocking TUN read loop. Reads raw IP packets from the TUN input stream (the
 * ParcelFileDescriptor's FileInputStream in production, any InputStream in tests),
 * parses the IPv4 header and hands every packet to [PacketDropReporter].
 *
 * M1 invariant, unchanged: with [dnsGateway] null (the default), every packet that enters this
 * loop is dropped by construction -- nothing is ever written back to the TUN or forwarded to a
 * socket. Observation happens BEFORE the drop.
 *
 * Gate Guard M2 Website Gate (additive, opt-in): when [dnsGateway]/[dnsGatewayIpv4]/[output] are
 * all wired in, a packet addressed to the fixed virtual DNS endpoint is routed to [dnsGateway]
 * instead of [dropReporter], and any response bytes it returns are the ONLY thing this class ever
 * writes back into the tunnel. Every other packet -- including the M1 controlled destination and
 * the M2 sinkhole pool -- still goes through [dropReporter] exactly as before.
 *
 * DNS forwarding runs on a separate thread (via [dnsExecutor]) to prevent slow upstream queries
 * from blocking the tunnel reader. The reader thread only handles packet classification and drop
 * reporting; DNS responses are written back to the TUN by the executor thread.
 */
class TunPacketReader(
    private val input: InputStream,
    private val dropReporter: PacketDropReporter,
    private val bufferSize: Int = 32 * 1024,
    private val onError: (IOException) -> Unit = {},
    private val output: OutputStream? = null,
    private val dnsGatewayIpv4: String? = null,
    private val dnsGateway: DnsGatewayPacketHandler? = null,
) : Runnable {
    @Volatile private var running = true
    @Volatile var packetsRead: Long = 0
        private set

    // Single-thread executor for DNS forwarding so slow queries don't block the TUN reader.
    private val dnsExecutor: java.util.concurrent.ExecutorService? =
        if (dnsGateway != null) java.util.concurrent.Executors.newSingleThreadExecutor { r ->
            Thread(r, "guarddog-dns-forwarder").apply { isDaemon = true }
        } else null

    fun stop() {
        running = false
        dnsExecutor?.shutdownNow()
    }

    override fun run() {
        val buffer = ByteArray(bufferSize)
        try {
            while (running) {
                val n = input.read(buffer)
                if (n < 0) {
                    // End-of-stream: the TUN fd was closed. This is a terminal failure equivalent
                    // to an IOException — protection is no longer active. Invoke onError so the
                    // lifecycle observer can react (e.g. restart or report degraded state).
                    if (running) onError(IOException("TUN input stream reached end-of-stream unexpectedly"))
                    break
                }
                if (n == 0) continue
                packetsRead++
                val info = Ipv4PacketParser.parse(buffer, n)
                if (dnsGateway != null && dnsGatewayIpv4 != null && DnsPacketClassifier.isDnsGatewayQuery(info, dnsGatewayIpv4)) {
                    // Copy the packet data for the DNS executor thread (buffer is reused by reader).
                    val packetCopy = buffer.copyOfRange(0, n)
                    val infoCopy = info
                    dnsExecutor?.submit {
                        try {
                            val response = dnsGateway.handle(infoCopy!!, packetCopy, n)
                            if (response != null) {
                                synchronized(output ?: return@submit) {
                                    output.write(response)
                                }
                            }
                        } catch (_: Exception) {
                            // DNS forwarding failure is non-fatal; the query simply times out.
                        }
                    }
                    continue
                }
                dropReporter.onPacket(info, Ipv4PacketParser.classify(buffer, n))
            }
        } catch (e: IOException) {
            if (running) onError(e)
        } finally {
            dnsExecutor?.shutdownNow()
        }
    }
}
