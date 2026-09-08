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

    /** Dual-stack phones: the spec must route exactly one IPv4 /32 AND let IPv6 bypass (Android blocks an unconfigured family otherwise). */
    @Test fun ipv6FallsThroughWhileOnlyTheIpv4Slash32IsRouted() {
        val spec = SelectiveRouteInstaller.buildSpec(config, "203.0.113.10")
        assertTrue(spec.allowIpv6Bypass, "IPv6 must be allowed to bypass the tunnel")
        assertEquals(1, spec.routes.size)
        assertTrue(spec.routes.none { it.address.contains(":") }, "no IPv6 route may ever be installed")
        assertTrue(!spec.copy(allowIpv6Bypass = false).isSelective, "a spec that intercepts IPv6 is not selective")
    }

    /**
     * Frozen M1 acceptance constants (blocktest.btciq.app → 52.25.179.131, offline — the binding result is injected, no DNS):
     * the installed route set must be exactly [52.25.179.131/32] and IPv6 must be explicitly allowed to bypass, never routed into the TUN.
     */
    @Test fun frozenM1EndpointRoutesExactlyTheDedicatedSlash32AndBypassesIpv6() {
        val frozen = VpnConfig("blocktest.btciq.app", "52.25.179.131", "https://blocktest.btciq.app/", "gd-m1-controlled-block")
        val binding = ControlledEndpointResolver(frozen) { listOf("52.25.179.131") }.verifyBinding()
        assertIs<BindingResult.Match>(binding)
        val spec = SelectiveRouteInstaller.buildSpec(frozen, binding.ipv4)
        assertEquals(listOf(RouteSpec("52.25.179.131", 32)), spec.routes)
        assertEquals("52.25.179.131/32", spec.routes.single().cidr)
        assertTrue(spec.isSelective)
        assertTrue(spec.allowIpv6Bypass, "IPv6 must be allowed to bypass (allowFamily(AF_INET6)), not intercepted")
        assertTrue(spec.routes.none { it.address == "0.0.0.0" || it.address == "::" || it.address.contains(":") })
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

    // --- Gate Guard M2 Website Gate: additive builder, never touching buildSpec's M1 behavior above. ---

    private val websiteGate = WebsiteGateRouteConfig("192.0.2.53", listOf("192.0.2.240", "192.0.2.241"))

    @Test fun websiteGateSpecAddsExactlyTheFixedDnsGatewayAndSinkholePoolAlongsideTheM1Slash32() {
        val spec = SelectiveRouteInstaller.buildWebsiteGateSpec(config, "203.0.113.10", websiteGate)
        assertEquals(
            setOf(RouteSpec("203.0.113.10", 32), RouteSpec("192.0.2.53", 32), RouteSpec("192.0.2.240", 32), RouteSpec("192.0.2.241", 32)),
            spec.routes.toSet(),
        )
        assertEquals(listOf("192.0.2.53"), spec.dnsServers)
        assertTrue(spec.isSelective)
        assertTrue(spec.routes.none { it.address == "0.0.0.0" || it.address == "::" })
    }

    @Test fun websiteGateSpecStillEnforcesTheSameM1VerificationAsBuildSpec() {
        assertFailsWith<IllegalArgumentException> { SelectiveRouteInstaller.buildWebsiteGateSpec(config, "198.51.100.7", websiteGate) }
    }

    @Test fun buildSpecAloneIsCompletelyUnaffectedByWebsiteGateExisting() {
        // Same frozen M1 assertion as installsOnlyTheControlledSlash32, proving buildSpec()'s
        // behavior is bit-for-bit unchanged by the existence of buildWebsiteGateSpec().
        val spec = SelectiveRouteInstaller.buildSpec(config, "203.0.113.10")
        assertEquals(listOf(RouteSpec("203.0.113.10", 32)), spec.routes)
        assertEquals(emptyList(), spec.dnsServers)
        assertTrue(spec.isSelective)
    }
}
