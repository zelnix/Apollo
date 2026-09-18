package com.guarddog.vpn

/** A single, cleanly-parsed DNS question. See [DnsQueryParser.parse] for exactly what is (and isn't) accepted. */
data class DnsQuery(
    val transactionId: Int,
    /** Raw ASCII label sequence joined by '.', NOT yet canonicalized (see com.guarddog.core.net.HostCanonicalizer). */
    val qname: String,
    val qtype: Int,
    val qclass: Int,
)

/**
 * Gate Guard M2 Website Gate: parses the DNS message carried in the UDP payload of a packet
 * [DnsPacketClassifier] already confirmed is addressed to the virtual DNS endpoint.
 *
 * Deliberately narrow. Returns null (never throws) for anything that isn't a single-question,
 * standard query (QR=0, OPCODE=0), IN-class A/AAAA request with an uncompressed question name --
 * every such case is treated as "unsupported" by the caller and falls open to the untouched
 * upstream forward path, never blocked, never synthesized. This mirrors the disclosed
 * DoH/DoT-bypass limitation already documented in docs/M2_WEBSITE_GATE_DESIGN.md: Apollo only
 * ever narrows what it can helpfully intercept, never widens enforcement by guessing.
 */
object DnsQueryParser {
    const val TYPE_A = 1
    const val TYPE_AAAA = 28
    const val CLASS_IN = 1
    private const val MAX_NAME_LENGTH = 253
    private const val MAX_LABEL_LENGTH = 63

    fun parse(message: ByteArray, offset: Int, length: Int): DnsQuery? {
        if (length < 12 || offset < 0 || offset + length > message.size) return null
        val end = offset + length
        fun u8(i: Int) = message[i].toInt() and 0xff
        fun u16(i: Int) = (u8(i) shl 8) or u8(i + 1)

        val transactionId = u16(offset)
        val flags = u16(offset + 2)
        val qr = (flags ushr 15) and 0x1
        val opcode = (flags ushr 11) and 0xf
        if (qr != 0 || opcode != 0) return null // not a standard query: fail open, never guess

        val qdcount = u16(offset + 4)
        if (qdcount != 1) return null // exactly one question supported; anything else falls open

        var pos = offset + 12
        val labels = ArrayList<String>()
        var totalNameLen = 0
        while (true) {
            if (pos >= end) return null
            val lenByte = u8(pos)
            if (lenByte == 0) { pos++; break }
            if (lenByte and 0xC0 != 0) return null // compression pointer in a question name: unsupported
            if (lenByte > MAX_LABEL_LENGTH) return null
            pos++
            if (pos + lenByte > end) return null
            labels.add(String(message, pos, lenByte, Charsets.US_ASCII))
            totalNameLen += lenByte + 1
            pos += lenByte
            if (totalNameLen > MAX_NAME_LENGTH) return null
        }
        if (pos + 4 > end) return null
        val qtype = u16(pos)
        val qclass = u16(pos + 2)
        if (qclass != CLASS_IN) return null
        if (qtype != TYPE_A && qtype != TYPE_AAAA) return null
        val qname = labels.joinToString(".")
        if (qname.isEmpty()) return null
        return DnsQuery(transactionId, qname, qtype, qclass)
    }
}
