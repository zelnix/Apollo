import Foundation

/// Mirrors packages/guarddog-contracts/src/securityEvent.ts. Expo-independent.
public enum SecurityEventType: String, Codable {
    case threatBlocked = "THREAT_BLOCKED"
    case threatDetected = "THREAT_DETECTED"
    case protectionStateChanged = "PROTECTION_STATE_CHANGED"
    case ruleBundleAccepted = "RULE_BUNDLE_ACCEPTED"
    case ruleBundleRejected = "RULE_BUNDLE_REJECTED"
}

public enum SecurityEventSource: String, Codable {
    case androidVpnEnforcement = "android-vpn-enforcement"
    case localAnalysis = "local-analysis"
    case ruleVerifier = "rule-verifier"
    case protectionLifecycle = "protection-lifecycle"
}

public struct SecurityEvent: Codable, Equatable {
    public var id: String
    public var type: SecurityEventType
    public var source: SecurityEventSource
    public var occurredAt: String
    public var sanitizedUrl: String?
    public var host: String?
    public var destinationIp: String?
    public var ruleId: String?
    public var rulesetId: String?
    public var bundleVersion: Int64?
    public var enforcementEvidenceId: String?
    public var verdict: String?
    public var protectionState: String?
    public var reason: String?

    public init(id: String, type: SecurityEventType, source: SecurityEventSource, occurredAt: String, sanitizedUrl: String? = nil, host: String? = nil,
                destinationIp: String? = nil, ruleId: String? = nil, rulesetId: String? = nil, bundleVersion: Int64? = nil,
                enforcementEvidenceId: String? = nil, verdict: String? = nil, protectionState: String? = nil, reason: String? = nil) {
        self.id = id; self.type = type; self.source = source; self.occurredAt = occurredAt; self.sanitizedUrl = sanitizedUrl; self.host = host
        self.destinationIp = destinationIp; self.ruleId = ruleId; self.rulesetId = rulesetId; self.bundleVersion = bundleVersion
        self.enforcementEvidenceId = enforcementEvidenceId; self.verdict = verdict; self.protectionState = protectionState; self.reason = reason
    }

    /// iOS never produces this in M1: there is no enforcement layer. Kept for contract parity.
    public var isGenuineBlock: Bool {
        type == .threatBlocked && source == .androidVpnEnforcement && !(enforcementEvidenceId ?? "").isEmpty
    }
}
