import XCTest
@testable import ApolloSecurity

/// Phase A — iPhone device facts: VPN on/off from tunnel interfaces; management only ever "present" or "unknown".
final class DeviceSignalsTruthTests: XCTestCase {
  func testTunnelInterfacesMeanVpnOn() {
    XCTAssertTrue(DeviceSignalsTruth.vpnActive(interfaceNames: ["en0", "utun4"], scopedProxyKeys: []))
    XCTAssertTrue(DeviceSignalsTruth.vpnActive(interfaceNames: ["pdp_ip0"], scopedProxyKeys: ["ipsec0"]))
    XCTAssertTrue(DeviceSignalsTruth.vpnActive(interfaceNames: ["UTUN1"], scopedProxyKeys: []))
  }
  func testPlainWifiOrCellularIsNotVpn() {
    XCTAssertFalse(DeviceSignalsTruth.vpnActive(interfaceNames: ["en0", "pdp_ip0", "awdl0", "lo0"], scopedProxyKeys: ["en0"]))
    XCTAssertFalse(DeviceSignalsTruth.vpnActive(interfaceNames: [], scopedProxyKeys: []))
  }
  func testManagementIsNeverClaimedAbsent() {
    XCTAssertEqual(DeviceSignalsTruth.managementProfile(managedConfigPresent: true), "present")
    XCTAssertEqual(DeviceSignalsTruth.managementProfile(managedConfigPresent: false), "unknown")  // iOS cannot enumerate profiles
  }
  func testSignalsKeepIosBlindSpotsNullAndNeverNameTheVpnProvider() {
    let s = DeviceSignalsTruth.signals(vpnActive: true, managedConfigPresent: false)
    XCTAssertEqual(s["platform"] as? String, "ios")
    XCTAssertEqual(s["vpnActive"] as? Bool, true)
    XCTAssertTrue(s["vpnProviderKnown"] is NSNull)
    for key in ["unknownSourcesEnabled", "thirdPartyAccessibilityServices", "overlayApps", "notificationAccessApps", "userTrustedCertificates", "remoteAccessApps", "developerOptions"] {
      XCTAssertTrue(s[key] is NSNull, "\(key) must be null on iOS")
    }
    XCTAssertTrue(DeviceSignalsTruth.signals(vpnActive: nil, managedConfigPresent: false)["vpnActive"] is NSNull)  // offline → unknown, not "off"
  }
  func testCapabilitiesAreHonest() {
    let c = DeviceSignalsTruth.capabilities()
    XCTAssertEqual(c["vpnState"], "supported"); XCTAssertEqual(c["profileState"], "supported")
    XCTAssertEqual(c["appPermissions"], "unsupported"); XCTAssertEqual(c["accessibilityServices"], "unsupported")
  }
}
