package com.guarddog.vpn

/**
 * Injected controlled-endpoint configuration. Never hardcode production infrastructure;
 * values arrive from the app/bridge (e.g. backend /api/config) at runtime.
 */
data class VpnConfig(
    val controlledHost: String,
    val controlledIpv4: String,
    val controlledUrl: String,
    val rulesetId: String,
    val dedupeWindowMillis: Long = 5_000L,
    /** Private, unrouted TUN interface address. Only the /32 route below is installed. */
    val tunAddress: String = "10.255.255.2",
    val tunPrefix: Int = 32,
    val mtu: Int = 1500,
    val sessionName: String = "Guard Dog M1 selective block",
) {
    init {
        require(IPV4.matches(controlledIpv4)) { "controlledIpv4 must be a dotted IPv4 literal" }
        require(controlledHost.isNotBlank()) { "controlledHost required" }
        require(rulesetId.isNotBlank()) { "rulesetId required" }
        require(dedupeWindowMillis > 0) { "dedupeWindowMillis must be positive" }
    }

    companion object {
        val IPV4 = Regex("^(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    }
}
