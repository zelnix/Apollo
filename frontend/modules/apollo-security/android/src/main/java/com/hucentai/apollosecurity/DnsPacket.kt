package com.hucentai.apollosecurity

import java.nio.ByteBuffer

/**
 * Pure packet/DNS helpers for Site Guard — no Android dependencies so they run under plain JVM unit tests.
 * The coverage boundary lives here: [isFilterableQuery] accepts ONLY IPv4 + UDP + destination port 53.
 * Anything else is not seen by Site Guard, and ApolloSecurityModule.COVERAGE says so to the user.
 */
object DnsPacket {
  /** IPv4 (version nibble 4), protocol UDP (17), UDP dst port 53, and enough bytes for headers + DNS header. */
  fun isFilterableQuery(pkt: ByteArray): Boolean {
    if (pkt.size < 28 || (pkt[0].toInt() shr 4) != 4 || pkt[9].toInt() != 17) return false
    val ihl = (pkt[0].toInt() and 0x0F) * 4
    if (pkt.size < ihl + 8 + 12) return false
    val dstPort = ((pkt[ihl + 2].toInt() and 0xFF) shl 8) or (pkt[ihl + 3].toInt() and 0xFF)
    return dstPort == 53
  }

  fun ihl(pkt: ByteArray): Int = (pkt[0].toInt() and 0x0F) * 4

  /** DNS payload of a filterable packet (caller must check [isFilterableQuery] first). */
  fun dnsPayload(pkt: ByteArray): ByteArray = pkt.copyOfRange(ihl(pkt) + 8, pkt.size)

  /** First question name, lower-cased, no trailing dot. Compression pointers are rejected (queries never need them). */
  fun parseQName(dns: ByteArray): String? {
    if (dns.size < 12) return null
    var i = 12; val sb = StringBuilder()
    while (i < dns.size) {
      val len = dns[i].toInt() and 0xFF
      if (len == 0) break
      if (len >= 0xC0 || i + 1 + len > dns.size) return null
      if (sb.isNotEmpty()) sb.append('.')
      sb.append(String(dns, i + 1, len, Charsets.US_ASCII)); i += 1 + len
    }
    return sb.toString().lowercase().ifEmpty { null }
  }

  /** Blocked if the host equals a blocked entry or is a subdomain of one. */
  fun matchesBlocked(host: String, blocked: Set<String>): Boolean = matchingBlockedEntry(host, blocked) != null

  /**
   * The specific blocklist entry a host matched — itself, or the parent domain it is a subdomain of —
   * or null when nothing matches. Used to name the exact rule in EnforcementEvidence.matchedRuleId,
   * because "www.evil.example" was blocked by the "evil.example" rule, not by its own exact name.
   */
  fun matchingBlockedEntry(host: String, blocked: Set<String>): String? {
    val h = host.lowercase().trimEnd('.')
    return blocked.firstOrNull { b -> h == b || h.endsWith(".$b") }
  }

  /** Copy the question, set QR=1, RA=1, RCODE=3 (NXDOMAIN), zero answer/authority/additional counts. */
  fun nxdomain(query: ByteArray): ByteArray {
    val r = query.copyOf()
    r[2] = (r[2].toInt() or 0x80).toByte()                      // QR
    r[3] = ((r[3].toInt() and 0x70) or 0x80 or 0x03).toByte()    // RA + RCODE 3 (keeps Z/AD/CD bits)
    r[6] = 0; r[7] = 0; r[8] = 0; r[9] = 0; r[10] = 0; r[11] = 0
    return r
  }

  fun rcode(dns: ByteArray): Int = dns[3].toInt() and 0x0F
  fun isResponse(dns: ByteArray): Boolean = (dns[2].toInt() and 0x80) != 0

  /** Build an IPv4/UDP reply by swapping addresses and ports of the request. */
  fun wrapReply(req: ByteArray, ihl: Int, payload: ByteArray): ByteArray {
    val total = 20 + 8 + payload.size
    val b = ByteBuffer.allocate(total)
    b.put((0x45).toByte()); b.put(0); b.putShort(total.toShort()); b.putShort(0); b.putShort(0x4000.toShort()); b.put(64); b.put(17); b.putShort(0)
    b.put(req, 16, 4) // src = original dst
    b.put(req, 12, 4) // dst = original src
    val srcPort = ((req[ihl].toInt() and 0xFF) shl 8) or (req[ihl + 1].toInt() and 0xFF)
    b.putShort(53); b.putShort(srcPort.toShort()); b.putShort((8 + payload.size).toShort()); b.putShort(0) // UDP checksum 0 = none (IPv4)
    b.put(payload)
    val arr = b.array()
    val cs = ipChecksum(arr, 0, 20); arr[10] = (cs shr 8).toByte(); arr[11] = cs.toByte()
    return arr
  }

  fun ipChecksum(data: ByteArray, off: Int, len: Int): Int {
    var sum = 0L; var i = off
    while (i < off + len - 1) { sum += ((data[i].toInt() and 0xFF) shl 8) or (data[i + 1].toInt() and 0xFF); i += 2 }
    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    return (sum.inv() and 0xFFFF).toInt()
  }

  /** Build a minimal IPv4/UDP DNS A-query packet (used by tests and diagnostics). */
  fun buildQuery(name: String, src: ByteArray = byteArrayOf(10, 111, 0, 2), dst: ByteArray = byteArrayOf(10, 111, 0, 1), srcPort: Int = 40000, dstPort: Int = 53, id: Int = 0x1234): ByteArray {
    val labels = name.trimEnd('.').split('.')
    val q = ByteBuffer.allocate(12 + labels.sumOf { it.length + 1 } + 1 + 4)
    q.putShort(id.toShort()); q.putShort(0x0100); q.putShort(1); q.putShort(0); q.putShort(0); q.putShort(0)
    labels.forEach { q.put(it.length.toByte()); q.put(it.toByteArray(Charsets.US_ASCII)) }
    q.put(0); q.putShort(1); q.putShort(1)
    val dns = q.array()
    val total = 28 + dns.size
    val b = ByteBuffer.allocate(total)
    b.put(0x45.toByte()); b.put(0); b.putShort(total.toShort()); b.putShort(0); b.putShort(0x4000.toShort()); b.put(64); b.put(17); b.putShort(0)
    b.put(src); b.put(dst)
    b.putShort(srcPort.toShort()); b.putShort(dstPort.toShort()); b.putShort((8 + dns.size).toShort()); b.putShort(0)
    b.put(dns)
    val arr = b.array(); val cs = ipChecksum(arr, 0, 20); arr[10] = (cs shr 8).toByte(); arr[11] = cs.toByte()
    return arr
  }
}
