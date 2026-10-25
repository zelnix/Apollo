import Foundation

/// Everything JS can read about Family Help on this device, as one immutable snapshot (same shape as Android's
/// FamilyAssistState). Kept free of WebRTC, ReplayKit and Expo types.
struct FamilyAssistState: Equatable {
  var sessionId: String? = nil
  var generation: String? = nil
  var captureState: String = FamilyAssistState.idle
  var helperConnected = false
  var captureScope: String? = nil
  var startedAt: String? = nil
  var lastTransitionAt: String
  var failureCode: String? = nil
  var endReason: String? = nil

  static let idle = "idle"
  /// States from which a new capture or viewer may take over.
  static let idleStates: Set<String> = [idle, "stopped", "failed"]
  static let terminalStates: Set<String> = ["stopped", "failed"]

  func owns(_ sessionId: String?, _ generation: String?) -> Bool {
    guard let sessionId, let generation else { return false }
    return self.sessionId == sessionId && self.generation == generation
  }

  /// The bridge form: missing values cross as null.
  func toDictionary() -> [String: Any] {
    func bridged(_ value: String?) -> Any { if let value { return value }; return NSNull() }
    return [
      "sessionId": bridged(sessionId), "generation": bridged(generation), "captureState": captureState,
      "helperConnected": helperConnected, "captureScope": bridged(captureScope), "microphoneEnabled": false,
      "startedAt": bridged(startedAt), "lastTransitionAt": lastTransitionAt, "failureCode": bridged(failureCode),
      "endReason": bridged(endReason),
    ]
  }
}

/// The single owner of FamilyAssistState. Every change is serialised, and a change that names a session or generation
/// other than the current one is dropped, so a late callback from an ended session can never overwrite the state of the
/// session that replaced it (stale-session fencing, as on Android).
final class FamilyAssistStateStore {
  private let lock = NSLock()
  private let clock: () -> String
  private var current: FamilyAssistState

  init(clock: @escaping () -> String = FamilyAssistDates.now) {
    self.clock = clock
    current = FamilyAssistState(lastTransitionAt: clock())
  }

  func snapshot() -> FamilyAssistState {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  /// Makes sessionId/generation the current session, replacing whatever ended before it.
  @discardableResult
  func begin(sessionId: String, generation: String, captureState: String, captureScope: String? = nil) -> FamilyAssistState {
    lock.lock(); defer { lock.unlock() }
    current = FamilyAssistState(sessionId: sessionId, generation: generation, captureState: captureState, captureScope: captureScope, lastTransitionAt: clock())
    return current
  }

  /// Moves the current session to captureState. Returns false, changing nothing, when the caller's session is not the
  /// current one or the session has already ended (a terminal state only gives way to a new begin).
  func transition(sessionId: String?, generation: String?, captureState: String, failure: String? = nil, reason: String? = nil,
                  helperConnected: Bool? = nil, markStarted: Bool = false) -> Bool {
    lock.lock(); defer { lock.unlock() }
    let now = current
    if !now.owns(sessionId, generation) { return false }
    if FamilyAssistState.terminalStates.contains(now.captureState) { return false }
    let ended = FamilyAssistState.terminalStates.contains(captureState)
    var next = now
    next.captureState = captureState
    next.lastTransitionAt = clock()
    next.failureCode = failure
    next.endReason = reason
    next.helperConnected = ended ? false : (helperConnected ?? now.helperConnected)
    if markStarted { next.startedAt = clock() }
    current = next
    return true
  }
}

enum FamilyAssistDates {
  static func now() -> String { ISO8601DateFormatter().string(from: Date()) }

  /// The server sends Python isoformat times ("2026-06-01T10:00:00.123456+00:00"). ISO8601DateFormatter's default
  /// options reject fractional seconds, so they are dropped before parsing (sub-second precision is not needed here).
  static func parse(_ value: String) -> Date? {
    ISO8601DateFormatter().date(from: value.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
  }
}

enum FamilyAssistWire {
  /// Endings of the helper's viewer that are failures, not a person's choice (same set as Android's FAILURE_REASONS).
  static let failureReasons: Set<String> = ["capture_failed", "transport_failed", "signaling_failed", "signaling_invalid", "signaling_closed", "sdp_failed", "relay_refresh_rejected"]
}
