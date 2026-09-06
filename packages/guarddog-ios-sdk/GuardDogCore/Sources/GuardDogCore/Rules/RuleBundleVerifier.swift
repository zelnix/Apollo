import CryptoKit
import Foundation

public struct RuleEntry: Codable, Equatable {
    public let ruleId: String
    public let host: String
    public let action: String
    public let matchType: String
    public let category: String
}

public struct SignedRuleBundle: Codable, Equatable {
    public struct Payload: Codable, Equatable { public let rules: [RuleEntry] }
    public let schemaVersion: String
    public let rulesetId: String
    public let bundleVersion: Int64
    public let issuedAt: String
    public let expiresAt: String
    public let keyId: String
    public let payload: Payload
    public let payloadHash: String
    public let signature: String

    public func exactMatch(_ canonicalHost: String) -> RuleEntry? {
        payload.rules.first { $0.matchType == "exact" && $0.host == canonicalHost }
    }
}

public enum RejectReason: String {
    case schemaInvalid = "SCHEMA_INVALID"
    case payloadHashMismatch = "PAYLOAD_HASH_MISMATCH"
    case unknownKey = "UNKNOWN_KEY"
    case signatureInvalid = "SIGNATURE_INVALID"
    case notYetValid = "NOT_YET_VALID"
    case expired = "EXPIRED"
    case rollback = "ROLLBACK"
}

public enum VerificationResult: Equatable {
    case accepted(SignedRuleBundle)
    case rejected(RejectReason)
}

/// Independent on-device verification (Swift). Same order as Python/Kotlin:
/// schema -> payloadHash -> keyId known -> Ed25519 signature over JCS(unsigned envelope) -> time -> rollback.
public final class RuleBundleVerifier {
    private let keys: TrustedKeyRegistry
    private let versions: BundleVersionStore
    private let clock: Clock
    private static let envelopeKeys: Set<String> = ["schemaVersion", "rulesetId", "bundleVersion", "issuedAt", "expiresAt", "keyId", "payload", "payloadHash", "signature"]
    private static let ruleKeys: Set<String> = ["ruleId", "host", "action", "matchType", "category"]
    private static let idRegex = try! NSRegularExpression(pattern: "^[a-z0-9-]+$")
    private static let ruleIdRegex = try! NSRegularExpression(pattern: "^[A-Za-z0-9._:-]+$")
    private static let hexRegex = try! NSRegularExpression(pattern: "^[0-9a-f]{64}$")
    private static let isoRegex = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$")

    public init(keys: TrustedKeyRegistry, versions: BundleVersionStore, clock: Clock) {
        self.keys = keys; self.versions = versions; self.clock = clock
    }

    public func verify(rawJson: Data, rollbackProtected: Bool = true) -> VerificationResult {
        guard let root = (try? JSONSerialization.jsonObject(with: rawJson)) as? [String: Any],
              Set(root.keys).isSubset(of: Self.envelopeKeys),
              let bundle = Self.decodeStrict(root) else { return .rejected(.schemaInvalid) }

        guard let payloadObj = root["payload"], let payloadBytes = try? JCSCanonicalizer.canonicalData(payloadObj) else { return .rejected(.schemaInvalid) }
        if Self.sha256Hex(payloadBytes) != bundle.payloadHash { return .rejected(.payloadHashMismatch) }

        guard let publicKey = keys.publicKey(for: bundle.keyId) else { return .rejected(.unknownKey) }

        var unsigned = root
        unsigned.removeValue(forKey: "signature")
        guard let message = try? JCSCanonicalizer.canonicalData(unsigned),
              let signature = Data(base64Encoded: bundle.signature), signature.count == 64,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(signature, for: message) else { return .rejected(.signatureInvalid) }

        guard let issued = Self.parseIso(bundle.issuedAt), let expires = Self.parseIso(bundle.expiresAt) else { return .rejected(.schemaInvalid) }
        let now = clock.now()
        if issued > now { return .rejected(.notYetValid) }
        if expires <= now { return .rejected(.expired) }

        if rollbackProtected {
            if let highest = versions.highestAccepted(rulesetId: bundle.rulesetId), bundle.bundleVersion <= highest { return .rejected(.rollback) }
            versions.recordAccepted(rulesetId: bundle.rulesetId, bundleVersion: bundle.bundleVersion)
        }
        return .accepted(bundle)
    }

    /// Strict decoding: exact types (no "3" for Int64, no 3.0), exact key sets, regex constraints.
    private static func decodeStrict(_ root: [String: Any]) -> SignedRuleBundle? {
        func str(_ k: String, _ re: NSRegularExpression? = nil) -> String? {
            guard let v = root[k] as? String else { return nil }
            if let re = re, !HostCanonicalizer.matches(re, v) { return nil }
            return v
        }
        guard let schemaVersion = str("schemaVersion"), schemaVersion == "1.0",
              let rulesetId = str("rulesetId", idRegex), let keyId = str("keyId", idRegex),
              let issuedAt = str("issuedAt", isoRegex), let expiresAt = str("expiresAt", isoRegex),
              let payloadHash = str("payloadHash", hexRegex), let signature = str("signature"), signature.count == 88,
              let versionNum = root["bundleVersion"] as? NSNumber, CFGetTypeID(versionNum) != CFBooleanGetTypeID(),
              CFNumberIsFloatType(versionNum) == false, versionNum.int64Value >= 1,
              let payload = root["payload"] as? [String: Any], Set(payload.keys) == ["rules"],
              let rulesRaw = payload["rules"] as? [[String: Any]], !rulesRaw.isEmpty else { return nil }
        var rules: [RuleEntry] = []
        for r in rulesRaw {
            guard Set(r.keys).isSubset(of: ruleKeys),
                  let ruleId = r["ruleId"] as? String, HostCanonicalizer.matches(ruleIdRegex, ruleId),
                  let host = r["host"] as? String, !host.isEmpty,
                  let action = r["action"] as? String, action == "block" || action == "allow",
                  let matchType = r["matchType"] as? String, matchType == "exact",
                  let category = r["category"] as? String, !category.isEmpty else { return nil }
            rules.append(RuleEntry(ruleId: ruleId, host: host, action: action, matchType: matchType, category: category))
        }
        return SignedRuleBundle(schemaVersion: schemaVersion, rulesetId: rulesetId, bundleVersion: versionNum.int64Value, issuedAt: issuedAt,
                                expiresAt: expiresAt, keyId: keyId, payload: .init(rules: rules), payloadHash: payloadHash, signature: signature)
    }

    static func sha256Hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    static func parseIso(_ s: String) -> Date? {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return f.date(from: s)
    }
}
