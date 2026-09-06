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

/// Rollback protection store. Core ships in-memory; apps inject a persistent one (UserDefaults/Keychain).
public protocol BundleVersionStore: AnyObject {
    func highestAccepted(rulesetId: String) -> Int64?
    func recordAccepted(rulesetId: String, bundleVersion: Int64)
}

public final class InMemoryBundleVersionStore: BundleVersionStore {
    private var versions: [String: Int64] = [:]
    public init() {}
    public func highestAccepted(rulesetId: String) -> Int64? { versions[rulesetId] }
    public func recordAccepted(rulesetId: String, bundleVersion: Int64) { versions[rulesetId] = max(versions[rulesetId] ?? 0, bundleVersion) }
}

/// Injected clock for frozen-time tests.
public protocol Clock { func now() -> Date }
public struct SystemClock: Clock { public init() {}; public func now() -> Date { Date() } }
public struct FixedClock: Clock { public let date: Date; public init(_ date: Date) { self.date = date }; public func now() -> Date { date } }
