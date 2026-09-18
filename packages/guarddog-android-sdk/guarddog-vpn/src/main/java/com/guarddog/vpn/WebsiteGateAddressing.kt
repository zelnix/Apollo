package com.guarddog.vpn

/**
 * Gate Guard M2 Website Gate: the fixed, enumerable virtual DNS endpoint + sinkhole pool.
 * Validated (never just documented) by the `require` checks below and by
 * [SelectiveRouteInstaller.isSelective] at route-install time.
 *
 * Deliberately drawn from RFC 5737 TEST-NET-1 (192.0.2.0/24) -- reserved for documentation/example
 * use, never a real routable Internet destination:
 *  - never RFC1918 (10/8, 172.16/12, 192.168/16): those can collide with the user's own LAN,
 *    home router, corporate network, or another VPN's address space.
 *  - never loopback (127.0.0.0/8): loopback has OS-level semantics independent of the TUN and
 *    would introduce exactly the platform ambiguity this design avoids.
 * Installed as explicit /32 routes only -- never a /24, never a default route.
 */
object WebsiteGateAddressing {
    const val DNS_GATEWAY_IPV4 = "192.0.2.53"
    val SINKHOLE_POOL: List<String> = listOf("192.0.2.240", "192.0.2.241", "192.0.2.242", "192.0.2.243")

    fun defaultRouteConfig(): WebsiteGateRouteConfig = WebsiteGateRouteConfig(DNS_GATEWAY_IPV4, SINKHOLE_POOL)
}

/**
 * Pure, unit-testable description of the M2 addresses [SelectiveRouteInstaller] will additively
 * route into the TUN alongside the M1 controlled /32. A hard runtime `init` check, not a comment:
 * every field is validated to be a dotted IPv4 literal, non-overlapping, unique, and never
 * `0.0.0.0` (the installer's [TunSpec.isSelective] check is the second, independent guard against
 * ever installing a default route).
 */
data class WebsiteGateRouteConfig(
    val dnsGatewayIpv4: String,
    val sinkholePool: List<String>,
) {
    init {
        require(VpnConfig.IPV4.matches(dnsGatewayIpv4)) { "dnsGatewayIpv4 must be a dotted IPv4 literal" }
        require(dnsGatewayIpv4 != "0.0.0.0") { "the DNS gateway address must never be the default route address" }
        require(sinkholePool.isNotEmpty()) { "sinkhole pool must not be empty" }
        sinkholePool.forEach {
            require(VpnConfig.IPV4.matches(it)) { "sinkhole pool entries must be dotted IPv4 literals" }
            require(it != "0.0.0.0") { "the sinkhole pool must never contain the default route address" }
        }
        require(sinkholePool.toSet().size == sinkholePool.size) { "sinkhole pool entries must be unique" }
        require(dnsGatewayIpv4 !in sinkholePool) { "the DNS gateway address must not overlap the sinkhole pool" }
    }
}
