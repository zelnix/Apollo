import XCTest
@testable import GuardDogCore

/// Cross-language parity: same fixtures, same outcomes as Python (test_python_kotlin_swift_parity_manifest.py) and Kotlin.
final class RuleBundleVerifierParityTests: XCTestCase {
    let frozen = FixedClock(RuleBundleVerifier.parseIso("2026-06-15T00:00:00Z")!)

    func verifier(_ store: BundleVersionStore = InMemoryBundleVersionStore(), keys: TrustedKeyRegistry = .m1Default()) -> RuleBundleVerifier {
        RuleBundleVerifier(keys: keys, versions: store, clock: frozen)
    }

    func testCanonicalBytesMatchReference() throws {
        let envelope = try JSONSerialization.jsonObject(with: TestVectors.load("jcs/unsigned_envelope.json"))
        let expectedHex = String(decoding: try TestVectors.load("jcs/canonical_bytes.hex"), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let actual = try JCSCanonicalizer.canonicalData(envelope).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(actual, expectedHex)
    }

    func testValidAccepted() throws {
        guard case .accepted(let b) = verifier().verify(rawJson: try TestVectors.load("signing/valid_bundle.json")) else { return XCTFail("expected accepted") }
        XCTAssertEqual(b.bundleVersion, 3)
        XCTAssertEqual(b.exactMatch("m1-block-test.guarddog.example")?.action, "block")
    }

    func assertRejected(_ path: String, _ reason: RejectReason, _ v: RuleBundleVerifier? = nil, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual((v ?? verifier()).verify(rawJson: try TestVectors.load(path)), .rejected(reason), path, file: file, line: line)
    }

    func testManifestRejections() throws {
        try assertRejected("jcs/invalid_signature_bundle.json", .signatureInvalid)
        try assertRejected("jcs/modified_payload_bundle.json", .signatureInvalid)
        try assertRejected("jcs/modified_expiry_bundle.json", .signatureInvalid)
        try assertRejected("jcs/modified_bundle_version_bundle.json", .signatureInvalid)
        try assertRejected("jcs/modified_ruleset_id_bundle.json", .signatureInvalid)
        try assertRejected("jcs/modified_key_id_bundle.json", .unknownKey)
        try assertRejected("jcs/invalid_payload_hash_bundle.json", .payloadHashMismatch)
        try assertRejected("signing/tampered_payload_bundle.json", .payloadHashMismatch)
        try assertRejected("signing/expired_bundle.json", .expired)
        try assertRejected("signing/unknown_key_bundle.json", .unknownKey)
    }

    private let ruleset = "gd-m1-controlled-block"
    private func envelopeHash(_ path: String) throws -> String {
        var root = try JSONSerialization.jsonObject(with: try TestVectors.load(path)) as! [String: Any]
        root.removeValue(forKey: "signature")
        return RuleBundleVerifier.sha256Hex(try JCSCanonicalizer.canonicalData(root))
    }

    /// Physical M1 finding: the same authentic bundle must be accepted again after restart (same version is NOT a rollback).
    func testSameTrustedBundleAcceptedIdempotentlyAcrossRestarts() throws {
        let store = InMemoryBundleVersionStore()
        guard case .accepted = verifier(store).verify(rawJson: try TestVectors.load("signing/valid_bundle.json")) else { return XCTFail("first acceptance") }
        XCTAssertEqual(store.highestAccepted(rulesetId: ruleset), AcceptedBundle(bundleVersion: 3, envelopeHash: try envelopeHash("signing/valid_bundle.json")))
        let afterRestart = verifier(store)
        guard case .accepted = afterRestart.verify(rawJson: try TestVectors.load("signing/valid_bundle.json")) else { return XCTFail("idempotent re-verification") }
        XCTAssertEqual(store.highestAccepted(rulesetId: ruleset)?.bundleVersion, 3)
        try assertRejected("signing/rollback_bundle.json", .rollback, afterRestart)
    }

    func testSameVersionDifferentEnvelopeIsAConflict() throws {
        let store = InMemoryBundleVersionStore()
        let other = String(repeating: "0", count: 64)
        store.recordAccepted(rulesetId: ruleset, bundleVersion: 3, envelopeHash: other)
        try assertRejected("signing/valid_bundle.json", .versionConflict, verifier(store))
        XCTAssertEqual(store.highestAccepted(rulesetId: ruleset), AcceptedBundle(bundleVersion: 3, envelopeHash: other))
    }

    func testLegacyVersionOnlyRecordAcceptsSameVersionAndPinsIdentity() throws {
        let store = InMemoryBundleVersionStore()
        store.recordAccepted(rulesetId: ruleset, bundleVersion: 3, envelopeHash: nil)
        guard case .accepted = verifier(store).verify(rawJson: try TestVectors.load("signing/valid_bundle.json")) else { return XCTFail("legacy record must accept the same version") }
        XCTAssertEqual(store.highestAccepted(rulesetId: ruleset)?.envelopeHash, try envelopeHash("signing/valid_bundle.json"))
    }

    func testRejectedBundlesNeverAdvanceRollbackState() throws {
        let store = InMemoryBundleVersionStore()
        let v = verifier(store)
        try assertRejected("signing/tampered_payload_bundle.json", .payloadHashMismatch, v)
        try assertRejected("signing/unknown_key_bundle.json", .unknownKey, v)
        try assertRejected("signing/expired_bundle.json", .expired, v)
        XCTAssertNil(store.highestAccepted(rulesetId: ruleset))
    }

    func testKeyRollover() throws {
        let keys = TrustedKeyRegistry.m1Default()
        let v = verifier(keys: keys)
        try assertRejected("signing/unknown_key_bundle.json", .unknownKey, v)
        try keys.trust(keyId: "gd-m1-test-ed25519-002", publicKeyB64: "tjHUbcOwKuqnHFAMkoiurrgdJDbO7g6FXV7Y5nMwzSg=")
        guard case .accepted = v.verify(rawJson: try TestVectors.load("signing/unknown_key_bundle.json")) else { return XCTFail("rollover key should be accepted") }
        try assertRejected("jcs/modified_key_id_bundle.json", .signatureInvalid, v)
        keys.retire(keyId: TrustedKeyRegistry.m1TestKeyId)
        try assertRejected("signing/valid_bundle.json", .unknownKey, verifier(keys: keys))
    }

    func testStrictSchema() throws {
        let valid = String(decoding: try TestVectors.load("signing/valid_bundle.json"), as: UTF8.self)
        for mutated in [valid.replacingOccurrences(of: "\"bundleVersion\": 3", with: "\"bundleVersion\": \"3\""),
                        valid.replacingOccurrences(of: "\"bundleVersion\": 3", with: "\"bundleVersion\": 3.5"),
                        valid.replacingOccurrences(of: "\"schemaVersion\"", with: "\"extra\": 1, \"schemaVersion\"")] {
            XCTAssertEqual(verifier().verify(rawJson: Data(mutated.utf8)), .rejected(.schemaInvalid))
        }
    }
}
