package com.guarddog.vpn

import android.net.VpnService
import android.system.OsConstants

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
    /** IPv6 is never intercepted: the family is explicitly allowed to bypass the tunnel (only the IPv4 /32 is routed). */
    val allowIpv6Bypass: Boolean = true,
) {
    val isSelective: Boolean get() = routes.size == 1 && routes[0].prefixLength == 32 && allowIpv6Bypass
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
        // Dual-stack devices: with no IPv6 address/route/DNS configured, Android BLOCKS all IPv6 traffic for the app set unless the family
        // is explicitly allowed (VpnService.Builder docs). Guard Dog intercepts exactly one IPv4 /32, so IPv6 must fall through untouched.
        if (spec.allowIpv6Bypass) builder.allowFamily(OsConstants.AF_INET6)
        // No DNS servers are set: we do not intercept DNS (see docs/M1_OBSERVED_TRAFFIC_PATH.md).
        return builder
    }
}
