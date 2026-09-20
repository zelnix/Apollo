package com.hucentai.apollosecurity

import com.guarddog.core.clock.SystemClock
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RejectReason
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import com.guarddog.core.rules.VerificationResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ApolloGuardDogAcceptanceBundleTest {
  private fun raw(name: String) = checkNotNull(javaClass.classLoader?.getResource("guarddog-acceptance/$name"))
    .readText()
  private fun verifier() = RuleBundleVerifier(
    TrustedKeyRegistry(mapOf(ApolloGuardDogCandidateRuntime.ACCEPTANCE_KEY_ID to ApolloGuardDogCandidateRuntime.ACCEPTANCE_PUBLIC_KEY_B64)),
    InMemoryBundleVersionStore(), SystemClock,
  )

  @Test fun currentAcceptanceFixtureIsValidAgainstRealClock() {
    val now = Instant.now()
    assertTrue(now.isAfter(Instant.parse("2026-09-20T04:30:31Z")))
    assertTrue(now.isBefore(Instant.parse("2027-03-19T05:30:31Z")))
    assertTrue(verifier().verify(raw("valid_bundle.json")) is VerificationResult.Accepted)
  }

  @Test fun tamperedExpiredAndUnknownKeyFixturesFailClosed() {
    fun reason(name: String) = (verifier().verify(raw(name)) as VerificationResult.Rejected).reason
    assertEquals(RejectReason.PAYLOAD_HASH_MISMATCH, reason("tampered_bundle.json"))
    assertEquals(RejectReason.EXPIRED, reason("expired_bundle.json"))
    assertEquals(RejectReason.UNKNOWN_KEY, reason("unknown_key_bundle.json"))
  }
}