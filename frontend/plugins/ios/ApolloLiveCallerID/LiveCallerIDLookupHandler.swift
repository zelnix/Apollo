import Foundation
#if canImport(LiveCallerIDLookup)
import LiveCallerIDLookup
#endif
#if canImport(IdentityLookup)
import IdentityLookup
#endif

/// Call Guard — Apple "Live Caller ID Lookup" implementation (iOS 18+).
///
/// This extension is queried by iOS in real time when an incoming call arrives from an unknown number.
/// iOS routes the query through Apple's Private Information Retrieval (PIR) relay so neither Apple
/// nor the network learns which specific number is being looked up.
///
/// Architecture:
///   Incoming call → iOS → Apple PIR relay → Apollo PIR server → encrypted response → iOS → label displayed
///
/// The PIR server (configured via `serviceURL`) must implement Apple's PIR shard protocol.
/// Apollo's FastAPI backend provides the `/api/call/caller-id-db/export` endpoint that feeds
/// the PIR server's data ingestion pipeline.
///
/// Requirements before enabling:
///   1. A running PIR server (Apple's `live-caller-id-lookup-example` reference, configured with
///      data from Apollo's export endpoint)
///   2. The "Live Caller ID Lookup" entitlement (Apple-granted)
///   3. This file added as an extension target in the Xcode project (via Expo config plugin)
///
/// The extension falls back gracefully: if the PIR server is unreachable or the number is not
/// in the database, iOS receives no label and the call proceeds normally with no identification.

#if canImport(LiveCallerIDLookup)
@available(iOS 18.0, *)
final class LiveCallerIDLookupHandler: LiveCallerIDLookupExtension {

  /// The URL of Apollo's PIR server. Configured via the app group's shared UserDefaults
  /// so the main app can update it without rebuilding the extension.
  private var serverURL: URL? {
    let defaults = UserDefaults(suiteName: "group.com.hucentai.apollo")
    guard let urlString = defaults?.string(forKey: "apollo.pir.server_url") else { return nil }
    return URL(string: urlString)
  }

  override func configuration() -> LiveCallerIDLookupExtensionConfiguration {
    // If no server URL is configured, return a configuration that effectively disables the extension.
    // iOS will not make PIR queries without a valid service URL.
    if let url = serverURL {
      return LiveCallerIDLookupExtensionConfiguration(serverURL: url)
    }
    // Fallback: use a placeholder that will gracefully fail (no label returned)
    return LiveCallerIDLookupExtensionConfiguration(
      serverURL: URL(string: "https://pir.apollo.example.com")!
    )
  }
}
#elseif canImport(IdentityLookup)
// Fallback for compilation on iOS < 18 or when LiveCallerIDLookup framework is unavailable.
// This ensures the file compiles in all configurations.
@available(iOS 18.0, *)
final class LiveCallerIDLookupHandler: NSObject {
  // LiveCallerIDLookup framework not available in this build configuration.
  // The extension requires iOS 18+ SDK and the LiveCallerIDLookup entitlement.
}
#endif
