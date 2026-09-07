import Foundation

/// Trusted Ed25519 public keys by keyId (rollover: introduce/retire at runtime). Public keys only.
public final class TrustedKeyRegistry {
    public static let m1TestKeyId = "gd-m1-test-ed25519-001"
    public static let m1TestPublicKeyB64 = "ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac="

    private var keys: [String: Data] = [:]
    private let lock = NSLock()

    public init(_ initial: [String: String] = [:]) { for (k, v) in initial { try? trust(keyId: k, publicKeyB64: v) } }

    public static func m1Default() -> TrustedKeyRegistry { TrustedKeyRegistry([m1TestKeyId: m1TestPublicKeyB64]) }

    public enum Error: Swift.Error { case invalidKey }

    public func trust(keyId: String, publicKeyB64: String) throws {
        guard let raw = Data(base64Encoded: publicKeyB64), raw.count == 32 else { throw Error.invalidKey }
        lock.lock(); defer { lock.unlock() }
        keys[keyId] = raw
    }

    public func retire(keyId: String) { lock.lock(); defer { lock.unlock() }; keys.removeValue(forKey: keyId) }
    public func publicKey(for keyId: String) -> Data? { lock.lock(); defer { lock.unlock() }; return keys[keyId] }
}

/// Highest accepted bundle for a rulesetId plus the identity of its signed envelope (SHA-256 of the JCS canonical unsigned
/// envelope — everything the signature covers). `envelopeHash == nil` only for legacy records written before identity was persisted.
public struct AcceptedBundle: Equatable {
    public let bundleVersion: Int64
    public let envelopeHash: String?
    public init(bundleVersion: Int64, envelopeHash: String?) { self.bundleVersion = bundleVersion; self.envelopeHash = envelopeHash }

    /// Monotonic merge shared by every store: higher version replaces; equal version only pins a missing identity; lower is ignored.
    public static func merge(current: AcceptedBundle?, incoming: AcceptedBundle) -> AcceptedBundle {
        guard let current = current else { return incoming }
        if incoming.bundleVersion > current.bundleVersion { return incoming }
        if incoming.bundleVersion == current.bundleVersion && current.envelopeHash == nil { return AcceptedBundle(bundleVersion: current.bundleVersion, envelopeHash: incoming.envelopeHash) }
        return current
    }
}

/// Rollback protection store. Core ships in-memory; apps inject a persistent one (UserDefaults/Keychain).
/// Semantics (identical on Kotlin/Python): lower version -> ROLLBACK; higher -> accepted and recorded; equal version with the same
/// envelope identity (or a legacy record) -> accepted idempotently; equal version with a different identity -> VERSION_CONFLICT.
public protocol BundleVersionStore: AnyObject {
    func highestAccepted(rulesetId: String) -> AcceptedBundle?
    func recordAccepted(rulesetId: String, bundleVersion: Int64, envelopeHash: String?)
}

public final class InMemoryBundleVersionStore: BundleVersionStore {
    private var records: [String: AcceptedBundle] = [:]
    public init() {}
    public func highestAccepted(rulesetId: String) -> AcceptedBundle? { records[rulesetId] }
    public func recordAccepted(rulesetId: String, bundleVersion: Int64, envelopeHash: String?) {
        records[rulesetId] = AcceptedBundle.merge(current: records[rulesetId], incoming: AcceptedBundle(bundleVersion: bundleVersion, envelopeHash: envelopeHash))
    }
}

/// Injected clock for frozen-time tests.
public protocol Clock { func now() -> Date }
public struct SystemClock: Clock { public init() {}; public func now() -> Date { Date() } }
public struct FixedClock: Clock { public let date: Date; public init(_ date: Date) { self.date = date }; public func now() -> Date { date } }
