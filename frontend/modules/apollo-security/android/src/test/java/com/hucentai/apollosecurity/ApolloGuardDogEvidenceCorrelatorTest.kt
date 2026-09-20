package com.hucentai.apollosecurity

import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventSource
import com.guarddog.core.events.SecurityEventType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApolloGuardDogEvidenceCorrelatorTest {
  private val evidence = BlockedThreatEvidence(
    enforcementEvidenceId = "evidence-1", destinationIpv4 = "192.0.2.8", destinationPort = 443,
    sourcePort = 53100, ipProtocol = 6, packetLength = 60, observedAtEpochMillis = 1_700_000_000_123,
    flowKey = "6:53100:192.0.2.8:443",
  )
  private val event = SecurityEvent(
    id = "engine-event-1", type = SecurityEventType.THREAT_BLOCKED,
    source = SecurityEventSource.ANDROID_VPN_ENFORCEMENT, occurredAt = "2026-01-01T00:00:00Z",
    host = "controlled.example", destinationIp = "192.0.2.8", ruleId = "rule-1",
    rulesetId = "ruleset-1", bundleVersion = 7, enforcementEvidenceId = "evidence-1", verdict = "block",
  )

  @Test fun preservesOriginalProtocolPortObservationAndEvidenceIdentity() {
    val record = ApolloGuardDogEvidenceCorrelator.correlate(event, evidence, "Android test")!!
    assertEquals("evidence-1", record["evidenceId"])
    assertEquals("tcp", record["protocol"])
    assertEquals("2023-11-14T22:13:20.123Z", record["observedAt"])
    assertEquals(443, (record["destination"] as Map<*, *>)["port"])
    assertEquals(6, (record["sourceMetadata"] as Map<*, *>)["ipProtocolNumber"])
    assertEquals("engine-event-1", record["correlationId"])
  }

  @Test fun doesNotInferMissingPortAndRejectsMismatchedCorrelation() {
    val noPort = ApolloGuardDogEvidenceCorrelator.correlate(event, evidence.copy(destinationPort = null), "Android test")!!
    assertNull((noPort["destination"] as Map<*, *>)["port"])
    assertNull(ApolloGuardDogEvidenceCorrelator.correlate(event.copy(enforcementEvidenceId = "other"), evidence, "Android test"))
    assertNull(ApolloGuardDogEvidenceCorrelator.correlate(event.copy(destinationIp = "192.0.2.9"), evidence, "Android test"))
  }
}