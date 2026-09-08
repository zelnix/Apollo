package com.guarddog.expo.dto

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Gate Guard M2 Website Gate: JS-supplied runtime knobs only. The sinkhole pool and virtual DNS
 * gateway address themselves are NEVER bridge-supplied -- they are always the fixed native
 * `WebsiteGateAddressing` constants, so a compromised or buggy JS layer can never redirect
 * Apollo's own DNS interception anywhere else.
 */
class BridgeWebsiteGateConfigRecord : Record {
    /** Real upstream DNS resolver Apollo forwards non-block queries to. Null/omitted means no
     * upstream is configured -- non-block queries then fail open by silence (no forwarding), not
     * by fabricating an allow answer. */
    @Field var upstreamDnsResolverIpv4: String? = null
    @Field var bindingLifetimeMs: Double = 30_000.0
}

/** Truthful, live snapshot of the Website Gate's native state -- see GuardDogVpnRuntime.websiteGateActive. */
class BridgeWebsiteGateStatusRecord : Record {
    @Field var configured: Boolean = false
    @Field var dnsGatewayActive: Boolean = false
    @Field var acceptedRulesetId: String? = null
    @Field var acceptedBundleVersion: Double? = null
    @Field var acceptedKeyId: String? = null
    @Field var overrideCount: Double = 0.0
}

/** A single local, on-device, user-controlled ALLOW-only override request. See WebsiteGateOverrideStore. */
class BridgeWebsiteGateOverrideRecord : Record {
    @Field var host: String = ""
    @Field var allowed: Boolean = true
}
