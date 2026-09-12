import CallKit
import Foundation

/// ApolloCallDirectory — Call Guard's CXCallDirectoryExtension.
///
/// Reads a plain JSON file ({"block": [...], "allow": [...], "autoRisky": [...]} of E.164 phone
/// number strings) written by the main app into the shared App Group container (see
/// ApolloSecurityModule.swift's loadCallLists/saveCallLists). `allow` numbers are always excluded
/// from the blocking set, even if they also appear in `block`/`autoRisky`.
///
/// This ALWAYS does a full (non-incremental) reload rather than an incremental update — Apple
/// requires blocking entries to be added in strictly ascending CXCallDirectoryPhoneNumber (Int64)
/// order within a single request, and a full reload is the simplest way to guarantee that every
/// time, given the underlying list is small (personal block list + this device's own past risk
/// lookups) rather than a huge synced database.
///
/// No caller-ID label source is populated in this build, so no identification entries are added —
/// see ApolloSecurityModule.getCallProtectionCapabilities()'s `callerIdentification` field, which is
/// intentionally reported the same way as `callScreening` (both depend on the SAME extension being
/// enabled) rather than claiming a labelling capability that doesn't exist yet.
class CallDirectoryHandler: CXCallDirectoryProvider {
  override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    context.delegate = self

    let lists = Self.loadLists()
    let allow = Set(lists["allow"] ?? [])
    let blocked = Set(lists["block"] ?? []).union(Set(lists["autoRisky"] ?? [])).subtracting(allow)
    let numbers = blocked.compactMap { Self.toPhoneNumber($0) }.sorted()
    for number in numbers {
      context.addBlockingEntry(withNextSequentialPhoneNumber: number)
    }

    context.completeRequest()
  }

  private static func loadLists() -> [String: [String]] {
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    // Extension bundle id is "<app>.calldirectory" → app group is "group.<app>.apollo"
    let appBundleId = bundleId.replacingOccurrences(of: ".calldirectory", with: "")
    let group = "group.\(appBundleId).apollo"
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
          let data = try? Data(contentsOf: container.appendingPathComponent("callDirectory.json")),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [String]] else {
      return [:]
    }
    return obj
  }

  /// CXCallDirectoryPhoneNumber is digits-only Int64 (no leading '+'). Non-numeric / empty input is skipped.
  private static func toPhoneNumber(_ e164: String) -> CXCallDirectoryPhoneNumber? {
    let digits = e164.filter { $0.isNumber }
    guard !digits.isEmpty, let value = CXCallDirectoryPhoneNumber(digits) else { return nil }
    return value
  }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
  func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
    // Nothing to recover here — the main app triggers a fresh reload after every list change
    // (see ApolloSecurityModule.reloadCallDirectory), so the next attempt uses the latest file.
  }
}
