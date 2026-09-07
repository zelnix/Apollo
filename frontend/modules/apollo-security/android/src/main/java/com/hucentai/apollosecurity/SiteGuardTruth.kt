package com.hucentai.apollosecurity

/**
 * Pure truth-of-state derivation for Android Site Guard — no Android dependencies so it runs under plain JVM tests.
 * Mirrors ios/SiteGuardTruth.swift. The module feeds it live facts; it never stores or infers "operational".
 *
 *   requested   = the person's persisted intent
 *   vpnRunning  = ApolloDnsVpnService.isRunning, observed at this instant
 *   vpnGranted  = VpnService.prepare(ctx) == null, observed at this instant
 *
 * operational ⇔ requested AND vpnRunning. Any gap between requested and operational gets a plain-language reason.
 */
object SiteGuardTruth {
  data class Derived(
    val operational: Boolean,
    val enforcementMethod: String,
    val coverage: String,
    val coverageScope: List<String>,
    val degradedReason: String?,
    val visibility: String,
  )

  const val COVERAGE = "Covers DNS lookups over IPv4 UDP port 53 from apps that use the system resolver. Not covered: IPv6 DNS, DNS over TCP, private/encrypted DNS (DoH/DoT), apps with their own resolver, and traffic on networks using a captive portal."
  val COVERAGE_SCOPE = listOf("dns:ipv4", "dns:udp-53", "resolver:system")
  const val COVERAGE_NONE = "Nothing is being filtered on this device right now. Link checks you run in Apollo still work."
  const val REASON_PERMISSION = "The local VPN permission is missing or was revoked, so the DNS filter cannot run. Allow it under Permissions."
  const val REASON_NOT_RUNNING = "The DNS filter is not running (another VPN may have taken over, or Android stopped the service). Turn protection off and on again."

  fun derive(requested: Boolean, vpnRunning: Boolean, vpnGranted: Boolean): Derived {
    val operational = requested && vpnRunning
    val degraded: String? = when {
      !requested -> null
      operational -> null
      !vpnGranted -> REASON_PERMISSION
      else -> REASON_NOT_RUNNING
    }
    return Derived(
      operational = operational,
      enforcementMethod = if (operational) "dns_filter" else "none",
      coverage = if (operational) COVERAGE else COVERAGE_NONE,
      coverageScope = if (operational) COVERAGE_SCOPE else emptyList(),
      degradedReason = degraded,
      visibility = if (!requested) "none" else "limited",
    )
  }

  /** A block is VERIFIED only when the filter is running now AND the host is in the enforced set. Never from intent alone. */
  fun verifiedBlock(vpnRunning: Boolean, host: String, blocked: Set<String>): Boolean = vpnRunning && DnsPacket.matchesBlocked(host, blocked)
}
