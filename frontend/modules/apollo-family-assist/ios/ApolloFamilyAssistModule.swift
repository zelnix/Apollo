import ExpoModulesCore
import ReplayKit
import UIKit
import WebRTC

private let familyGroup = "group.app.apollo.hwg.apollo"
private let broadcastExtension = "app.apollo.hwg.familyassistbroadcast"

final class FamilyAssistCoordinator {
  static let shared = FamilyAssistCoordinator()
  private let lock = NSLock()
  var eventSink: ((String) -> Void)?
  var viewer: FamilyAssistViewerPeer?
  private(set) var state: [String: Any] = ["sessionId": NSNull(), "generation": NSNull(), "captureState": "idle", "helperConnected": false,
    "captureScope": NSNull(), "microphoneEnabled": false, "startedAt": NSNull(), "lastTransitionAt": ISO8601DateFormatter().string(from: Date()), "failureCode": NSNull(), "endReason": NSNull()]
  func transition(_ value: String, event: String? = nil, failure: String? = nil, reason: String? = nil) {
    lock.lock(); state["captureState"] = value; state["lastTransitionAt"] = ISO8601DateFormatter().string(from: Date()); state["failureCode"] = failure == nil ? NSNull() : failure!; state["endReason"] = reason == nil ? NSNull() : reason!; lock.unlock()
    if let event { eventSink?(event) }
  }
  func setSession(_ input: [String: Any]) {
    lock.lock(); state["sessionId"] = input["sessionId"]; state["generation"] = input["generation"]; state["captureScope"] = input["captureScope"]; lock.unlock()
  }
  func snapshot() -> [String: Any] {
    lock.lock(); var current = state; lock.unlock()
    if let extensionState = UserDefaults(suiteName: familyGroup)?.dictionary(forKey: "family-assist-extension-state"),
       extensionState["sessionId"] as? String == current["sessionId"] as? String,
       extensionState["generation"] as? String == current["generation"] as? String {
      for (key, value) in extensionState { current[key] = value }
    }
    return current
  }
  func requireCurrent(_ session: String, _ generation: String) throws {
    let current = snapshot(); guard current["sessionId"] as? String == session, current["generation"] as? String == generation else { throw FamilyAssistError.staleGeneration }
  }
}

public final class ApolloFamilyAssistModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApolloFamilyAssist")
    Events("onFamilyAssistEvent")
    OnCreate { FamilyAssistCoordinator.shared.eventSink = { [weak self] type in var body = FamilyAssistCoordinator.shared.snapshot(); body["type"] = type; body["observedAt"] = ISO8601DateFormatter().string(from: Date()); self?.sendEvent("onFamilyAssistEvent", body) } }
    OnDestroy { FamilyAssistCoordinator.shared.eventSink = nil; FamilyAssistCoordinator.shared.viewer?.close(); FamilyAssistCoordinator.shared.viewer = nil }
    AsyncFunction("getCapabilities") { () -> [String: Any] in [
      "platform": "ios", "screenShare": "permission_required", "supportedScopes": ["full_display"], "helperViewing": "available",
      "liveMicrophone": "unavailable", "systemAudio": "not_supported", "remoteControl": "not_supported", "unavailableReason": NSNull(),
      "observedAt": ISO8601DateFormatter().string(from: Date())]
    }
    AsyncFunction("getState") { () -> [String: Any] in FamilyAssistCoordinator.shared.snapshot() }
    AsyncFunction("startCapture") { (input: [String: Any]) in
      guard input["microphoneEnabled"] as? Bool == false else { throw FamilyAssistError.microphoneUnavailable }
      guard let handoff = FamilyAssistHandoff(input), handoff.expiresAt > Date() else { throw FamilyAssistError.invalidInput }
      UserDefaults(suiteName: familyGroup)?.removeObject(forKey: "family-assist-extension-state")
      try self.writeHandoff(handoff); FamilyAssistCoordinator.shared.setSession(input); FamilyAssistCoordinator.shared.transition("requesting_consent", event: "consent_shown")
      await MainActor.run { self.openBroadcastPicker() }
    }
    AsyncFunction("pauseCapture") { (session: String, generation: String) in try FamilyAssistCoordinator.shared.requireCurrent(session, generation); self.writeCommand("pause", session, generation); FamilyAssistCoordinator.shared.transition("paused", event: "capture_paused") }
    AsyncFunction("resumeCapture") { (session: String, generation: String) in try FamilyAssistCoordinator.shared.requireCurrent(session, generation); self.writeCommand("resume", session, generation); FamilyAssistCoordinator.shared.transition("active", event: "capture_started") }
    AsyncFunction("stopCapture") { (session: String, generation: String) in try FamilyAssistCoordinator.shared.requireCurrent(session, generation); self.writeCommand("stop", session, generation); FamilyAssistCoordinator.shared.transition("stopped", event: "capture_stopped", reason: "owner_stopped") }
    AsyncFunction("startViewer") { (input: [String: Any]) in
      guard let handoff = FamilyAssistViewerInput(input) else { throw FamilyAssistError.invalidInput }
      FamilyAssistCoordinator.shared.viewer?.close(); FamilyAssistCoordinator.shared.setSession(input)
      FamilyAssistCoordinator.shared.viewer = FamilyAssistViewerPeer(handoff).also { $0.connect() }
      FamilyAssistCoordinator.shared.transition("starting")
    }
    AsyncFunction("stopViewer") { (session: String, generation: String) in try FamilyAssistCoordinator.shared.requireCurrent(session, generation); FamilyAssistCoordinator.shared.viewer?.close(); FamilyAssistCoordinator.shared.viewer = nil; FamilyAssistCoordinator.shared.transition("stopped", event: "capture_stopped") }
    View(FamilyAssistViewerView.self) {}
  }

  private func writeHandoff(_ handoff: FamilyAssistHandoff) throws {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: familyGroup) else { throw FamilyAssistError.appGroupUnavailable }
    let data = try JSONEncoder().encode(handoff); let pending = root.appendingPathComponent("family-assist-handoff.pending"); let complete = root.appendingPathComponent("family-assist-handoff.json")
    try data.write(to: pending, options: [.atomic]); try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: pending.path)
    try? FileManager.default.removeItem(at: complete); try FileManager.default.moveItem(at: pending, to: complete)
  }
  private func writeCommand(_ command: String, _ session: String, _ generation: String) {
    UserDefaults(suiteName: familyGroup)?.set(["command": command, "sessionId": session, "generation": generation, "issuedAt": Date().timeIntervalSince1970], forKey: "family-assist-command")
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName("app.apollo.familyassist.command" as CFString), nil, nil, true)
  }
  @MainActor private func openBroadcastPicker() {
    guard let controller = appContext?.utilities?.currentViewController() else { FamilyAssistCoordinator.shared.transition("failed", event: "capture_failed", failure: "visible_activity_required"); return }
    let picker = RPSystemBroadcastPickerView(frame: CGRect(x: -100, y: -100, width: 44, height: 44)); picker.preferredExtension = broadcastExtension; picker.showsMicrophoneButton = false
    controller.view.addSubview(picker)
    guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else { picker.removeFromSuperview(); FamilyAssistCoordinator.shared.transition("failed", event: "capture_failed", failure: "broadcast_picker_unavailable"); return }
    button.sendActions(for: .touchUpInside); DispatchQueue.main.asyncAfter(deadline: .now() + 1) { picker.removeFromSuperview() }
  }
}

private struct FamilyAssistHandoff: Codable {
  let sessionId: String; let generation: String; let captureScope: String; let ephemeralSignalingTicket: String; let signalingBaseUrl: String; let helperDisplayName: String; let expiresAt: Date
  init?(_ input: [String: Any]) {
    guard let sessionId = input["sessionId"] as? String, let generation = input["generation"] as? String, let scope = input["captureScope"] as? String,
      let ticket = input["ephemeralSignalingTicket"] as? String, let base = input["signalingBaseUrl"] as? String, let helper = input["helperDisplayName"] as? String,
      let expiry = input["expiresAt"] as? String, let expiresAt = ISO8601DateFormatter().date(from: expiry), !ticket.isEmpty else { return nil }
    self.sessionId = sessionId; self.generation = generation; captureScope = scope; ephemeralSignalingTicket = ticket; signalingBaseUrl = base; helperDisplayName = helper; self.expiresAt = expiresAt
  }
}

struct FamilyAssistViewerInput {
  let sessionId: String; let generation: String; let ephemeralSignalingTicket: String; let signalingBaseUrl: String
  init?(_ input: [String: Any]) {
    guard let session = input["sessionId"] as? String, let generation = input["generation"] as? String, let ticket = input["ephemeralSignalingTicket"] as? String, let base = input["signalingBaseUrl"] as? String else { return nil }
    sessionId = session; self.generation = generation; ephemeralSignalingTicket = ticket; signalingBaseUrl = base
  }
}

private enum FamilyAssistError: Error { case staleGeneration, microphoneUnavailable, invalidInput, appGroupUnavailable }
private extension AnyObject { func also(_ block: (Self) -> Void) -> Self { block(self); return self } }