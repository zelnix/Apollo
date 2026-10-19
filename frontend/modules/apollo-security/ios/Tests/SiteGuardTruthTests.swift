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
  // --- Failure modes (Hardening Gate step 3/5) ---------------------------------------------------------------
  func testExtensionEnabledButProtectionOffIsStillOffDuty() {
    // Safari may keep the extension enabled after the person turns Apollo off: intent wins, nothing is claimed.
    let d = SiteGuardTruth.derive(requested: false, blockerEnabled: true, rulesWritten: false)
    XCTAssertFalse(d.operational); XCTAssertNil(d.degradedReason)
  }
  func testEveryDegradedStateHasAPlainLanguageReason() {
    for (enabled, rules) in [(Bool?.none, true), (false, true), (true, false), (false, false), (Bool?.none, false)] {
      let d = SiteGuardTruth.derive(requested: true, blockerEnabled: enabled, rulesWritten: rules)
      XCTAssertFalse(d.operational)
      XCTAssertEqual(d.enforcementMethod, "none")
      XCTAssertFalse((d.degradedReason ?? "").isEmpty, "requested-but-not-operational must always explain why")
    }
  }
  func testDerivationIsPureAndRepeatable() {
    // Operational is derived from fresh observations every time — never from a stored value.
    let a = SiteGuardTruth.derive(requested: true, blockerEnabled: true, rulesWritten: true)
    let b = SiteGuardTruth.derive(requested: true, blockerEnabled: false, rulesWritten: true)
    XCTAssertTrue(a.operational); XCTAssertFalse(b.operational)
    XCTAssertEqual(a, SiteGuardTruth.derive(requested: true, blockerEnabled: true, rulesWritten: true))
  }
  func testRulesAreValidContentBlockerJSON() {
    let rules = SiteGuardTruth.rules(for: ["evil.example"])
    let data = try! JSONSerialization.data(withJSONObject: rules)
    let back = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    XCTAssertEqual(back.count, 1)
    XCTAssertEqual((back[0]["trigger"] as! [String: Any])["url-filter"] as! String, ".*")
  }
  func testHostsAreDeduplicatedCaseInsensitively() {
    let rules = SiteGuardTruth.rules(for: ["Evil.example", "evil.EXAMPLE", "evil.example"])
    let domains = (rules[0]["trigger"] as! [String: Any])["if-domain"] as! [String]
    XCTAssertEqual(Set(domains).count, domains.count)
    XCTAssertEqual(Set(domains), ["*evil.example"])
  }
}
