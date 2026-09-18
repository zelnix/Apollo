package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WebsiteGateOverrideStoreTest {
    @Test fun noOverridesAlwaysReturnsNone() {
        assertEquals(WebsiteGateOverrideDecision.NONE, NoWebsiteGateOverrides.overrideFor("example.com"))
    }

    @Test fun setAllowedThenLookupReturnsAllow() {
        val store = MutableWebsiteGateOverrideStore()
        assertTrue(store.setAllowed("example.com", true))
        assertEquals(WebsiteGateOverrideDecision.ALLOW, store.overrideFor("example.com"))
    }

    @Test fun removingAnOverrideIsFullyReversible() {
        val store = MutableWebsiteGateOverrideStore()
        store.setAllowed("example.com", true)
        store.setAllowed("example.com", false)
        assertEquals(WebsiteGateOverrideDecision.NONE, store.overrideFor("example.com"))
    }

    @Test fun storesHostsCanonicalized() {
        val store = MutableWebsiteGateOverrideStore()
        store.setAllowed("EXAMPLE.com.", true) // uppercase + trailing dot
        assertEquals(WebsiteGateOverrideDecision.ALLOW, store.overrideFor("example.com"))
    }

    @Test fun rejectsAHostThatFailsCanonicalization() {
        val store = MutableWebsiteGateOverrideStore()
        assertFalse(store.setAllowed("not a host!!", true))
        assertEquals(WebsiteGateOverrideDecision.NONE, store.overrideFor("not a host!!"))
    }

    @Test fun snapshotAndClearAreAuditableAndReversible() {
        val store = MutableWebsiteGateOverrideStore()
        store.setAllowed("a.example", true)
        store.setAllowed("b.example", true)
        assertEquals(setOf("a.example", "b.example"), store.allowedHostsSnapshot())
        store.clear()
        assertEquals(emptySet(), store.allowedHostsSnapshot())
    }
}
