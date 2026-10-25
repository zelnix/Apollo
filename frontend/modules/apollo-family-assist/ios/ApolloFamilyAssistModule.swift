import ExpoModulesCore
import ReplayKit
import UIKit

private let familyGroup = "group.app.apollo.hwg.apollo"
private let broadcastExtension = "app.apollo.hwg.familyassistbroadcast"
private let handoffFileName = "family-assist-handoff.json"
private let commandKey = "family-assist-command"
private let extensionStateKey = "family-assist-extension-state"
private let commandNotification = "app.apollo.familyassist.command"
private let stateNotification = "app.apollo.familyassist.state"

/// Process-wide Family Help state, shared by the module and the viewer peer (Android: FamilyAssistRuntime).
///
/// All state lives in one FamilyAssistStateStore; every change names its session and generation, and an event is sent
/// only when the change was accepted. The sharer's capture runs in the Broadcast extension, a separate process: it
/// publishes each state change to the App Group and posts a Darwin notification, and the app takes it in through the
/// same fenced store, so a late update from an ended session can never overwrite the session that replaced it.
final class FamilyAssistRuntime {
  static let shared = FamilyAssistRuntime()
  let store = FamilyAssistStateStore()
  private let lock = NSLock()
  private var event: ((String, FamilyAssistState) -> Void)?
  private var viewer: FamilyAssistViewerPeer?
  private var lastExtensionRevision: Double = 0

  private init() {
    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
      guard let observer else { return }
      Unmanaged<FamilyAssistRuntime>.fromOpaque(observer).takeUnretainedValue().takeExtensionState()
    }, stateNotification as CFString, nil, .deliverImmediately)
  }

  func setEvent(_ sink: ((String, FamilyAssistState) -> Void)?) {
    lock.lock(); event = sink; lock.unlock()
  }

  /// The current state, after taking in anything the Broadcast extension published.
  func snapshot() -> FamilyAssistState {
    takeExtensionState()
    return store.snapshot()
  }

  /// Nothing is being captured or watched. Unlike Android, a session still in "requesting_consent" may be replaced:
  /// iOS never reports that the person closed the broadcast picker, and nothing is shared in that state.
  func canTakeOver() -> Bool {
    FamilyAssistState.idleStates.union(["requesting_consent"]).contains(snapshot().captureState)
  }

  func begin(_ sessionId: String, _ generation: String, captureState: String, event name: String, captureScope: String? = nil) {
    emit(name, store.begin(sessionId: sessionId, generation: generation, captureState: captureState, captureScope: captureScope))
  }

  func update(_ sessionId: String?, _ generation: String?, captureState: String, event name: String,
              failure: String? = nil, reason: String? = nil, helperConnected: Bool? = nil, markStarted: Bool = false) {
    if store.transition(sessionId: sessionId, generation: generation, captureState: captureState, failure: failure, reason: reason,
                        helperConnected: helperConnected, markStarted: markStarted) {
      emit(name, store.snapshot())
    }
  }

  /// Takes in the extension's latest published state once (each publication carries a rising revision).
  func takeExtensionState() {
    guard let body = UserDefaults(suiteName: familyGroup)?.dictionary(forKey: extensionStateKey),
          let revision = body["revision"] as? Double, let captureState = body["captureState"] as? String,
          let name = body["type"] as? String else { return }
    lock.lock()
    let fresh = revision > lastExtensionRevision
    if fresh { lastExtensionRevision = revision }
    lock.unlock()
    guard fresh else { return }
    update(body["sessionId"] as? String, body["generation"] as? String, captureState: captureState, event: name,
           failure: body["failureCode"] as? String, reason: body["endReason"] as? String,
           helperConnected: body["helperConnected"] as? Bool, markStarted: body["markStarted"] as? Bool ?? false)
  }

  // MARK: Viewer (the helper watching on this iPhone or iPad)

  func startViewer(_ input: FamilyAssistViewerInput) {
    closeViewer()
    FamilyAssistRenderer.shared.reset()
    begin(input.sessionId, input.generation, captureState: "starting", event: "capture_starting")
    let created = FamilyAssistViewerPeer(input) { [weak self] peer, reason in self?.viewerEnded(peer, reason) }
    lock.lock(); viewer = created; lock.unlock()
    created.connect()
  }

  /// The viewer peer ended by itself (helper stopped, signaling or transport failed). Only the current viewer counts.
  private func viewerEnded(_ peer: FamilyAssistViewerPeer, _ reason: String) {
    lock.lock()
    guard viewer === peer else { lock.unlock(); return }
    viewer = nil
    lock.unlock()
    peer.close()
    if FamilyAssistWire.failureReasons.contains(reason) {
      update(peer.sessionId, peer.generation, captureState: "failed", event: "capture_failed", failure: reason)
    } else {
      update(peer.sessionId, peer.generation, captureState: "stopped", event: "capture_stopped", reason: reason)
    }
  }

  func closeViewer() {
    lock.lock(); let current = viewer; viewer = nil; lock.unlock()
    current?.close()
  }

  private func emit(_ name: String, _ state: FamilyAssistState) {
    lock.lock(); let sink = event; lock.unlock()
    sink?(name, state)
  }
}

public final class ApolloFamilyAssistModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApolloFamilyAssist")
    Events("onFamilyAssistEvent")
    OnCreate {
      FamilyAssistRuntime.shared.setEvent { [weak self] type, state in
        var body: [String: Any?] = state.toDictionary().mapValues { $0 }
        body["type"] = type
        body["observedAt"] = FamilyAssistDates.now()
        self?.sendEvent("onFamilyAssistEvent", body)
      }
    }
    OnDestroy {
      FamilyAssistRuntime.shared.setEvent(nil)
      FamilyAssistRuntime.shared.closeViewer()
    }

    AsyncFunction("getCapabilities") { () -> [String: Any] in
      [
        "platform": "ios", "screenShare": "permission_required", "supportedScopes": ["full_display"], "helperViewing": "available",
        "liveMicrophone": "unavailable", "systemAudio": "not_supported", "remoteControl": "not_supported", "unavailableReason": NSNull(),
        "observedAt": FamilyAssistDates.now(),
      ]
    }
    AsyncFunction("getState") { () -> [String: Any] in FamilyAssistRuntime.shared.snapshot().toDictionary() }

    // Main queue: the system broadcast picker is a view.
    AsyncFunction("startCapture") { (input: [String: Any]) in
      guard input["microphoneEnabled"] as? Bool == false else { throw FamilyAssistError.microphoneUnavailable }
      guard FamilyAssistRuntime.shared.canTakeOver() else { throw FamilyAssistError.captureAlreadyOwned }
      guard let handoff = FamilyAssistHandoff(input), handoff.expiresAt > Date() else { throw FamilyAssistError.invalidInput }
      try self.prepareHandoff(handoff)
      FamilyAssistRuntime.shared.begin(handoff.sessionId, handoff.generation, captureState: "requesting_consent", event: "consent_shown", captureScope: handoff.captureScope)
      self.openBroadcastPicker(handoff)
    }.runOnQueue(.main)
    // Pause and resume are applied by the extension, which then publishes the new state and tells the helper.
    AsyncFunction("pauseCapture") { (sessionId: String, generation: String) in
      try self.requireCurrent(sessionId, generation)
      self.sendCommand("pause", sessionId, generation)
    }
    AsyncFunction("resumeCapture") { (sessionId: String, generation: String) in
      try self.requireCurrent(sessionId, generation)
      self.sendCommand("resume", sessionId, generation)
    }
    AsyncFunction("stopCapture") { (sessionId: String, generation: String) in
      try self.requireCurrent(sessionId, generation)
      self.sendCommand("stop", sessionId, generation)
      // A broadcast started later for this session finds nothing to share.
      self.removeHandoff()
      FamilyAssistRuntime.shared.update(sessionId, generation, captureState: "stopped", event: "capture_stopped", reason: "owner_stopped")
    }
    AsyncFunction("startViewer") { (input: [String: Any]) in
      guard let values = FamilyAssistViewerInput(input) else { throw FamilyAssistError.invalidInput }
      FamilyAssistRuntime.shared.startViewer(values)
    }
    AsyncFunction("stopViewer") { (sessionId: String, generation: String) in
      try self.requireCurrent(sessionId, generation)
      FamilyAssistRuntime.shared.closeViewer()
      FamilyAssistRuntime.shared.update(sessionId, generation, captureState: "stopped", event: "capture_stopped", reason: "helper_left")
    }
    View(FamilyAssistViewerView.self) {}
  }

  private func requireCurrent(_ sessionId: String, _ generation: String) throws {
    guard FamilyAssistRuntime.shared.snapshot().owns(sessionId, generation) else { throw FamilyAssistError.staleGeneration }
  }

  /// One-time handoff for the extension, written to protected App Group storage. Clears any state or command left by
  /// an earlier session first.
  private func prepareHandoff(_ handoff: FamilyAssistHandoff) throws {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: familyGroup) else { throw FamilyAssistError.appGroupUnavailable }
    let defaults = UserDefaults(suiteName: familyGroup)
    defaults?.removeObject(forKey: extensionStateKey)
    defaults?.removeObject(forKey: commandKey)
    let data = try JSONEncoder().encode(handoff)
    let pending = root.appendingPathComponent("family-assist-handoff.pending")
    let complete = root.appendingPathComponent(handoffFileName)
    try data.write(to: pending, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    try? FileManager.default.removeItem(at: complete)
    try FileManager.default.moveItem(at: pending, to: complete)
  }

  private func removeHandoff() {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: familyGroup) else { return }
    try? FileManager.default.removeItem(at: root.appendingPathComponent(handoffFileName))
  }

  private func sendCommand(_ command: String, _ sessionId: String, _ generation: String) {
    UserDefaults(suiteName: familyGroup)?.set(["command": command, "sessionId": sessionId, "generation": generation, "issuedAt": Date().timeIntervalSince1970], forKey: commandKey)
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(commandNotification as CFString), nil, nil, true)
  }

  /// Main thread. Opens the system "Start Broadcast" sheet with only ApolloSG's extension (and no microphone option).
  private func openBroadcastPicker(_ handoff: FamilyAssistHandoff) {
    guard let view = appContext?.utilities?.currentViewController()?.view else {
      FamilyAssistRuntime.shared.update(handoff.sessionId, handoff.generation, captureState: "failed", event: "capture_failed", failure: "visible_activity_required")
      return
    }
    let picker = RPSystemBroadcastPickerView(frame: CGRect(x: -100, y: -100, width: 44, height: 44))
    picker.preferredExtension = broadcastExtension
    picker.showsMicrophoneButton = false
    view.addSubview(picker)
    guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
      picker.removeFromSuperview()
      FamilyAssistRuntime.shared.update(handoff.sessionId, handoff.generation, captureState: "failed", event: "capture_failed", failure: "broadcast_picker_unavailable")
      return
    }
    button.sendActions(for: .touchUpInside)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { picker.removeFromSuperview() }
  }
}

private func requiredText(_ input: [String: Any], _ key: String) -> String? {
  guard let value = input[key] as? String, !value.isEmpty else { return nil }
  return value
}

/// What the Broadcast extension needs to connect, handed over once through the App Group (same fields as its Handoff).
private struct FamilyAssistHandoff: Codable {
  let sessionId: String
  let generation: String
  let captureScope: String
  let ephemeralSignalingTicket: String
  let signalingBaseUrl: String
  let helperDisplayName: String
  let expiresAt: Date

  init?(_ input: [String: Any]) {
    guard let sessionId = requiredText(input, "sessionId"), let generation = requiredText(input, "generation"),
          let captureScope = requiredText(input, "captureScope"), let ticket = requiredText(input, "ephemeralSignalingTicket"),
          let base = requiredText(input, "signalingBaseUrl"), let helper = requiredText(input, "helperDisplayName"),
          let expiry = requiredText(input, "expiresAt"), let expiresAt = FamilyAssistDates.parse(expiry) else { return nil }
    self.sessionId = sessionId
    self.generation = generation
    self.captureScope = captureScope
    ephemeralSignalingTicket = ticket
    signalingBaseUrl = base
    helperDisplayName = helper
    self.expiresAt = expiresAt
  }
}

struct FamilyAssistViewerInput {
  let sessionId: String
  let generation: String
  let ephemeralSignalingTicket: String
  let signalingBaseUrl: String

  init?(_ input: [String: Any]) {
    guard let sessionId = requiredText(input, "sessionId"), let generation = requiredText(input, "generation"),
          let ticket = requiredText(input, "ephemeralSignalingTicket"), let base = requiredText(input, "signalingBaseUrl") else { return nil }
    self.sessionId = sessionId
    self.generation = generation
    ephemeralSignalingTicket = ticket
    signalingBaseUrl = base
  }
}

/// Same error codes as Android's module.
private enum FamilyAssistError: LocalizedError {
  case staleGeneration, microphoneUnavailable, invalidInput, appGroupUnavailable, captureAlreadyOwned

  var errorDescription: String? {
    switch self {
    case .staleGeneration: return "stale_generation"
    case .microphoneUnavailable: return "microphone_not_supported"
    case .invalidInput: return "invalid_input"
    case .appGroupUnavailable: return "app_group_unavailable"
    case .captureAlreadyOwned: return "capture_already_owned"
    }
  }
}
