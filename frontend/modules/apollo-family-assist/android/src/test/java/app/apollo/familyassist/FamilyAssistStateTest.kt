package app.apollo.familyassist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Native regression checks for the Family Help state (run with
 * `./gradlew :apollo-family-assist:testDebugUnitTest` once the module is linked). Pure JVM: no device needed.
 */
class FamilyAssistStateTest {
  private var tick = 0
  private fun store() = FamilyAssistStateStore { "2026-01-01T00:00:${(tick++).toString().padStart(2, '0')}Z" }

  @Test fun `constructing the store at startup does not throw and starts empty`() {
    // The original crash: seeding a ConcurrentHashMap with nulls threw on first access (module OnCreate).
    val state = store().snapshot()
    assertEquals("idle", state.captureState)
    assertNull(state.sessionId)
    assertNull(state.generation)
    assertNull(state.failureCode)
    assertFalse(state.helperConnected)
  }

  @Test fun `the empty state crosses the bridge with its nulls intact`() {
    val map = store().snapshot().toMap()
    assertEquals(11, map.size)
    assertTrue(map.containsKey("connectionPath")); assertNull(map["connectionPath"])
    assertTrue(map.containsKey("sessionId")); assertNull(map["sessionId"])
    assertTrue(map.containsKey("failureCode")); assertNull(map["failureCode"])
    assertEquals("idle", map["captureState"])
  }

  @Test fun `a transition with a null failure code is accepted`() {
    val s = store()
    s.begin("s1", "g1", "requesting_consent")
    assertTrue(s.transition("s1", "g1", "starting", failure = null, reason = null))
    assertEquals("starting", s.snapshot().captureState)
    assertNull(s.snapshot().failureCode)
  }

  @Test fun `stop and failure end the session and clear the helper`() {
    val s = store()
    s.begin("s1", "g1", "starting")
    assertTrue(s.transition("s1", "g1", "active", helperConnected = true))
    assertTrue(s.snapshot().helperConnected)
    assertTrue(s.transition("s1", "g1", "stopped", reason = "owner_stopped"))
    assertEquals("stopped", s.snapshot().captureState)
    assertEquals("owner_stopped", s.snapshot().endReason)
    assertFalse(s.snapshot().helperConnected)
    // Once ended, a late "active" from the same session cannot revive it.
    assertFalse(s.transition("s1", "g1", "active"))
    assertEquals("stopped", s.snapshot().captureState)

    s.begin("s2", "g1", "starting")
    assertTrue(s.transition("s2", "g1", "failed", failure = "transport_failed"))
    assertEquals("transport_failed", s.snapshot().failureCode)
    assertTrue(s.canTakeOver())
  }

  @Test fun `a stale session or generation cannot change the current one`() {
    val s = store()
    s.begin("old", "g1", "starting")
    s.begin("new", "g2", "starting")
    assertFalse(s.transition("old", "g1", "failed", failure = "transport_failed"))
    assertFalse(s.transition("new", "g1", "active"))
    assertFalse(s.transition(null, null, "active"))
    assertEquals("new", s.snapshot().sessionId)
    assertEquals("starting", s.snapshot().captureState)
  }

  @Test fun `only an idle, stopped or failed session can be taken over`() {
    val s = store()
    assertTrue(s.canTakeOver())
    s.begin("s1", "g1", "requesting_consent")
    assertFalse(s.canTakeOver())
    s.transition("s1", "g1", "stopped", reason = "consent_denied")
    assertTrue(s.canTakeOver())
  }

  @Test fun `the connection path changes only for the current, live session and is cleared when it ends`() {
    val s = store()
    s.begin("s1", "g1", "starting")
    assertTrue(s.setConnectionPath("s1", "g1", "connecting"))
    assertFalse(s.setConnectionPath("s1", "g1", "connecting"))  // unchanged: no event
    assertTrue(s.setConnectionPath("s1", "g1", "relayed"))
    assertFalse(s.setConnectionPath("s1", "g1", "sideways"))   // not a path
    assertFalse(s.setConnectionPath("old", "g0", "direct"))    // another session
    assertTrue(s.transition("s1", "g1", "active"))
    assertEquals("relayed", s.snapshot().connectionPath)         // kept through a capture change
    assertTrue(s.transition("s1", "g1", "stopped", reason = "owner_stopped"))
    assertNull(s.snapshot().connectionPath)
    assertFalse(s.setConnectionPath("s1", "g1", "direct"))
  }

  @Test fun `a relay candidate on either end makes the route relayed`() {
    assertTrue(isRelayCandidate("candidate:1 1 udp 41885439 203.0.113.9 3478 typ relay raddr 0.0.0.0 rport 0"))
    assertFalse(isRelayCandidate("candidate:2 1 udp 2122260223 192.168.1.4 51000 typ host generation 0"))
    assertFalse(isRelayCandidate("candidate:3 1 udp 1686052607 198.51.100.7 51000 typ srflx raddr 192.168.1.4 rport 51000"))
  }

  @Test fun `markStarted stamps the start time once`() {
    val s = store()
    s.begin("s1", "g1", "starting")
    s.transition("s1", "g1", "starting", markStarted = true)
    val started = s.snapshot().startedAt
    s.transition("s1", "g1", "active")
    assertEquals(started, s.snapshot().startedAt)
  }
}
