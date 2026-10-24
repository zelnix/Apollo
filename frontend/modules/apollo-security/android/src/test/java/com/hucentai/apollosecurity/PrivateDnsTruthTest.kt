package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Test

class PrivateDnsTruthTest {
  @Test fun hostnameFromTheNetworkWinsAndIsTheOnlyBypass() {
    val mode = PrivateDnsTruth.mode(null, true, "dns.adguard.com", true)
    assertEquals(PrivateDnsTruth.HOSTNAME, mode)
    assertEquals("confirmed", PrivateDnsTruth.bypassLevel(mode))
  }

  @Test fun androidsOwnSettingIsUsedWhenReadable() {
    assertEquals(PrivateDnsTruth.OFF, PrivateDnsTruth.mode("off", false, null, true))
    assertEquals(PrivateDnsTruth.AUTOMATIC, PrivateDnsTruth.mode("opportunistic", false, null, true))
    assertEquals(PrivateDnsTruth.HOSTNAME, PrivateDnsTruth.mode("hostname", false, null, true))
  }

  @Test fun automaticNeverCountsAsBypassingApollo() {
    assertEquals("none", PrivateDnsTruth.bypassLevel(PrivateDnsTruth.AUTOMATIC))
    assertEquals("none", PrivateDnsTruth.bypassLevel(PrivateDnsTruth.OFF))
  }

  @Test fun unreadableAndInactiveIsNotInUseNeverOff() {
    assertEquals(PrivateDnsTruth.NOT_IN_USE, PrivateDnsTruth.mode(null, false, null, true))
    assertEquals(PrivateDnsTruth.AUTOMATIC, PrivateDnsTruth.mode(null, true, null, true))
  }

  @Test fun noNetworkAndNoSettingIsUnknown() {
    val mode = PrivateDnsTruth.mode(null, false, null, false)
    assertEquals(PrivateDnsTruth.UNKNOWN, mode)
    assertEquals("unobservable", PrivateDnsTruth.bypassLevel(mode))
  }
}
