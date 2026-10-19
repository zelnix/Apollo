package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WebsiteGatePacketAuthorizerTest {
    private val authorizer = WebsiteGatePacketAuthorizer("203.0.113.10", setOf("192.0.2.240", "192.0.2.241"))

    @Test fun classifiesTheM1ControlledDestination() {
        assertEquals(WebsiteGatePacketAuthorizer.Destination.M1_CONTROLLED, authorizer.classify("203.0.113.10"))
    }

    @Test fun classifiesASinkholePoolAddress() {
        assertEquals(WebsiteGatePacketAuthorizer.Destination.M2_SINKHOLE, authorizer.classify("192.0.2.240"))
    }

    @Test fun classifiesAnUnrelatedDestinationAsUnrecognized() {
        assertEquals(WebsiteGatePacketAuthorizer.Destination.UNRECOGNIZED, authorizer.classify("198.51.100.7"))
    }

    @Test fun refusesOverlapBetweenControlledEndpointAndSinkholePool() {
        assertFailsWith<IllegalArgumentException> { WebsiteGatePacketAuthorizer("192.0.2.240", setOf("192.0.2.240", "192.0.2.241")) }
    }

    @Test fun refusesEmptyPool() {
        assertFailsWith<IllegalArgumentException> { WebsiteGatePacketAuthorizer("203.0.113.10", emptySet()) }
    }
}
