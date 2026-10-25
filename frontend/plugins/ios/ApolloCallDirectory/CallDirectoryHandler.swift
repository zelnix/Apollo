import CallKit
import Foundation

/// ApolloCallDirectory — Call Guard's CXCallDirectoryExtension.
///
/// Reads a plain JSON file ({"block": [...], "allow": [...], "autoRisky": [...]} of E.164 phone
/// number strings) written by the main app into the shared App Group container (see
/// ApolloSecurityModule.swift's loadCallLists/saveCallLists). `allow` numbers are always excluded,
/// even if they also appear in `block`/`autoRisky`.
///
/// - `block` (the person's own block list): iPhone blocks these calls.
/// - `autoRisky` (numbers this phone looked up earlier and found high-risk): a risk score is a
///   likelihood, never proof, so these still ring — with the label "Suspected scam" on the
///   incoming-call screen. A number on the block list is blocked, not labelled.
///
/// This ALWAYS does a full (non-incremental) reload rather than an incremental update — Apple
/// requires blocking and identification entries to be added in strictly ascending
/// CXCallDirectoryPhoneNumber (Int64) order within a single request, and a full reload is the
/// simplest way to guarantee that every time, given the underlying lists are small (personal block
/// list + this device's own past risk lookups) rather than a huge synced database.
class CallDirectoryHandler: CXCallDirectoryProvider {
  static let suspectedLabel = "Suspected scam"

  override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    context.delegate = self

    let lists = Self.loadLists()
    let allow = Set(lists["allow"] ?? [])
    let blocked = Set(lists["block"] ?? []).subtracting(allow)
    let suspected = Set(lists["autoRisky"] ?? []).subtracting(allow).subtracting(blocked)
    for number in Array(Set(blocked.compactMap { Self.toPhoneNumber($0) })).sorted() {
      context.addBlockingEntry(withNextSequentialPhoneNumber: number)
    }
    for number in Array(Set(suspected.compactMap { Self.toPhoneNumber($0) })).sorted() {
      context.addIdentificationEntry(withNextSequentialPhoneNumber: number, label: Self.suspectedLabel)
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

  /// Input must already be canonical E.164. Invalid/ambiguous values are rejected rather than guessed.
  private static func toPhoneNumber(_ e164: String) -> CXCallDirectoryPhoneNumber? {
    guard e164.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil else { return nil }
    let digits = String(e164.dropFirst())
    guard let value = CXCallDirectoryPhoneNumber(digits) else { return nil }
    return value
  }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
  func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
    // Nothing to recover here — the main app triggers a fresh reload after every list change
    // (see ApolloSecurityModule.reloadCallDirectory), so the next attempt uses the latest file.
  }
}
