import ExpoModulesCore
import GuardDogCore

/// iOS Expo module. Same platform-neutral surface as Android; honest M1 behavior:
/// requestPermission("vpn") -> "unsupported", startProtection() -> analysis-only state.
public class GuardDogExpoModule: Module {
    private let keys = TrustedKeyRegistry.m1Default()
    private lazy var verifier = RuleBundleVerifier(keys: keys, versions: UserDefaultsBundleVersionStore(), clock: SystemClock())
    private var acceptedBundle: SignedRuleBundle?
    private let capabilities: CapabilityProvider = StaticCapabilityProvider(.iosM1)

    public func definition() -> ModuleDefinition {
        Name("GuardDogSecurity")
        Events("onSecurityEvent", "onProtectionStateChanged")

        Function("getCapabilities") { ExpoBridgeAdapters.toDTO(self.capabilities.currentCapabilities()) }

        Function("getProtectionState") { self.state(reason: "iOS M1: analysis and warning only") }

        Function("configure") { (_: [String: Any]) in /* no enforcement config on iOS */ }

        Function("acceptRuleBundle") { (rawJson: String) -> BridgeRuleBundleDTO in
            let result = self.verifier.verify(rawJson: Data(rawJson.utf8))
            if case .accepted(let b) = result {
                self.acceptedBundle = b
                self.emit(SecurityEvent(id: UUID().uuidString, type: .ruleBundleAccepted, source: .ruleVerifier, occurredAt: Self.now(), rulesetId: b.rulesetId, bundleVersion: b.bundleVersion))
            } else if case .rejected(let r) = result {
                self.emit(SecurityEvent(id: UUID().uuidString, type: .ruleBundleRejected, source: .ruleVerifier, occurredAt: Self.now(), reason: r.rawValue))
            }
            return ExpoBridgeAdapters.toDTO(result)
        }

        Function("analyzeUrl") { (url: String) -> [String: Any?]? in
            guard let parsed = UrlSanitizer.sanitize(url) else { return nil }
            let rule = self.acceptedBundle?.exactMatch(parsed.host)
            if let rule = rule {
                self.emit(SecurityEvent(id: UUID().uuidString, type: .threatDetected, source: .localAnalysis, occurredAt: Self.now(), sanitizedUrl: parsed.sanitizedUrl,
                                        host: parsed.host, ruleId: rule.ruleId, rulesetId: self.acceptedBundle?.rulesetId, bundleVersion: self.acceptedBundle?.bundleVersion, verdict: rule.action))
            }
            return ["sanitizedUrl": parsed.sanitizedUrl, "host": parsed.host, "verdict": rule?.action ?? "unknown", "ruleId": rule?.ruleId]
        }

        AsyncFunction("requestPermission") { (_: String) -> String in "unsupported" }
        AsyncFunction("startProtection") { () -> BridgeProtectionStateDTO in self.state(reason: "iOS M1 has no enforcement layer") }
        AsyncFunction("stopProtection") { () -> BridgeProtectionStateDTO in self.state(reason: nil) }
        Function("getEnforcementStats") { () -> [String: Any]? in nil }
        // iOS never installs a route or TUN: the honest snapshot is "nothing to recover".
        Function("getRecoveryStatus") { () -> [String: Any?] in
            ["lifecycle": "INACTIVE", "tunOpen": false, "selectiveRouteActive": false, "vpnTransportPresent": false,
             "routeCidr": nil, "dropReporterAttached": false, "recovered": true]
        }
    }

    private func emit(_ event: SecurityEvent) {
        guard let dto = ExpoBridgeAdapters.toDTO(event) else { return }
        sendEvent("onSecurityEvent", dto.toDictionary())
    }

    private func state(reason: String?) -> BridgeProtectionStateDTO {
        var dto = BridgeProtectionStateDTO()
        dto.state = "INACTIVE"; dto.consentGranted = false; dto.reason = reason; dto.updatedAt = Self.now()
        return dto
    }

    private static func now() -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date())
    }
}

final class UserDefaultsBundleVersionStore: BundleVersionStore {
    private let defaults = UserDefaults.standard
    func highestAccepted(rulesetId: String) -> Int64? {
        defaults.object(forKey: "gd.bundleVersion.\(rulesetId)") == nil ? nil : Int64(defaults.integer(forKey: "gd.bundleVersion.\(rulesetId)"))
    }
    func recordAccepted(rulesetId: String, bundleVersion: Int64) {
        if bundleVersion > (highestAccepted(rulesetId: rulesetId) ?? -1) { defaults.set(Int(bundleVersion), forKey: "gd.bundleVersion.\(rulesetId)") }
    }
}
