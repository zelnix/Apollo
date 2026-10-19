package com.hucentai.apollosecurity

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for Site Guard's packet/DNS logic — the code that decides what Apollo can see and what a
 * "verified block" actually does on the wire. Run: ./gradlew :apollo-security:testDebugUnitTest (inside the
 * generated android project) or via the module's own gradle when checked out standalone.
 */
class DnsPacketTest {
  private val blocked = setOf("evil.example", "phish.test")

  @Test fun `coverage boundary accepts only ipv4 udp port 53`() {
    val ok = DnsPacket.buildQuery("evil.example")
    assertTrue(DnsPacket.isFilterableQuery(ok))
    // TCP (protocol 6) is not covered
    val tcp = ok.copyOf(); tcp[9] = 6
    assertFalse(DnsPacket.isFilterableQuery(tcp))
    // Non-53 destination port (e.g. DoT 853) is not covered
    assertFalse(DnsPacket.isFilterableQuery(DnsPacket.buildQuery("evil.example", dstPort = 853)))
    // IPv6 version nibble is not covered
    val v6 = ok.copyOf(); v6[0] = 0x60.toByte()
    assertFalse(DnsPacket.isFilterableQuery(v6))
    // Truncated packet is ignored, never crashes
    assertFalse(DnsPacket.isFilterableQuery(ok.copyOf(20)))
  }

  @Test fun `parses qname and lower-cases it`() {
    val dns = DnsPacket.dnsPayload(DnsPacket.buildQuery("Login.EVIL.example"))
    assertEquals("login.evil.example", DnsPacket.parseQName(dns))
  }

  @Test fun `rejects compression pointers and short payloads`() {
    val dns = DnsPacket.dnsPayload(DnsPacket.buildQuery("a.b"))
    dns[12] = 0xC0.toByte()
    assertNull(DnsPacket.parseQName(dns))
    assertNull(DnsPacket.parseQName(ByteArray(5)))
  }

  @Test fun `blocklist matches host and subdomains only`() {
    assertTrue(DnsPacket.matchesBlocked("evil.example", blocked))
    assertTrue(DnsPacket.matchesBlocked("www.evil.example.", blocked))
    assertTrue(DnsPacket.matchesBlocked("PHISH.TEST", blocked))
    assertFalse(DnsPacket.matchesBlocked("notevil.example", blocked))   // suffix without dot boundary
    assertFalse(DnsPacket.matchesBlocked("evil.example.com", blocked))  // different registrable domain
    assertFalse(DnsPacket.matchesBlocked("example", blocked))
  }

  @Test fun `matchingBlockedEntry names the exact rule a subdomain was caught by, for evidence`() {
    assertEquals("evil.example", DnsPacket.matchingBlockedEntry("evil.example", blocked))
    assertEquals("evil.example", DnsPacket.matchingBlockedEntry("login.evil.example", blocked)) // rule ≠ queried host
    assertEquals("phish.test", DnsPacket.matchingBlockedEntry("PHISH.TEST.", blocked))
    assertNull(DnsPacket.matchingBlockedEntry("notevil.example", blocked))
    assertNull(DnsPacket.matchingBlockedEntry("safe.example.org", blocked))
  }

  @Test fun `nxdomain keeps id and question, sets QR RA RCODE3 and zero counts`() {
    val q = DnsPacket.dnsPayload(DnsPacket.buildQuery("evil.example", id = 0xBEEF))
    val r = DnsPacket.nxdomain(q)
    assertEquals(q[0], r[0]); assertEquals(q[1], r[1])                       // ID preserved
    assertTrue(DnsPacket.isResponse(r))
    assertEquals(3, DnsPacket.rcode(r))
    assertEquals(0x80, r[3].toInt() and 0x80)                                // RA set
    assertEquals(1, ((q[4].toInt() and 0xFF) shl 8) or (q[5].toInt() and 0xFF)) // QDCOUNT untouched
    for (i in 6..11) assertEquals(0, r[i].toInt())                            // AN/NS/AR = 0
    assertArrayEquals(q.copyOfRange(12, q.size), r.copyOfRange(12, r.size))   // question echoed
  }

  @Test fun `reply swaps addresses and ports and has a valid ip checksum`() {
    val req = DnsPacket.buildQuery("evil.example", src = byteArrayOf(10, 111, 0, 2), dst = byteArrayOf(10, 111, 0, 1), srcPort = 51515)
    val payload = DnsPacket.nxdomain(DnsPacket.dnsPayload(req))
    val rep = DnsPacket.wrapReply(req, DnsPacket.ihl(req), payload)
    assertArrayEquals(byteArrayOf(10, 111, 0, 1), rep.copyOfRange(12, 16))   // src = original dst
    assertArrayEquals(byteArrayOf(10, 111, 0, 2), rep.copyOfRange(16, 20))   // dst = original src
    assertEquals(53, ((rep[20].toInt() and 0xFF) shl 8) or (rep[21].toInt() and 0xFF))
    assertEquals(51515, ((rep[22].toInt() and 0xFF) shl 8) or (rep[23].toInt() and 0xFF))
    assertEquals(0, DnsPacket.ipChecksum(rep, 0, 20))                        // header checksum verifies
    assertArrayEquals(payload, rep.copyOfRange(28, rep.size))
  }
}
