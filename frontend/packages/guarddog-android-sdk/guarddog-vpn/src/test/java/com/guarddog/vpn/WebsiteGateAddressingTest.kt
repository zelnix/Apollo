package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class WebsiteGateAddressingTest {
    @Test fun defaultRouteConfigUsesTestNet1Only() {
        val config = WebsiteGateAddressing.defaultRouteConfig()
        assertTrue(config.dnsGatewayIpv4.startsWith("192.0.2."))
        assertTrue(config.sinkholePool.all { it.startsWith("192.0.2.") })
        assertTrue(config.sinkholePool.none { it.startsWith("10.") || it.startsWith("172.") || it.startsWith("192.168.") || it.startsWith("127.") })
    }

    @Test fun refusesOverlapBetweenGatewayAndPool() {
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("192.0.2.53", listOf("192.0.2.53", "192.0.2.241")) }
    }

    @Test fun refusesDuplicatePoolEntries() {
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("192.0.2.53", listOf("192.0.2.240", "192.0.2.240")) }
    }

    @Test fun refusesEmptyPool() {
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("192.0.2.53", emptyList()) }
    }

    @Test fun refusesDefaultRouteAddress() {
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("0.0.0.0", listOf("192.0.2.240")) }
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("192.0.2.53", listOf("0.0.0.0")) }
    }

    @Test fun refusesNonIpv4Literals() {
        assertFailsWith<IllegalArgumentException> { WebsiteGateRouteConfig("not-an-ip", listOf("192.0.2.240")) }
    }
}
