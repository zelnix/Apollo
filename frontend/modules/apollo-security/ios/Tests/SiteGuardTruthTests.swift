import XCTest
@testable import ApolloSecurity

/// Truth-of-state: "Apollo is guarding" must never be reported unless Safari actually enforces.
final class SiteGuardTruthTests: XCTestCase {
  func testOffDutyIsNeverOperationalAndNeverDegraded() {
    let d = SiteGuardTruth.derive(requested: false, blockerEnabled: true, rulesWritten: true)
    XCTAssertFalse(d.operational); XCTAssertEqual(d.enforcementMethod, "none"); XCTAssertNil(d.degradedReason)
  }
  func testRequestedWithExtensionEnabledAndRulesIsOperational() {
    let d = SiteGuardTruth.derive(requested: true, blockerEnabled: true, rulesWritten: true)
    XCTAssertTrue(d.operational); XCTAssertEqual(d.enforcementMethod, "content_blocker"); XCTAssertNil(d.degradedReason)
  }
  func testRequestedButExtensionDisabledIsDegradedWithSettingsHint() {
    let d = SiteGuardTruth.derive(requested: true, blockerEnabled: false, rulesWritten: true)
    XCTAssertFalse(d.operational); XCTAssertTrue(d.degradedReason?.contains("Settings › Safari › Extensions") == true)
  }
  func testUnknownExtensionStateIsNotAssumedOn() {
    let d = SiteGuardTruth.derive(requested: true, blockerEnabled: nil, rulesWritten: true)
    XCTAssertFalse(d.operational); XCTAssertTrue(d.degradedReason?.contains("hasn't reported") == true)
  }
  func testMissingRuleFileIsDegraded() {
    let d = SiteGuardTruth.derive(requested: true, blockerEnabled: true, rulesWritten: false)
    XCTAssertFalse(d.operational); XCTAssertTrue(d.degradedReason?.contains("rule list") == true)
  }
  func testRulesCoverHostsAndSubdomainsSortedLowercase() {
    let rules = SiteGuardTruth.rules(for: ["Evil.example", "phish.test"])
    let trigger = rules[0]["trigger"] as! [String: Any]
    XCTAssertEqual(trigger["if-domain"] as! [String], ["*evil.example", "*phish.test"])
    XCTAssertEqual((rules[0]["action"] as! [String: Any])["type"] as! String, "block")
  }
  func testEmptyHostsProducesHarmlessPlaceholderRule() {
    let rules = SiteGuardTruth.rules(for: [])
    XCTAssertEqual(rules.count, 1)
    XCTAssertEqual((rules[0]["trigger"] as! [String: Any])["url-filter"] as! String, "^https?://apollo\\.invalid/")
  }
}
