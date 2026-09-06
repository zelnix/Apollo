import XCTest
@testable import GuardDogCore

/// Shared vectors: security/test-vectors/normalization/host_vectors.json (code-review ready / not runtime-verified here)
final class HostNormalizationParityTests: XCTestCase {
    func testHostVectors() throws {
        let data = try TestVectors.load("normalization/host_vectors.json")
        let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        for v in root["vectors"] as! [[String: Any]] {
            let input = v["input"] as! String
            let expected = v["expected"] as? String
            XCTAssertEqual(HostCanonicalizer.canonicalize(input), expected, "\(v["note"] ?? ""): \(input)")
        }
    }

    func testIpv6IsReallyValidated() {
        XCTAssertNil(HostCanonicalizer.canonicalize("not:an:ip:but:has:colons"))
        XCTAssertEqual(HostCanonicalizer.canonicalize("2001:0DB8:0000:0000:0000:0000:0000:0001"), "[2001:db8::1]")
    }
}

enum TestVectors {
    static func load(_ rel: String) throws -> Data {
        // Resolved relative to the repo: packages/guarddog-ios-sdk/GuardDogCore/Tests/GuardDogCoreTests -> security/test-vectors
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let url = here.appendingPathComponent("../../../../../security/test-vectors/\(rel)").standardizedFileURL
        return try Data(contentsOf: url)
    }
}
