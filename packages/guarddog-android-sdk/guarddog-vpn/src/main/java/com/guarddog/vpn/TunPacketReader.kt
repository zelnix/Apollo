package com.guarddog.vpn

import java.io.IOException
import java.io.InputStream

/**
 * Blocking TUN read loop. Reads raw IP packets from the TUN input stream (the
 * ParcelFileDescriptor's FileInputStream in production, any InputStream in tests),
 * parses the IPv4 header and hands every packet to [PacketDropReporter].
 *
 * Nothing is ever written back to the TUN or forwarded to a socket: every packet that
 * enters this loop is dropped by construction. Observation happens BEFORE the drop.
 */
class TunPacketReader(
    private val input: InputStream,
    private val dropReporter: PacketDropReporter,
    private val bufferSize: Int = 32 * 1024,
    private val onError: (IOException) -> Unit = {},
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
                dropReporter.onPacket(Ipv4PacketParser.parse(buffer, n))
            }
        } catch (e: IOException) {
            if (running) onError(e)
        }
    }
}
