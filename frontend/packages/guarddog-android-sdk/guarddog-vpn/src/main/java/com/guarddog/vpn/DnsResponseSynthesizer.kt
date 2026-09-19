package com.guarddog.vpn

/**
 * Gate Guard M2 Website Gate: the only place in Apollo's M1+M2 adapter that constructs bytes to
 * write BACK into the TUN (M1 never writes anything back -- every M1 packet is dropped by
 * construction). Builds raw IPv4/UDP packets carrying a DNS response, addressed from the query's
 * destination (the virtual DNS endpoint) back to the query's source (the requesting app),
 * preserving the original transaction id and question section so the app's resolver stub accepts
 * the answer as genuine.
 */
object DnsResponseSynthesizer {
    private const val DNS_PORT = 53
    private const val TTL_SECONDS = 30 // short: matches the short-lived WebsiteGateBinding lifetime
    private const val RCODE_NXDOMAIN = 3

    /** BLOCK, A-record query: answers with the bound sinkhole IPv4 -- never the hostile domain's real address. */
    fun synthesizeSinkholeAnswer(query: Ipv4PacketInfo, dnsQuery: DnsQuery, sinkholeIpv4: String): ByteArray {
        val message = buildAnswerMessage(dnsQuery, rdata = ipv4ToBytes(sinkholeIpv4), rdType = DnsQueryParser.TYPE_A)
        return wrapUdp(query, message)
    }

    /** BLOCK, AAAA-record query: NXDOMAIN. A hostname already adjudicated BLOCK must never leak a
     * genuine IPv6 address just because Apollo has no IPv6 sinkhole pool (frozen design decision). */
    fun synthesizeNxDomain(query: Ipv4PacketInfo, dnsQuery: DnsQuery): ByteArray {
        val message = header(dnsQuery.transactionId, rcode = RCODE_NXDOMAIN, ancount = 0) + questionSection(dnsQuery)
        return wrapUdp(query, message)
    }

    /** ALLOW/WARN/UNKNOWN/unavailable: wraps an upstream resolver's untouched raw response for delivery back into the TUN. Fail open -- the bytes are never inspected or modified. */
    fun wrapRawAnswer(query: Ipv4PacketInfo, rawUpstreamResponse: ByteArray): ByteArray = wrapUdp(query, rawUpstreamResponse)

    private fun buildAnswerMessage(q: DnsQuery, rdata: ByteArray, rdType: Int): ByteArray {
        val headerBytes = header(q.transactionId, rcode = 0, ancount = 1)
        val question = questionSection(q)
        val answer = ArrayList<Byte>()
        answer.addAll(pointerToQuestionName().toList())
        answer.addAll(u16(rdType).toList())
        answer.addAll(u16(DnsQueryParser.CLASS_IN).toList())
        answer.addAll(u32(TTL_SECONDS).toList())
        answer.addAll(u16(rdata.size).toList())
        answer.addAll(rdata.toList())
        return headerBytes + question + answer.toByteArray()
    }

    private fun header(transactionId: Int, rcode: Int, ancount: Int): ByteArray {
        // QR=1 (response), OPCODE=0, AA=0, TC=0, RD=0, RA=1, Z=0, RCODE=rcode.
        val flags = 0x8080 or (rcode and 0xf)
        val out = ArrayList<Byte>()
        out.addAll(u16(transactionId).toList())
        out.addAll(u16(flags).toList())
        out.addAll(u16(1).toList()) // QDCOUNT
        out.addAll(u16(ancount).toList())
        out.addAll(u16(0).toList()) // NSCOUNT
        out.addAll(u16(0).toList()) // ARCOUNT
        return out.toByteArray()
    }

    private fun questionSection(q: DnsQuery): ByteArray {
        val out = ArrayList<Byte>()
        for (label in q.qname.split('.')) {
            if (label.isEmpty()) continue
            out.add(label.length.toByte())
            out.addAll(label.toByteArray(Charsets.US_ASCII).toList())
        }
        out.add(0) // root terminator
        out.addAll(u16(q.qtype).toList())
        out.addAll(u16(q.qclass).toList())
        return out.toByteArray()
    }

    /** Compression pointer 0xC00C -> byte offset 12 (right after the 12-byte header): the question name. */
    private fun pointerToQuestionName(): ByteArray = byteArrayOf(0xC0.toByte(), 0x0C)

    private fun u16(v: Int): ByteArray = byteArrayOf(((v ushr 8) and 0xff).toByte(), (v and 0xff).toByte())
    private fun u32(v: Int): ByteArray = byteArrayOf(
        ((v ushr 24) and 0xff).toByte(), ((v ushr 16) and 0xff).toByte(),
        ((v ushr 8) and 0xff).toByte(), (v and 0xff).toByte(),
    )

    private fun ipv4ToBytes(ipv4: String): ByteArray = ipv4.split('.').map { it.toInt().toByte() }.toByteArray()

    /** Builds the full IPv4 + UDP + [dnsMessage] packet, source/destination swapped relative to [query] (this is a response), with real IPv4 header + UDP checksums computed. */
    private fun wrapUdp(query: Ipv4PacketInfo, dnsMessage: ByteArray): ByteArray {
        val udpLength = 8 + dnsMessage.size
        val totalLength = 20 + udpLength
        val packet = ByteArray(totalLength)
        val responseSrc = query.destinationIpv4 // the virtual DNS endpoint the app queried
        val responseDst = query.sourceIpv4 // the querying app

        packet[0] = 0x45 // version 4, IHL 5 (no options)
        packet[1] = 0
        packet[2] = ((totalLength ushr 8) and 0xff).toByte(); packet[3] = (totalLength and 0xff).toByte()
        packet[4] = 0; packet[5] = 0 // identification
        packet[6] = 0x40.toByte(); packet[7] = 0 // flags: don't fragment
        packet[8] = 64 // TTL
        packet[9] = Ipv4PacketParser.PROTO_UDP.toByte()
        packet[10] = 0; packet[11] = 0 // header checksum placeholder
        writeIpv4(packet, 12, responseSrc)
        writeIpv4(packet, 16, responseDst)
        writeIpv4HeaderChecksum(packet)

        val udpOffset = 20
        packet[udpOffset] = ((DNS_PORT ushr 8) and 0xff).toByte(); packet[udpOffset + 1] = (DNS_PORT and 0xff).toByte()
        val dport = query.sourcePort ?: 0
        packet[udpOffset + 2] = ((dport ushr 8) and 0xff).toByte(); packet[udpOffset + 3] = (dport and 0xff).toByte()
        packet[udpOffset + 4] = ((udpLength ushr 8) and 0xff).toByte(); packet[udpOffset + 5] = (udpLength and 0xff).toByte()
        packet[udpOffset + 6] = 0; packet[udpOffset + 7] = 0 // UDP checksum placeholder
        System.arraycopy(dnsMessage, 0, packet, udpOffset + 8, dnsMessage.size)

        val checksum = computeUdpChecksum(packet, ipHeaderLen = 20, udpLength = udpLength, srcIpv4 = responseSrc, dstIpv4 = responseDst)
        packet[udpOffset + 6] = ((checksum ushr 8) and 0xff).toByte(); packet[udpOffset + 7] = (checksum and 0xff).toByte()
        return packet
    }

    private fun writeIpv4(packet: ByteArray, offset: Int, ipv4: String) {
        val parts = ipv4.split('.').map { it.toInt() }
        for (i in 0..3) packet[offset + i] = parts[i].toByte()
    }

    private fun writeIpv4HeaderChecksum(packet: ByteArray) {
        var sum = 0
        var i = 0
        while (i < 20) {
            sum += ((packet[i].toInt() and 0xff) shl 8) or (packet[i + 1].toInt() and 0xff)
            i += 2
        }
        while (sum shr 16 != 0) sum = (sum and 0xffff) + (sum ushr 16)
        val checksum = sum.inv() and 0xffff
        packet[10] = ((checksum ushr 8) and 0xff).toByte()
        packet[11] = (checksum and 0xff).toByte()
    }

    /** RFC 768 UDP checksum over the IPv4 pseudo-header + UDP header + payload. Zero-length checksum is disallowed (0 means "not computed"), so an all-zero sum is transmitted as 0xffff. */
    private fun computeUdpChecksum(packet: ByteArray, ipHeaderLen: Int, udpLength: Int, srcIpv4: String, dstIpv4: String): Int {
        var sum = 0
        val src = srcIpv4.split('.').map { it.toInt() }
        val dst = dstIpv4.split('.').map { it.toInt() }
        sum += (src[0] shl 8) or src[1]; sum += (src[2] shl 8) or src[3]
        sum += (dst[0] shl 8) or dst[1]; sum += (dst[2] shl 8) or dst[3]
        sum += Ipv4PacketParser.PROTO_UDP
        sum += udpLength
        var i = ipHeaderLen
        val end = ipHeaderLen + udpLength
        while (i + 1 < end) {
            sum += ((packet[i].toInt() and 0xff) shl 8) or (packet[i + 1].toInt() and 0xff)
            i += 2
        }
        if (i < end) sum += (packet[i].toInt() and 0xff) shl 8
        while (sum shr 16 != 0) sum = (sum and 0xffff) + (sum ushr 16)
        val checksum = sum.inv() and 0xffff
        return if (checksum == 0) 0xffff else checksum
    }
}
