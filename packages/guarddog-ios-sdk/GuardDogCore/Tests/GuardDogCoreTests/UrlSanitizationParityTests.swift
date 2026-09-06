import XCTest
@testable import GuardDogCore

/// Shared vectors: security/test-vectors/normalization/url_vectors.json
final class UrlSanitizationParityTests: XCTestCase {
    func testUrlVectors() throws {
        let root = try JSONSerialization.jsonObject(with: TestVectors.load("normalization/url_vectors.json")) as! [String: Any]
        for v in root["vectors"] as! [[String: Any]] {
            let input = v["input"] as! String
            let r = UrlSanitizer.sanitize(input)
            XCTAssertEqual(r != nil, v["analyzable"] as! Bool, input)
            XCTAssertEqual(r?.sanitizedUrl, v["sanitizedUrl"] as? String, input)
            XCTAssertEqual(r?.host, v["host"] as? String, input)
        }
    }

    func testOriginalStaysAnalyzableWhileSharedFormDropsSecrets() {
        let r = UrlSanitizer.sanitize("https://user:pw@example.com/login?token=SECRET#frag")!
        XCTAssertEqual(r.sanitizedUrl, "https://example.com/login")
        XCTAssertTrue(r.original.contains("SECRET") && r.hadQuery && r.hadFragment && r.hadUserinfo)
    }
}
