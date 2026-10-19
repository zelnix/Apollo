import XCTest
import GuardDogCore
@testable import GuardDogExpoModule

/// Bridge DTO adapter tests (iOS). Code-review ready / not runtime-verified here.
final class BridgeDTOAdapterTests: XCTestCase {
    func testIosNeverEmitsThreatBlocked() {
        let fake = SecurityEvent(id: "e", type: .threatBlocked, source: .androidVpnEnforcement, occurredAt: "2026-06-15T00:00:00Z",
                                 destinationIp: "203.0.113.10", ruleId: "r", rulesetId: "s", enforcementEvidenceId: "ev")
        XCTAssertNil(ExpoBridgeAdapters.toDTO(fake))
    }

    func testDetectedEventMapsExplicitly() {
        let e = SecurityEvent(id: "e", type: .threatDetected, source: .localAnalysis, occurredAt: "2026-06-15T00:00:00Z",
                              sanitizedUrl: "https://m1-block-test.guarddog.example/", host: "m1-block-test.guarddog.example", ruleId: "r", rulesetId: "s", bundleVersion: 3, verdict: "block")
        let dto = ExpoBridgeAdapters.toDTO(e)!
        XCTAssertEqual(dto.type, "THREAT_DETECTED"); XCTAssertEqual(dto.source, "local-analysis"); XCTAssertEqual(dto.bundleVersion, 3)
    }

    func testUnsanitizedUrlIsRefusedAtBridge() {
        let e = SecurityEvent(id: "e", type: .threatDetected, source: .localAnalysis, occurredAt: "2026-06-15T00:00:00Z", sanitizedUrl: "https://x.example/a?token=1")
        XCTAssertNil(ExpoBridgeAdapters.toDTO(e))
    }

    func testCapabilitiesAreHonest() {
        let dto = ExpoBridgeAdapters.toDTO(.iosM1)
        XCTAssertFalse(dto.selectiveIpBlocking); XCTAssertTrue(dto.analysisAndWarningOnly); XCTAssertFalse(dto.dnsInterception)
    }
}
