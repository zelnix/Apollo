package com.guarddog.expo.dto

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Explicit Expo Record for SecurityEvent. Native SDK models never cross the bridge directly. */
class BridgeSecurityEventRecord : Record {
    @Field var id: String = ""
    @Field var type: String = ""
    @Field var source: String = ""
    @Field var occurredAt: String = ""
    @Field var sanitizedUrl: String? = null
    @Field var host: String? = null
    @Field var destinationIp: String? = null
    @Field var ruleId: String? = null
    @Field var rulesetId: String? = null
    @Field var bundleVersion: Double? = null
    @Field var enforcementEvidenceId: String? = null
    @Field var verdict: String? = null
    @Field var protectionState: String? = null
    @Field var reason: String? = null
}
