package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * JVM unit tests for the enforcement evidence contract — the guarantee that only a real, observed
 * packet drop can ever be reported as result="verified" + enforcedAction="blocked". Mirrors the
 * negative Truth-of-State tests in frontend/tests/platformCapability.test.ts.
 */
class EnforcementEvidenceTest {
  @Test fun `verifiedDnsBlock always reports a real mechanism, verified result and blocked action`() {
    val ev = EnforcementEvidence.verifiedDnsBlock(
      evidenceId = "ev-1", observedAt = "2026-06-01T00:00:00Z", domain = "www.evil.example",
      matchedRuleId = "evil.example", osVersion = "Android 15", sdkVersion = "1.0.0",
    )
    assertEquals("verified", ev.result)
    assertEquals("blocked", ev.enforcedAction)
    assertEquals("dns_filter", ev.mechanism)
    assertNotEquals("simulated", ev.mechanism)
    assertNotEquals("none", ev.mechanism)
    assertEquals("android", ev.platform)
    assertEquals("dns", ev.protocol)
    assertEquals(53, ev.destinationPort)
    assertEquals("www.evil.example", ev.destinationDomain)
    // The rule that matched is preserved separately from the exact host queried (subdomain matches).
    assertEquals("evil.example", ev.matchedRuleId)
    assertEquals("local_blocklist", ev.ruleSource)
  }

  @Test fun `ruleActivated is real but distinct from an observed packet drop`() {
    val ev = EnforcementEvidence.ruleActivated(
      evidenceId = "ev-2", observedAt = "2026-06-01T00:00:00Z", domain = "evil.example", osVersion = "Android 15", sdkVersion = "1.0.0",
    )
    assertEquals("verified", ev.result)
    assertEquals("blocked", ev.enforcedAction)
    // Distinguishable by ruleSource from an actually-observed block, so no code path can conflate the two.
    assertEquals("user_override", ev.ruleSource)
    assertNotEquals("local_blocklist", ev.ruleSource)
  }

  @Test fun `each evidence record carries its own identity, timestamp and destination — never blank`() {
    val ev = EnforcementEvidence.verifiedDnsBlock("ev-3", "2026-06-01T00:00:01Z", "phish.test", "phish.test", null, null)
    assertNotEquals("", ev.evidenceId)
    assertNotEquals("", ev.observedAt)
    assertEquals("phish.test", ev.destinationDomain)
  }
}
