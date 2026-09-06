package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SelectiveRouteInstallerTest {
    private val config = VpnConfig("m1-block-test.guarddog.example", "203.0.113.10", "https://m1-block-test.guarddog.example/", "gd-m1-controlled-block")

    @Test fun installsOnlyTheControlledSlash32() {
        val spec = SelectiveRouteInstaller.buildSpec(config, "203.0.113.10")
        assertEquals(listOf(RouteSpec("203.0.113.10", 32)), spec.routes)
        assertTrue(spec.isSelective)
        assertTrue(spec.routes.none { it.address == "0.0.0.0" })
        assertEquals("203.0.113.10/32", spec.routes[0].cidr)
    }

    @Test fun refusesUnverifiedTarget() {
        assertFailsWith<IllegalArgumentException> { SelectiveRouteInstaller.buildSpec(config, "198.51.100.7") }
    }

    @Test fun bindingMismatchAbortsBeforeRouteInstall() {
        val mismatch = ControlledEndpointResolver(config) { listOf("198.51.100.7") }.verifyBinding()
        assertIs<BindingResult.Mismatch>(mismatch)
        val shared = ControlledEndpointResolver(config) { listOf("203.0.113.10", "203.0.113.11") }.verifyBinding()
        assertIs<BindingResult.Mismatch>(shared) // multiple A records => not a dedicated IP
        assertIs<BindingResult.ResolutionFailed>(ControlledEndpointResolver(config) { emptyList() }.verifyBinding())
        val match = ControlledEndpointResolver(config) { listOf("203.0.113.10") }.verifyBinding()
        assertIs<BindingResult.Match>(match)
        assertEquals("203.0.113.10", match.ipv4)
    }

    @Test fun configValidatesIpv4() {
        assertFailsWith<IllegalArgumentException> { config.copy(controlledIpv4 = "not-an-ip") }
    }
}
