import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ReplayKit
import WebRTC

private let appGroup = "group.app.apollo.hwg.apollo"
private let handoffFileName = "family-assist-handoff.json"
private let commandKey = "family-assist-command"
private let extensionStateKey = "family-assist-extension-state"
private let commandNotification = "app.apollo.familyassist.command"
private let stateNotification = "app.apollo.familyassist.state"
/// Termination reasons the server accepts from the sharer (backend services/family_assist/sessions.py signaling_transition).
private let wireReasons: Set<String> = ["owner_stopped", "capture_revoked", "transport_failed", "os_terminated", "app_terminated"]

/// Family Help, the sharer's side on iPhone and iPad: the ReplayKit Broadcast Upload extension that sends the screen —
/// video only — to the one helper the person chose. It runs in its own process with its own WebRTC set-up, and talks to
/// the app only through the App Group: a one-time handoff file in, owner commands in (Darwin notification plus a
/// once-a-second check), its state out (written to the App Group, then a Darwin notification the app listens for).
///
/// Threads: socket callbacks, WebRTC callbacks, commands and teardown run on one serial queue (the URLSession delegate
/// queue runs on it too), so messages are numbered and sent in order. ReplayKit's frame callback only goes through the
/// frame gate, under its lock, so ending the session closes the gate before the source is released.
final class SampleHandler: RPBroadcastSampleHandler, RTCPeerConnectionDelegate, URLSessionWebSocketDelegate {
  private let queue = DispatchQueue(label: "app.apollo.familyassist.broadcast")
  private let defaults = UserDefaults(suiteName: appGroup)
  private let frames = FrameGate()
  // Everything below is used on `queue` only.
  private var handoff: Handoff?
  private var factory: RTCPeerConnectionFactory?
  private var peer: RTCPeerConnection?
  private var source: RTCVideoSource?
  private var track: RTCVideoTrack?
  private var session: URLSession?
  private var socket: URLSessionWebSocketTask?
  private var refreshWork: DispatchWorkItem?
  private var commandTimer: DispatchSourceTimer?
  private var pingTimer: DispatchSourceTimer?
  private var observingCommands = false
  private var lastCommandAt: Double = 0
  private var sequence = 0
  private var revision: Double = 0
  private var paused = false
  private var finished = false

  // MARK: ReplayKit

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    queue.async { self.start() }
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    // Video only: every other buffer type (app sound, microphone) is dropped here and never reaches WebRTC.
    guard sampleBufferType == .video else { return }
    frames.push(sampleBuffer)
  }

  override func broadcastPaused() { queue.async { self.setPaused(true) } }
  override func broadcastResumed() { queue.async { self.setPaused(false) } }

  override func broadcastFinished() {
    // The person stopped from the status bar or Control Center, or iOS ended it. Give the helper's message a moment.
    let done = DispatchSemaphore(value: 0)
    queue.async { self.finish(reason: "os_terminated", error: nil) { done.signal() } }
    _ = done.wait(timeout: .now() + 1.5)
  }

  // MARK: Session

  private func start() {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      return refuse("Protected storage is unavailable.")
    }
    let url = root.appendingPathComponent(handoffFileName)
    defer { try? FileManager.default.removeItem(at: url) } // one use only, valid or not
    guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(Handoff.self, from: data), value.expiresAt > Date() else {
      return refuse("This help request expired. Return to ApolloSG and try again.")
    }
    handoff = value
    observeCommands()
    publish("starting", event: "capture_starting", markStarted: true)
    connect(value)
    applyCommand() // a Stop sent before the broadcast started wins
  }

  /// Ends a broadcast that never had a session: there is nothing to publish and no helper to tell.
  private func refuse(_ detail: String) {
    finished = true
    finishBroadcastWithError(broadcastError(detail))
  }

  private func connect(_ value: Handoff) {
    let base = value.signalingBaseUrl.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard var components = URLComponents(string: base + "/family/assist/sessions/\(value.sessionId)/signal") else {
      return failTransport("The secure signaling address is invalid.")
    }
    components.queryItems = [URLQueryItem(name: "ticket", value: value.ephemeralSignalingTicket)]
    guard let url = components.url else { return failTransport("The secure signaling address is invalid.") }
    // This process's one WebRTC set-up: SSL, audio kept off (video only), one factory owned by this session.
    _ = RTCInitializeSSL()
    let audio = RTCAudioSession.sharedInstance()
    audio.useManualAudio = true
    audio.isAudioEnabled = false
    factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
    let delegateQueue = OperationQueue()
    delegateQueue.maxConcurrentOperationCount = 1
    delegateQueue.underlyingQueue = queue
    let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: delegateQueue)
    let task = session.webSocketTask(with: url)
    self.session = session
    socket = task
    task.resume()
    receive()
    pingTimer = repeating(every: 20) { [weak self] in self?.socket?.sendPing { _ in } }
  }

  private func receive() {
    socket?.receive { [weak self] result in
      guard let self, !self.finished else { return }
      switch result {
      case .success(.string(let text)): self.handle(text); self.receive()
      case .success: self.receive()
      case .failure: self.failTransport("The helper connection ended.")
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let type = body["type"] as? String else { return failTransport("The helper connection sent something unexpected.") }
    // A message that names another generation belongs to an older session: ignore it.
    if let generation = body["generation"] as? String, !generation.isEmpty, generation != handoff?.generation { return }
    switch type {
    case "ready", "relay_credentials":
      guard let relay = body["relay"] as? [String: Any] else { return failTransport("The relay configuration was rejected.") }
      if peer == nil { createPeer(relay) } else { applyRelay(relay) }
    case "answer":
      guard let sdp = body["sdp"] as? String else { return }
      peer?.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] error in
        guard let self, error != nil else { return }
        self.queue.async { self.failTransport("The private screen connection could not start.") }
      }
    case "ice_candidate":
      if let candidate = body["candidate"] as? String { peer?.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0")) { _ in } }
    case "terminate":
      finish(reason: (body["reason"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "helper_left", error: BroadcastError.helperLeft)
    default:
      break
    }
  }

  private func createPeer(_ relay: [String: Any]) {
    guard let factory, let config = configuration(relay) else { return failTransport("The relay configuration was rejected.") }
    let created: RTCPeerConnection? = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
    guard let created else { return failTransport("The private screen connection could not start.") }
    let source = factory.videoSource(forScreenCast: true)
    let track = factory.videoTrack(with: source, trackId: "apollo-screen")
    track.isEnabled = !paused
    _ = created.add(track, streamIds: ["apollo-family-assist"])
    peer = created
    self.source = source
    self.track = track
    frames.setPaused(paused)
    frames.open(source)
    scheduleRelayRefresh(relay)
    createOffer()
  }

  /// Cloudflare temporary relay servers from the signaling server; nil when anything is missing or unexpected.
  private func configuration(_ relay: [String: Any]) -> RTCConfiguration? {
    guard relay["provider"] as? String == "cloudflare", let rows = relay["iceServers"] as? [[String: Any]], !rows.isEmpty else { return nil }
    let servers = rows.compactMap { row -> RTCIceServer? in
      guard let urls = row["urls"] as? [String], !urls.isEmpty else { return nil }
      return RTCIceServer(urlStrings: urls, username: row["username"] as? String, credential: row["credential"] as? String)
    }
    guard servers.count == rows.count else { return nil }
    let config = RTCConfiguration()
    config.sdpSemantics = .unifiedPlan
    config.continualGatheringPolicy = .gatherContinually
    config.iceServers = servers
    return config
  }

  /// The helper applied its refreshed relay first; the sharer restarts ICE so the connection moves onto it.
  private func applyRelay(_ relay: [String: Any]) {
    guard let peer else { return }
    guard let config = configuration(relay), peer.setConfiguration(config) else { return failTransport("The refreshed relay configuration was rejected.") }
    scheduleRelayRefresh(relay)
    peer.restartIce()
    createOffer()
  }

  private func scheduleRelayRefresh(_ relay: [String: Any]) {
    refreshWork?.cancel(); refreshWork = nil
    guard let raw = relay["expiresAt"] as? String, let expiry = parseDate(raw) else { return }
    let work = DispatchWorkItem { [weak self] in self?.send(["type": "relay_refresh"]) }
    refreshWork = work
    queue.asyncAfter(deadline: .now() + max(30, expiry.timeIntervalSinceNow - 300), execute: work)
  }

  private func createOffer() {
    peer?.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] sdp, error in
      guard let self else { return }
      self.queue.async {
        guard !self.finished else { return }
        guard let sdp, error == nil else { return self.failTransport("The private screen connection could not start.") }
        self.peer?.setLocalDescription(sdp) { error in
          self.queue.async {
            guard !self.finished else { return }
            if error != nil { return self.failTransport("The private screen connection could not start.") }
            self.send(["type": "offer", "sdp": sdp.sdp])
          }
        }
      }
    }
  }

  /// Queue only: numbering and sending happen together, so messages leave in sequence order (the server drops the
  /// connection on any out-of-order sequence).
  private func send(_ body: [String: Any], evenIfFinished: Bool = false) {
    guard evenIfFinished || !finished, let socket, let handoff else { return }
    var value = body
    value["sequence"] = sequence
    value["generation"] = handoff.generation
    sequence += 1
    guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
    socket.send(.string(text)) { _ in }
  }

  // MARK: Owner commands and pause

  private func observeCommands() {
    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
      guard let observer else { return }
      let handler = Unmanaged<SampleHandler>.fromOpaque(observer).takeUnretainedValue()
      handler.queue.async { handler.applyCommand() }
    }, commandNotification as CFString, nil, .deliverImmediately)
    observingCommands = true
    // Safety net in case a notification arrives before the App Group value is visible here.
    commandTimer = repeating(every: 1) { [weak self] in self?.applyCommand() }
  }

  private func stopObservingCommands() {
    commandTimer?.cancel(); commandTimer = nil
    guard observingCommands else { return }
    observingCommands = false
    CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), CFNotificationName(commandNotification as CFString), nil)
  }

  /// Applies the app's latest command for this session, once.
  private func applyCommand() {
    guard !finished, let handoff, let body = defaults?.dictionary(forKey: commandKey),
          body["sessionId"] as? String == handoff.sessionId, body["generation"] as? String == handoff.generation,
          let issuedAt = body["issuedAt"] as? Double, issuedAt > lastCommandAt, let command = body["command"] as? String else { return }
    lastCommandAt = issuedAt
    switch command {
    case "stop": finish(reason: "owner_stopped", error: BroadcastError.stopped)
    case "pause": setPaused(true)
    case "resume": setPaused(false)
    default: break
    }
  }

  /// Pause blanks the outgoing picture at the gate and on the track, and tells the helper.
  private func setPaused(_ value: Bool) {
    guard !finished, handoff != nil, paused != value else { return }
    paused = value
    frames.setPaused(value)
    track?.isEnabled = !value
    send(["type": "pause_state", "paused": value])
    publish(value ? "paused" : "active", event: value ? "capture_paused" : "capture_started")
  }

  // MARK: State for the app

  /// Writes this session's state for the app (plist values only, no nulls) and tells it to read it.
  private func publish(_ captureState: String, event: String, failure: String? = nil, reason: String? = nil, helperConnected: Bool? = nil, markStarted: Bool = false) {
    guard let handoff else { return }
    revision = max(Date().timeIntervalSince1970, revision + 0.001)
    var body: [String: Any] = ["sessionId": handoff.sessionId, "generation": handoff.generation, "captureState": captureState,
                               "type": event, "revision": revision, "markStarted": markStarted]
    if let failure { body["failureCode"] = failure }
    if let reason { body["endReason"] = reason }
    if let helperConnected { body["helperConnected"] = helperConnected }
    defaults?.set(body, forKey: extensionStateKey)
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(stateNotification as CFString), nil, nil, true)
  }

  // MARK: Ending

  /// Ends the session once. Order: close the frame gate (no frame reaches the source after this), publish the ending,
  /// tell the helper why, then — after a moment for that message to leave — release the connection, track, source and
  /// factory, and only then end the system broadcast.
  private func finish(reason: String, failure: String? = nil, error: Error?, completion: (() -> Void)? = nil) {
    guard !finished else { completion?(); return }
    finished = true
    frames.close()
    stopObservingCommands()
    if let failure { publish("failed", event: "capture_failed", failure: failure) } else { publish("stopped", event: "capture_stopped", reason: reason) }
    send(["type": "terminate", "reason": wireReasons.contains(reason) ? reason : "transport_failed"], evenIfFinished: true)
    queue.asyncAfter(deadline: .now() + 0.75) {
      self.teardown()
      completion?()
      if let error { self.finishBroadcastWithError(error) }
    }
  }

  private func failTransport(_ detail: String) {
    finish(reason: "transport_failed", failure: "transport_failed", error: broadcastError(detail))
  }

  private func teardown() {
    refreshWork?.cancel(); refreshWork = nil
    pingTimer?.cancel(); pingTimer = nil
    socket?.cancel(with: .normalClosure, reason: nil); socket = nil
    session?.invalidateAndCancel(); session = nil
    // The frame gate is already closed. Then the connection, then the track and source it used, then the factory.
    track?.isEnabled = false
    peer?.close(); peer = nil
    track = nil
    source = nil
    factory = nil
    handoff = nil
  }

  private func repeating(every seconds: Double, _ block: @escaping () -> Void) -> DispatchSourceTimer {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + seconds, repeating: seconds)
    timer.setEventHandler(handler: block)
    timer.resume()
    return timer
  }

  private func broadcastError(_ detail: String) -> NSError {
    NSError(domain: "ApolloFamilyAssist", code: 1, userInfo: [NSLocalizedDescriptionKey: detail])
  }

  // MARK: RTCPeerConnectionDelegate (WebRTC signaling thread; every callback moves to `queue`)

  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
    queue.async { self.send(["type": "ice_candidate", "candidate": candidate.sdp]) }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
    queue.async {
      guard !self.finished else { return }
      switch newState {
      case .connected: self.publish(self.paused ? "paused" : "active", event: "helper_connected", helperConnected: true)
      case .disconnected: self.publish("starting", event: "transport_degraded")
      case .failed: self.failTransport("The private screen connection failed.")
      default: break
      }
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) { dataChannel.close() }

  // MARK: URLSessionWebSocketDelegate (delegate queue runs on `queue`)

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    failTransport("The helper connection ended.")
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if error != nil { failTransport("The helper connection ended.") }
  }
}

/// What ReplayKit's frame callback may touch, under one lock. Ending the session closes the gate before the source is
/// released, so no frame is ever handed to a released source (Android: capture stopped before the source is disposed).
private final class FrameGate {
  private let lock = NSLock()
  private var source: RTCVideoSource?
  private var capturer: RTCVideoCapturer?
  private var paused = false
  private var lastFrameNs: Int64 = 0
  private var adaptedTo = CGSize.zero

  func open(_ source: RTCVideoSource) {
    lock.lock(); defer { lock.unlock() }
    self.source = source
    capturer = RTCVideoCapturer(delegate: source)
  }

  func close() {
    lock.lock(); defer { lock.unlock() }
    source = nil
    capturer = nil
  }

  func setPaused(_ value: Bool) {
    lock.lock(); defer { lock.unlock() }
    paused = value
  }

  /// At most 15 frames a second; the picture keeps the screen's own shape and turns with the device.
  func push(_ sampleBuffer: CMSampleBuffer) {
    guard CMSampleBufferDataIsReady(sampleBuffer), let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    guard seconds.isFinite else { return }
    let time = Int64(seconds * 1_000_000_000)
    lock.lock(); defer { lock.unlock() }
    guard let source, let capturer, !paused, time - lastFrameNs >= 66_000_000 else { return }
    lastFrameNs = time
    let size = CGSize(width: CVPixelBufferGetWidth(pixel), height: CVPixelBufferGetHeight(pixel))
    if size != adaptedTo, size.width > 0, size.height > 0 {
      adaptedTo = size
      // Long side at most 1280, same shape as the screen (a fixed 1280×720 would crop a phone screen).
      let scale = min(1, 1280 / max(size.width, size.height))
      source.adaptOutputFormat(toWidth: Int32((size.width * scale / 2).rounded()) * 2, height: Int32((size.height * scale / 2).rounded()) * 2, fps: 15)
    }
    let frame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixel), rotation: FrameGate.rotation(of: sampleBuffer), timeStampNs: time)
    source.capturer(capturer, didCapture: frame)
  }

  /// ReplayKit delivers the screen as the panel sees it and says how the device is turned (iPad landscape, etc.).
  private static func rotation(of sampleBuffer: CMSampleBuffer) -> RTCVideoRotation {
    guard let value = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber,
          let orientation = CGImagePropertyOrientation(rawValue: value.uint32Value) else { return ._0 }
    switch orientation {
    case .left, .leftMirrored: return ._90
    case .down, .downMirrored: return ._180
    case .right, .rightMirrored: return ._270
    default: return ._0
    }
  }
}

/// The server sends Python isoformat times ("2026-06-01T10:00:00.123456+00:00"); ISO8601DateFormatter's default options
/// reject fractional seconds, so they are dropped first (same as the app's FamilyAssistDates.parse).
private func parseDate(_ value: String) -> Date? {
  ISO8601DateFormatter().date(from: value.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
}

/// Written once by the app (ApolloFamilyAssistModule's FamilyAssistHandoff, same fields).
private struct Handoff: Codable {
  let sessionId: String
  let generation: String
  let captureScope: String
  let ephemeralSignalingTicket: String
  let signalingBaseUrl: String
  let helperDisplayName: String
  let expiresAt: Date
}

private enum BroadcastError: LocalizedError {
  case stopped, helperLeft

  var errorDescription: String? {
    switch self {
    case .stopped: return "Screen sharing stopped."
    case .helperLeft: return "Your helper left. Screen sharing stopped."
    }
  }
}
