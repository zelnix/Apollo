import ExpoModulesCore

/// Explicit Expo Record for SecurityEvent (iOS). Domain models never cross the bridge implicitly.
struct BridgeSecurityEventDTO: Record {
    @Field var id: String = ""
    @Field var type: String = ""
    @Field var source: String = ""
    @Field var occurredAt: String = ""
    @Field var sanitizedUrl: String? = nil
    @Field var host: String? = nil
    @Field var destinationIp: String? = nil
    @Field var ruleId: String? = nil
    @Field var rulesetId: String? = nil
    @Field var bundleVersion: Double? = nil
    @Field var enforcementEvidenceId: String? = nil
    @Field var verdict: String? = nil
    @Field var protectionState: String? = nil
    @Field var reason: String? = nil
}

struct BridgeRuleBundleDTO: Record {
    @Field var accepted: Bool = false
    @Field var rejectReason: String? = nil
    @Field var rulesetId: String? = nil
    @Field var bundleVersion: Double? = nil
    @Field var keyId: String? = nil
    @Field var ruleCount: Double = 0
}

struct BridgeProtectionStateDTO: Record {
    @Field var state: String = "INACTIVE"
    @Field var consentGranted: Bool = false
    @Field var reason: String? = nil
    @Field var updatedAt: String = ""
}
