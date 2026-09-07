package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Apollo must never say he is guarding when he isn't" — Android edition. Mirrors ios/Tests/SiteGuardTruthTests.swift.
 * Run: ./gradlew :apollo-security:testDebugUnitTest (inside the generated android project).
 */
class SiteGuardTruthTest {
  @Test fun `off duty is never operational and never degraded even if a service is running`() {
    val d = SiteGuardTruth.derive(requested = false, vpnRunning = true, vpnGranted = true)
    assertFalse(d.operational); assertEquals("none", d.enforcementMethod); assertNull(d.degradedReason)
    assertEquals("none", d.visibility); assertTrue(d.coverageScope.isEmpty())
  }

  @Test fun `requested and running is operational with the exact coverage statement`() {
    val d = SiteGuardTruth.derive(requested = true, vpnRunning = true, vpnGranted = true)
    assertTrue(d.operational); assertEquals("dns_filter", d.enforcementMethod); assertNull(d.degradedReason)
    assertEquals(SiteGuardTruth.COVERAGE, d.coverage)
    assertEquals(listOf("dns:ipv4", "dns:udp-53", "resolver:system"), d.coverageScope)
    assertTrue(d.coverage.contains("Not covered: IPv6 DNS, DNS over TCP"))
  }

  @Test fun `requested but permission missing is degraded with the permission reason`() {
    val d = SiteGuardTruth.derive(requested = true, vpnRunning = false, vpnGranted = false)
    assertFalse(d.operational); assertEquals("none", d.enforcementMethod)
    assertEquals(SiteGuardTruth.REASON_PERMISSION, d.degradedReason)
    assertEquals(SiteGuardTruth.COVERAGE_NONE, d.coverage)
  }

  @Test fun `requested with permission but service not running is degraded with the restart reason`() {
    val d = SiteGuardTruth.derive(requested = true, vpnRunning = false, vpnGranted = true)
    assertFalse(d.operational); assertEquals(SiteGuardTruth.REASON_NOT_RUNNING, d.degradedReason)
    assertEquals("limited", d.visibility)
  }

  @Test fun `permission alone never makes apollo operational`() {
    // Granted permission + requested, but establish() failed or Android killed the service.
    assertFalse(SiteGuardTruth.derive(requested = true, vpnRunning = false, vpnGranted = true).operational)
  }

  @Test fun `verified block requires a running filter and an enforced host`() {
    val blocked = setOf("evil.example")
    assertTrue(SiteGuardTruth.verifiedBlock(vpnRunning = true, host = "login.evil.example", blocked = blocked))
    assertFalse(SiteGuardTruth.verifiedBlock(vpnRunning = false, host = "evil.example", blocked = blocked))   // saved, not enforced
    assertFalse(SiteGuardTruth.verifiedBlock(vpnRunning = true, host = "evil.example.com", blocked = blocked))
    assertFalse(SiteGuardTruth.verifiedBlock(vpnRunning = true, host = "other.test", blocked = emptySet()))
  }

  /** Full on-the-wire decision path for one packet, exactly as ApolloDnsVpnService.handlePacket does it. */
  @Test fun `blocked query yields an nxdomain reply addressed back to the asker and clean query is forwarded`() {
    val blocked = setOf("evil.example")
    val bad = DnsPacket.buildQuery("www.evil.example", srcPort = 40404, id = 0x0A0B)
    assertTrue(DnsPacket.isFilterableQuery(bad))
    val dns = DnsPacket.dnsPayload(bad)
    val name = DnsPacket.parseQName(dns)!!
    assertTrue(DnsPacket.matchesBlocked(name, blocked))
    val reply = DnsPacket.wrapReply(bad, DnsPacket.ihl(bad), DnsPacket.nxdomain(dns))
    val replyDns = reply.copyOfRange(28, reply.size)
    assertTrue(DnsPacket.isResponse(replyDns)); assertEquals(3, DnsPacket.rcode(replyDns))
    assertEquals(0x0A, replyDns[0].toInt() and 0xFF); assertEquals(0x0B, replyDns[1].toInt() and 0xFF)  // same transaction id
    assertEquals(40404, ((reply[22].toInt() and 0xFF) shl 8) or (reply[23].toInt() and 0xFF))            // back to the asking port

    val clean = DnsPacket.buildQuery("www.abc.net.au")
    assertFalse(DnsPacket.matchesBlocked(DnsPacket.parseQName(DnsPacket.dnsPayload(clean))!!, blocked))   // → forwarded upstream, never answered locally
  }

  @Test fun `offline known-bad stays blockable because the decision needs no network`() {
    // The whole block decision is local: blocklist set + packet parsing. No backend involved.
    val blocked = setOf("phishing.apollo.test")
    val q = DnsPacket.buildQuery("phishing.apollo.test")
    assertTrue(DnsPacket.matchesBlocked(DnsPacket.parseQName(DnsPacket.dnsPayload(q))!!, blocked))
  }
}
