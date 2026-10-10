package com.guarddog.core.events

/**
 * A genuine DNS-level threat observation — produced when a DNS query for a hostname
 * matching an active BLOCK rule is intercepted and answered with a sinkhole address.
 *
 * This is a DETECTION, not enforcement. A real connection to the sinkhole IP may
 * follow (producing BlockedThreatEvidence and then EnforcementEvidence), or the
 * browser may navigate away, close the tab, or be blocked by its own Safe Browsing
 * before a packet is ever sent.
 *
 * The observation MUST NOT claim a block occurred. It says: "Apollo observed a DNS
 * query for a known-dangerous hostname and redirected the answer to a sinkhole."
 */
data class DnsThreatObservation(
    /** Unique ID for deduplication. Format: "dns-obs-{hostname}-{epochMillis}" */
    val observationId: String,
    /** The canonicalized hostname that matched a BLOCK rule. */
    val hostname: String,
    /** The matched rule's identifier from the rule bundle (may be the hostname itself). */
    val ruleId: String?,
    /** The ruleset this rule belongs to (from the active bundle). */
    val rulesetId: String?,
    /** ISO-8601 UTC timestamp of the observation. */
    val observedAt: String,
    /** The decision: always "block" for observations that reach this model. */
    val decision: String = "block",
    /** The sinkhole IPv4 address the DNS answer was redirected to. */
    val sinkholeIpv4: String?,
    /** Coverage scope at the time of observation. */
    val coverageScope: String = "dns:ipv4-udp-53",
    /** Always "dns_observation" — never "enforcement" or "verified". */
    val evidenceType: String = "dns_observation",
)
