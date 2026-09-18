import Foundation
import GuardDogCore

/// Explicit domain -> DTO adapters (iOS). Also the bridge-side truthfulness gate:
/// iOS has no enforcement layer in M1, so a THREAT_BLOCKED can never be emitted from here.
enum ExpoBridgeAdapters {
    static let sanitizedUrlShape = try! NSRegularExpression(pattern: "^https?://[^\\s/?#@]+(/[^\\s?#]*)?$")

    static func toDTO(_ event: SecurityEvent) -> BridgeSecurityEventDTO? {
        if event.type == .threatBlocked { return nil } // iOS M1: analysis/warning only. Never claim a block.
        if let url = event.sanitizedUrl {
            let probe = url.replacingOccurrences(of: "^(https?://)\\[[^\\]]+\\]", with: "$1x", options: .regularExpression)
            if sanitizedUrlShape.firstMatch(in: probe, range: NSRange(probe.startIndex..., in: probe)) == nil { return nil }
        }
        var dto = BridgeSecurityEventDTO()
        dto.id = event.id; dto.type = event.type.rawValue; dto.source = event.source.rawValue; dto.occurredAt = event.occurredAt
        dto.sanitizedUrl = event.sanitizedUrl; dto.host = event.host; dto.destinationIp = event.destinationIp; dto.ruleId = event.ruleId
        dto.rulesetId = event.rulesetId; dto.bundleVersion = event.bundleVersion.map(Double.init); dto.enforcementEvidenceId = event.enforcementEvidenceId
        dto.verdict = event.verdict; dto.protectionState = event.protectionState; dto.reason = event.reason
        return dto
    }

    static func toDTO(_ caps: ProtectionCapabilities) -> BridgeCapabilityDTO {
        var dto = BridgeCapabilityDTO()
        dto.platform = caps.platform; dto.selectiveIpBlocking = caps.selectiveIpBlocking; dto.hostnameVisibility = caps.hostnameVisibility
        dto.dnsInterception = caps.dnsInterception; dto.dohDotCoverage = caps.dohDotCoverage; dto.quicHttp3Coverage = caps.quicHttp3Coverage
        dto.perAppAttribution = caps.perAppAttribution; dto.universalDeviceProtection = caps.universalDeviceProtection
        dto.analysisAndWarningOnly = caps.analysisAndWarningOnly; dto.vpnConsentRequired = caps.vpnConsentRequired
        return dto
    }

    static func toDTO(_ result: VerificationResult) -> BridgeRuleBundleDTO {
        var dto = BridgeRuleBundleDTO()
        switch result {
        case .accepted(let b):
            dto.accepted = true; dto.rulesetId = b.rulesetId; dto.bundleVersion = Double(b.bundleVersion); dto.keyId = b.keyId; dto.ruleCount = Double(b.payload.rules.count)
        case .rejected(let reason):
            dto.accepted = false; dto.rejectReason = reason.rawValue
        }
        return dto
    }
}
