import ExpoModulesCore

/// Honest capability statement DTO. Mirrors packages/guarddog-contracts/src/capabilities.ts
struct BridgeCapabilityDTO: Record {
    @Field var platform: String = "ios"
    @Field var selectiveIpBlocking: Bool = false
    @Field var hostnameVisibility: String = "none"
    @Field var dnsInterception: Bool = false
    @Field var dohDotCoverage: Bool = false
    @Field var quicHttp3Coverage: Bool = false
    @Field var perAppAttribution: Bool = false
    @Field var universalDeviceProtection: Bool = false
    @Field var analysisAndWarningOnly: Bool = true
    @Field var vpnConsentRequired: Bool = false
}
