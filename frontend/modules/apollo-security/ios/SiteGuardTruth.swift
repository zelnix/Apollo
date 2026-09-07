import Foundation

/// Pure, testable pieces of iOS Site Guard: the truth-of-state derivation and the Safari rule list.
/// No ExpoModulesCore or SafariServices here so XCTest can exercise them without a host app.
public enum SiteGuardTruth {
  public struct Derived: Equatable {
    public let operational: Bool
    public let enforcementMethod: String
    public let degradedReason: String?
  }

  /// operational ⇔ requested AND the extension is observed enabled AND the rule file exists.
  public static func derive(requested: Bool, blockerEnabled: Bool?, rulesWritten: Bool) -> Derived {
    let operational = requested && blockerEnabled == true && rulesWritten
    var degraded: String? = nil
    if requested && !operational {
      if blockerEnabled == nil { degraded = "Safari hasn't reported whether Apollo's extension is enabled yet. Pull to refresh in a moment." }
      else if blockerEnabled == false { degraded = "Apollo's Safari extension is not enabled. Turn it on under Settings › Safari › Extensions." }
      else { degraded = "Apollo could not write its Safari rule list (App Group unavailable in this build)." }
    }
    return Derived(operational: operational, enforcementMethod: operational ? "content_blocker" : "none", degradedReason: degraded)
  }

  /// Safari content-blocker rules: one "block" rule covering every verified host and its subdomains.
  /// Safari rejects an empty list, so an unreachable placeholder domain is used when nothing is blocked.
  public static func rules(for hosts: Set<String>) -> [[String: Any]] {
    hosts.isEmpty
      ? [["trigger": ["url-filter": "^https?://apollo\\.invalid/"], "action": ["type": "block"]]]
      : [["trigger": ["url-filter": ".*", "if-domain": hosts.map { $0.lowercased() }.sorted().map { "*\($0)" }], "action": ["type": "block"]]]
  }
}
