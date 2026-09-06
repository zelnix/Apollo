import Foundation

/// Honest capability statement (mirrors packages/guarddog-contracts/src/capabilities.ts).
public struct ProtectionCapabilities: Equatable, Codable {
    public var platform: String
    public var selectiveIpBlocking: Bool
    public var hostnameVisibility: String
    public let dnsInterception: Bool = false
    public let dohDotCoverage: Bool = false
    public let quicHttp3Coverage: Bool = false
    public let perAppAttribution: Bool = false
    public let universalDeviceProtection: Bool = false
    public var analysisAndWarningOnly: Bool
    public var vpnConsentRequired: Bool

    public init(platform: String, selectiveIpBlocking: Bool, hostnameVisibility: String, analysisAndWarningOnly: Bool, vpnConsentRequired: Bool) {
        self.platform = platform
        self.selectiveIpBlocking = selectiveIpBlocking
        self.hostnameVisibility = hostnameVisibility
        self.analysisAndWarningOnly = analysisAndWarningOnly
        self.vpnConsentRequired = vpnConsentRequired
    }

    /// iOS M1 position: analysis + warning only. No enforcement claims.
    public static let iosM1 = ProtectionCapabilities(platform: "ios", selectiveIpBlocking: false, hostnameVisibility: "none", analysisAndWarningOnly: true, vpnConsentRequired: false)
}

/// Injected capability probe. GuardDogNetworkFeasibility implements this; core never imports it
/// (breaks the previous circular package relationship).
public protocol CapabilityProvider {
    func currentCapabilities() -> ProtectionCapabilities
}

public struct StaticCapabilityProvider: CapabilityProvider {
    private let value: ProtectionCapabilities
    public init(_ value: ProtectionCapabilities = .iosM1) { self.value = value }
    public func currentCapabilities() -> ProtectionCapabilities { value }
}
