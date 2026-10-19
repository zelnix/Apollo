package com.hucentai.apollosecurity

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApolloAcceptanceEvidenceGateTest {
  private val run = AcceptanceProbeContext("run-new", "probe-new", "session-new", "controlled.example", "203.0.113.20", 443, 53001, 1_000, 2_000)
  private val current = AcceptanceEvidenceRef("evidence-new", "run-new", "probe-new", "session-new", "controlled.example", "203.0.113.20", 443, 1_500)

  @Test fun onlyNewRunProbeSessionDestinationEvidencePasses() {
    assertTrue(ApolloAcceptanceEvidenceGate.matches(current, run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current, run, setOf("evidence-new")))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(runId = null), run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(probeId = "old"), run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(sessionId = "old"), run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(destinationHost = "other.example"), run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(destinationPort = 80), run, emptySet()))
    assertFalse(ApolloAcceptanceEvidenceGate.matches(current.copy(observedAtEpochMillis = 999), run, emptySet()))
  }
}