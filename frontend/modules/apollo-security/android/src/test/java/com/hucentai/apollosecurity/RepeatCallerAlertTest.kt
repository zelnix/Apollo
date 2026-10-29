package com.hucentai.apollosecurity

import com.hucentai.apollosecurity.RepeatCallerAlert.Mark
import com.hucentai.apollosecurity.RepeatCallerAlert.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RepeatCallerAlertTest {
  private val now = 1_800_000_000_000L
  private val day = 24L * 60 * 60 * 1000
  private fun high(daysAgo: Long) = Mark(RepeatCallerAlert.LEVEL_HIGH_RISK, now - daysAgo * day)
  private fun worth(daysAgo: Long) = Mark(RepeatCallerAlert.LEVEL_WORTH_CHECKING, now - daysAgo * day)

  @Test fun blockListAlertsOnEveryCallWithoutNeedingADate() {
    assertEquals(Reason.BLOCK_LIST, RepeatCallerAlert.reasonFor(true, false, null, now))
    assertEquals(Reason.BLOCK_LIST, RepeatCallerAlert.reasonFor(true, true, high(90), now))
  }

  @Test fun highRiskAlertsOnlyWithin30DaysOfTheFinding() {
    assertEquals(Reason.HIGH_RISK, RepeatCallerAlert.reasonFor(false, true, high(2), now))
    assertEquals(Reason.HIGH_RISK, RepeatCallerAlert.reasonFor(false, true, high(30), now))
    assertNull(RepeatCallerAlert.reasonFor(false, true, high(31), now))
    // Found high-risk before this build kept dates: still rejected, but Apollo can't say it was within 30 days.
    assertNull(RepeatCallerAlert.reasonFor(false, true, null, now))
  }

  @Test fun worthCheckingAlertsWithin30DaysWhileTheCallRings() {
    assertEquals(Reason.WORTH_CHECKING, RepeatCallerAlert.reasonFor(false, false, worth(5), now))
    assertNull(RepeatCallerAlert.reasonFor(false, false, worth(40), now))
  }

  @Test fun noFindingOrAFutureDateNeverAlerts() {
    assertNull(RepeatCallerAlert.reasonFor(false, false, null, now))
    assertNull(RepeatCallerAlert.reasonFor(false, false, Mark(RepeatCallerAlert.LEVEL_WORTH_CHECKING, now + day), now))
    // A high-risk finding on a number that is not on the auto-reject list does not alert as a ringing call.
    assertNull(RepeatCallerAlert.reasonFor(false, false, high(1), now))
  }

  @Test fun worthCheckingNeverLowersAHighRiskNumberAndACleanResultOnlyClearsWorthChecking() {
    val start = mapOf("+61400000001" to high(1))
    assertEquals(start, RepeatCallerAlert.withWorthChecking(start, "+61400000001", true, true, now))
    assertEquals(start, RepeatCallerAlert.withWorthChecking(start, "+61400000001", false, true, now))
    val worth = RepeatCallerAlert.withWorthChecking(emptyMap(), "+61400000002", true, false, now)
    assertEquals(Mark(RepeatCallerAlert.LEVEL_WORTH_CHECKING, now), worth["+61400000002"])
    assertTrue(RepeatCallerAlert.withWorthChecking(worth, "+61400000002", false, false, now).isEmpty())
    assertEquals(Mark(RepeatCallerAlert.LEVEL_HIGH_RISK, now), RepeatCallerAlert.withHighRisk(worth, "+61400000002", now)["+61400000002"])
  }

  @Test fun pruneKeepsOnlyFindingsInsideTheWindow() {
    val kept = RepeatCallerAlert.prune(mapOf("a" to high(3), "b" to worth(31)), now)
    assertEquals(setOf("a"), kept.keys)
  }

  @Test fun wordingSaysARejectionWasRequestedAndNamesTheFindingDate() {
    val high = RepeatCallerAlert.alertFor(Reason.HIGH_RISK, "+61400000001", "29 Oct 2026")
    assertTrue(high.body.contains("high-risk on 29 Oct 2026"))
    assertTrue(high.body.contains("asked Android to reject"))
    assertTrue(RepeatCallerAlert.alertFor(Reason.BLOCK_LIST, "+61400000001", null).body.contains("asked Android to reject"))
    val worth = RepeatCallerAlert.alertFor(Reason.WORTH_CHECKING, "+61400000001", null)
    assertFalse(worth.body.contains("reject"))
    for (a in listOf(high, worth)) assertFalse(a.body.contains("verified") || a.body.contains("was blocked"))
  }
}
