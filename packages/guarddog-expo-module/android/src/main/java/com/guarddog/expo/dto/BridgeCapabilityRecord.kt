package com.guarddog.expo.dto

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Honest capability statement. Mirrors packages/guarddog-contracts/src/capabilities.ts */
class BridgeCapabilityRecord : Record {
    @Field var platform: String = "android"
    @Field var selectiveIpBlocking: Boolean = false
    @Field var hostnameVisibility: String = "none"
    @Field var dnsInterception: Boolean = false
    @Field var dohDotCoverage: Boolean = false
    @Field var quicHttp3Coverage: Boolean = false
    @Field var perAppAttribution: Boolean = false
    @Field var universalDeviceProtection: Boolean = false
    @Field var analysisAndWarningOnly: Boolean = false
    @Field var vpnConsentRequired: Boolean = true
}
