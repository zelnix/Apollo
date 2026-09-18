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

    fun stop() { running = false }

    override fun run() {
        val buffer = ByteArray(bufferSize)
        try {
            while (running) {
                val n = input.read(buffer)
                if (n < 0) break
                if (n == 0) continue
                packetsRead++
                val info = Ipv4PacketParser.parse(buffer, n)
                if (dnsGateway != null && dnsGatewayIpv4 != null && DnsPacketClassifier.isDnsGatewayQuery(info, dnsGatewayIpv4)) {
                    val response = dnsGateway.handle(info!!, buffer, n)
                    if (response != null) output?.write(response)
                    continue
                }
                dropReporter.onPacket(info, Ipv4PacketParser.classify(buffer, n))
            }
        } catch (e: IOException) {
            if (running) onError(e)
        }
    }
}
