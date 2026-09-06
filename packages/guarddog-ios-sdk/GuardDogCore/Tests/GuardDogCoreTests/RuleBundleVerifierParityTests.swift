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

    func testRollback() throws {
        let store = InMemoryBundleVersionStore()
        let v = verifier(store)
        _ = v.verify(rawJson: try TestVectors.load("signing/valid_bundle.json"))
        XCTAssertEqual(store.highestAccepted(rulesetId: "gd-m1-controlled-block"), 3)
        try assertRejected("signing/rollback_bundle.json", .rollback, v)
        try assertRejected("signing/valid_bundle.json", .rollback, v)
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
