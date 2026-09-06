package com.guarddog.vpn

import android.net.VpnService

/** Pure description of the TUN we intend to establish (unit-testable without Android). */
data class RouteSpec(val address: String, val prefixLength: Int) {
    val cidr: String get() = "$address/$prefixLength"
}

data class TunSpec(
    val address: String,
    val addressPrefix: Int,
    val routes: List<RouteSpec>,
    val mtu: Int,
    val sessionName: String,
) {
    val isSelective: Boolean get() = routes.size == 1 && routes[0].prefixLength == 32
}

/**
 * Builds and applies the selective route. Only `controlledIpv4/32` is routed into the
 * tunnel. 0.0.0.0/0 is never used: everything else stays on the normal network path.
 */
object SelectiveRouteInstaller {
    fun buildSpec(config: VpnConfig, verifiedIpv4: String): TunSpec {
        require(verifiedIpv4 == config.controlledIpv4) { "route target must equal the DNS/IP-verified dedicated IPv4" }
        return TunSpec(
            address = config.tunAddress,
            addressPrefix = config.tunPrefix,
            routes = listOf(RouteSpec(verifiedIpv4, 32)),
            mtu = config.mtu,
            sessionName = config.sessionName,
        )
    }

    fun applyTo(builder: VpnService.Builder, spec: TunSpec): VpnService.Builder {
        check(spec.isSelective) { "refusing to install a non-selective route set" }
        builder.setSession(spec.sessionName)
            .setMtu(spec.mtu)
            .addAddress(spec.address, spec.addressPrefix)
            .setBlocking(true)
        spec.routes.forEach { builder.addRoute(it.address, it.prefixLength) }
        // No DNS servers are set: we do not intercept DNS (see docs/M1_OBSERVED_TRAFFIC_PATH.md).
        return builder
    }
}
