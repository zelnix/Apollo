package com.hucentai.apollosecurity

/**
 * Pure data model for one enforcement action — mirrors src/security/PlatformCapabilityProfile.ts
 * EnforcementEvidence field-for-field so the JSON ApolloSecurityModule builds from this needs no
 * reshaping on the JS side beyond JSON.parse. No Android dependencies: testable under plain JVM,
 * same as DnsPacket.kt and SiteGuardTruth.kt.
 *
 * THE rule this file exists to protect: only [verifiedDnsBlock] may ever produce
 * result="verified" + enforcedAction="blocked" from an ACTUAL observed packet. Everything else
 * that touches enforcement (rule activation, a saved-but-not-enforced host) must say so honestly.
 */
data class EnforcementEvidence(
  val evidenceId: String,
  val eventId: String? = null,
  val deviceId: String? = null,
  val platform: String = "android",
  val osVersion: String? = null,
  val sdkVersion: String? = null,
  val observedAt: String,
  val mechanism: String,
  val direction: String,
  val protocol: String,
  val destinationIp: String? = null,
  val destinationDomain: String? = null,
  val destinationPort: Int? = null,
  val appId: String? = null,
  val processName: String? = null,
  val attributionConfidence: String = "unavailable",
  val matchedRuleId: String? = null,
  val threatId: String? = null,
  val requestedAction: String,
  val enforcedAction: String,
  val result: String,
  val ruleSource: String,
  val confidence: String,
  val correlationId: String? = null,
) {
  companion object {
    /**
     * The ONLY factory that may claim a verified DNS block. Called from ApolloDnsVpnService.handlePacket
     * at the exact moment a real IPv4/UDP/port-53 packet was matched against the on-device blocklist and
     * an NXDOMAIN reply was actually written back to the tunnel. Every field is a live fact about that
     * one packet — nothing here is inferred, scheduled, or assumed to have happened.
     */
    fun verifiedDnsBlock(evidenceId: String, observedAt: String, domain: String, matchedRuleId: String, osVersion: String?, sdkVersion: String?): EnforcementEvidence =
      EnforcementEvidence(
        evidenceId = evidenceId, observedAt = observedAt, mechanism = "dns_filter", direction = "outbound", protocol = "dns",
        destinationDomain = domain, destinationPort = 53, matchedRuleId = matchedRuleId, osVersion = osVersion, sdkVersion = sdkVersion,
        requestedAction = "block", enforcedAction = "blocked", result = "verified", ruleSource = "local_blocklist", confidence = "high",
      )

    /**
     * Rule-activation confirmation for a manual "Block" tap (ApolloSecurityModule.blockDestination):
     * the filter is observed live-running and this host is now in its enforced set, so every future
     * lookup for it WILL be answered by [verifiedDnsBlock]. Real (read from live OS/service state, not
     * client-supplied), but it is evidence of a rule going live — not of a specific packet drop. Callers
     * must not confuse the two when reasoning about what actually happened on the wire.
     */
    fun ruleActivated(evidenceId: String, observedAt: String, domain: String, osVersion: String?, sdkVersion: String?): EnforcementEvidence =
      EnforcementEvidence(
        evidenceId = evidenceId, observedAt = observedAt, mechanism = "dns_filter", direction = "outbound", protocol = "dns",
        destinationDomain = domain, destinationPort = 53, matchedRuleId = domain, osVersion = osVersion, sdkVersion = sdkVersion,
        requestedAction = "block", enforcedAction = "blocked", result = "verified", ruleSource = "user_override", confidence = "high",
      )
  }
}
