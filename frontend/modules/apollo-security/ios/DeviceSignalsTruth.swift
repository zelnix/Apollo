import Foundation

/// Phase A — Apps & Device on iPhone. Pure, XCTest-able derivations for the two facts iOS lets a normal app observe.
/// Everything else in the AppDeviceSdk contract is `null` on iOS (no app list, no permissions of other apps, no
/// accessibility/overlay/notification-access, no user CA store) and the UI lists it under "cannot see".
public enum DeviceSignalsTruth {
  /// Interface-name prefixes that mean "traffic is going through a tunnel". Apple gives no API for "is a VPN on",
  /// nor for who runs it — iCloud Private Relay and some ad blockers also use utun, so Apollo reports the FACT
  /// (a tunnel is up) and never a verdict about the provider (`vpnProviderKnown` stays null).
  public static let tunnelPrefixes = ["utun", "ipsec", "ppp", "tap", "tun"]

  public static func vpnActive(interfaceNames: [String], scopedProxyKeys: [String]) -> Bool {
    let names = interfaceNames + scopedProxyKeys
    return names.contains { n in tunnelPrefixes.contains { n.lowercased().hasPrefix($0) } }
  }

  /// iOS never lets an app enumerate configuration/MDM profiles. The only observable is whether THIS app received a
  /// managed configuration (`com.apple.configuration.managed`) — that proves management is present. Its absence proves
  /// nothing, so the answer is "unknown", never "none".
  public static func managementProfile(managedConfigPresent: Bool) -> String { managedConfigPresent ? "present" : "unknown" }

  public static func capabilities() -> [String: String] {
    ["installEvents": "unsupported", "appPermissions": "unsupported", "accessibilityServices": "unsupported", "overlayApps": "unsupported",
     "notificationAccess": "unsupported", "vpnState": "supported", "profileState": "supported", "appNetworkCorrelation": "unsupported"]
  }

  /// DeviceSignals contract (src/domain/deviceAnalysis.ts) with iOS' honest nulls.
  public static func signals(vpnActive: Bool?, managedConfigPresent: Bool) -> [String: Any] {
    ["platform": "ios", "unknownSourcesEnabled": NSNull(), "thirdPartyAccessibilityServices": NSNull(), "overlayApps": NSNull(),
     "notificationAccessApps": NSNull(), "vpnActive": vpnActive.map { $0 as Any } ?? NSNull(), "vpnProviderKnown": NSNull(),
     "managementProfile": managementProfile(managedConfigPresent: managedConfigPresent), "userTrustedCertificates": NSNull(),
     "remoteAccessApps": NSNull(), "developerOptions": NSNull()]
  }
}
