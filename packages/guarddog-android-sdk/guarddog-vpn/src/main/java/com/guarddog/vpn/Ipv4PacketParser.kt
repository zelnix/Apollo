package com.guarddog.vpn

/** Minimal IPv4 header view for destination-based enforcement. */
data class Ipv4PacketInfo(
    val sourceIpv4: String,
    val destinationIpv4: String,
    val protocol: Int,
    val totalLength: Int,
    val sourcePort: Int?,
    val destinationPort: Int?,
) {
    /** Short-lived flow identity used for deduplication of TCP retries. */
    val flowKey: String get() = "$protocol/$sourceIpv4:${sourcePort ?: 0}->$destinationIpv4:${destinationPort ?: 0}"
}

object Ipv4PacketParser {
    const val PROTO_TCP = 6
    const val PROTO_UDP = 17

    /** Returns null for non-IPv4 (e.g. IPv6 on TUN) or truncated packets. */
    fun parse(buffer: ByteArray, length: Int): Ipv4PacketInfo? {
        if (length < 20 || buffer.size < length) return null
        val versionIhl = buffer[0].toInt() and 0xff
        if (versionIhl ushr 4 != 4) return null
        val ihl = (versionIhl and 0x0f) * 4
        if (ihl < 20 || length < ihl) return null
        val totalLength = ((buffer[2].toInt() and 0xff) shl 8) or (buffer[3].toInt() and 0xff)
        if (totalLength < ihl || totalLength > length) return null
        val protocol = buffer[9].toInt() and 0xff
        val src = ipv4At(buffer, 12)
        val dst = ipv4At(buffer, 16)
        var sport: Int? = null
        var dport: Int? = null
        if ((protocol == PROTO_TCP || protocol == PROTO_UDP) && length >= ihl + 4) {
            sport = ((buffer[ihl].toInt() and 0xff) shl 8) or (buffer[ihl + 1].toInt() and 0xff)
            dport = ((buffer[ihl + 2].toInt() and 0xff) shl 8) or (buffer[ihl + 3].toInt() and 0xff)
        }
        return Ipv4PacketInfo(src, dst, protocol, totalLength, sport, dport)
    }

    private fun ipv4At(b: ByteArray, offset: Int): String =
        "${b[offset].toInt() and 0xff}.${b[offset + 1].toInt() and 0xff}.${b[offset + 2].toInt() and 0xff}.${b[offset + 3].toInt() and 0xff}"
}
