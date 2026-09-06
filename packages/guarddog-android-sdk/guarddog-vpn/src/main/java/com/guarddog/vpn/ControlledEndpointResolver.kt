package com.guarddog.vpn

import java.net.Inet4Address
import java.net.InetAddress
import java.net.UnknownHostException

/** Resolver seam so the DNS/IP binding check is unit-testable without network. */
fun interface HostResolver {
    fun resolveIpv4(host: String): List<String>
}

object SystemHostResolver : HostResolver {
    override fun resolveIpv4(host: String): List<String> = try {
        InetAddress.getAllByName(host).filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
    } catch (e: UnknownHostException) {
        emptyList()
    }
}

sealed class BindingResult {
    data class Match(val ipv4: String) : BindingResult()
    data class Mismatch(val expected: String, val resolved: List<String>) : BindingResult()
    data class ResolutionFailed(val host: String) : BindingResult()
}

/**
 * DNS/IP binding validation. Called immediately before the /32 route is installed:
 * the canonical controlled host MUST resolve to exactly the configured dedicated IPv4.
 * Any other outcome aborts protection start (we never route an unexpected IP).
 */
class ControlledEndpointResolver(private val config: VpnConfig, private val resolver: HostResolver = SystemHostResolver) {
    fun verifyBinding(): BindingResult {
        val resolved = resolver.resolveIpv4(config.controlledHost)
        if (resolved.isEmpty()) return BindingResult.ResolutionFailed(config.controlledHost)
        // A dedicated static IP must be the ONLY A record; extra records indicate CDN/shared hosting.
        return if (resolved.size == 1 && resolved[0] == config.controlledIpv4) BindingResult.Match(resolved[0])
        else BindingResult.Mismatch(config.controlledIpv4, resolved)
    }
}
