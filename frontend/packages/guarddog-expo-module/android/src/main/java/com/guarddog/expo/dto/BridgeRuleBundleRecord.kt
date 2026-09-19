package com.guarddog.expo.dto

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Result of on-device bundle verification returned to JS. */
class BridgeRuleBundleRecord : Record {
    @Field var accepted: Boolean = false
    @Field var rejectReason: String? = null
    @Field var rulesetId: String? = null
    @Field var bundleVersion: Double? = null
    @Field var keyId: String? = null
    @Field var ruleCount: Double = 0.0
}

/** Injected controlled-endpoint configuration from JS (test environment setup only). */
class BridgeProtectionConfigRecord : Record {
    @Field var controlledHost: String = ""
    @Field var controlledIpv4: String = ""
    @Field var controlledUrl: String = ""
    @Field var rulesetId: String = ""
    @Field var dedupeWindowMs: Double = 5000.0
}

class BridgeProtectionStateRecord : Record {
    @Field var state: String = "INACTIVE"
    @Field var consentGranted: Boolean = false
    @Field var reason: String? = null
    @Field var updatedAt: String = ""
}
