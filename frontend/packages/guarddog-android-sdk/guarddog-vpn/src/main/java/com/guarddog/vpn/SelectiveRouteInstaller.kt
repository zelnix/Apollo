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
    /** IPv6 is never intercepted: the family is explicitly allowed to bypass the tunnel (only the IPv4 /32(s) below are routed). */
    val allowIpv6Bypass: Boolean = true,
    /** Gate Guard M2 Website Gate: the fixed virtual DNS endpoint, set as the TUN's DNS server so
     * the OS directs system DNS lookups here. Empty (the M1 default) means DNS is never
     * intercepted -- `addDnsServer` is never called, exactly as before this feature existed. */
    val dnsServers: List<String> = emptyList(),
) {
    /**
     * Hard runtime invariant, not a comment: every routed address must be an explicit /32 that is
     * neither the IPv4 nor the IPv6 default-route address. Under M1 this was "exactly one /32";
     * Gate Guard M2 additively routes the fixed DNS gateway + sinkhole pool /32s alongside it, so
     * the check generalizes to "every route is a /32, none is a default route" -- still never
     * `0.0.0.0/0`, still never `::/0`, still never a dynamically-supplied arbitrary range.
     */
    val isSelective: Boolean get() =
        allowIpv6Bypass &&
            routes.isNotEmpty() &&
            routes.all { it.prefixLength == 32 && it.address != "0.0.0.0" && it.address != "::" }
}

/**
 * Builds and applies the selective route. Only `controlledIpv4/32` (M1) and, additively, the fixed
 * M2 DNS gateway/sinkhole pool /32s are routed into the tunnel. 0.0.0.0/0 is never used: everything
 * else stays on the normal network path.
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

    /**
     * Gate Guard M2 Website Gate: additive route builder used only when the adapter's DNS/sinkhole
     * plumbing is wired in. Reuses [buildSpec]'s exact M1 verification unchanged and adds exactly
     * the fixed, enumerable virtual DNS endpoint + sinkhole pool from [websiteGate] -- never a
     * default route, never a dynamically-supplied range. Callers that never build a website-gate
     * spec keep calling [buildSpec] directly and are completely unaffected by this function.
     */
    fun buildWebsiteGateSpec(config: VpnConfig, verifiedIpv4: String, websiteGate: WebsiteGateRouteConfig): TunSpec {
        val base = buildSpec(config, verifiedIpv4)
        val extraRoutes = (listOf(websiteGate.dnsGatewayIpv4) + websiteGate.sinkholePool).map { RouteSpec(it, 32) }
        return base.copy(
            routes = base.routes + extraRoutes,
            dnsServers = listOf(websiteGate.dnsGatewayIpv4),
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
        // is explicitly allowed (VpnService.Builder docs). Guard Dog intercepts explicit IPv4 /32s only, so IPv6 must fall through untouched.
        if (spec.allowIpv6Bypass) builder.allowFamily(OsConstants.AF_INET6)
        // M1 default: dnsServers is empty, so addDnsServer is never called -- DNS is never intercepted (see docs/M1_OBSERVED_TRAFFIC_PATH.md).
        // Gate Guard M2 Website Gate: exactly the fixed virtual DNS endpoint from WebsiteGateRouteConfig, never a user/network-supplied value.
        spec.dnsServers.forEach { builder.addDnsServer(it) }
        return builder
    }
}
