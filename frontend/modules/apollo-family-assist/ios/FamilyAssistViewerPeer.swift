import Foundation
import WebRTC

/// The helper's side of one Family Help session on iPhone and iPad: it only watches and never sends media.
///
/// Ownership: this peer builds its own factory through FamilyAssistWebRtc and releases it — with the peer connection,
/// the socket and the remote track — when it closes.
///
/// Threads: socket callbacks, WebRTC callbacks and teardown all run on one private serial queue (the URLSession
/// delegate queue runs on it too), so messages are numbered and sent in order. Nothing here touches a view;
/// FamilyAssistRenderer does that on the main thread. After close every callback is ignored.
///
/// Ending: when the far side terminates, signaling fails or the transport fails, the peer reports onEnded once; the
/// runtime then closes it and records the ending for this session and generation only.
final class FamilyAssistViewerPeer: NSObject, RTCPeerConnectionDelegate, URLSessionWebSocketDelegate {
  let sessionId: String
  let generation: String
  private let input: FamilyAssistViewerInput
  private let onEnded: (FamilyAssistViewerPeer, String) -> Void
  private let queue = DispatchQueue(label: "app.apollo.familyassist.viewer")
  private let closingLock = NSLock()
  private var closing = false // set the moment the owner closes, before teardown runs
  // Everything below is used on `queue` only.
  private var factory: RTCPeerConnectionFactory?
  private var peer: RTCPeerConnection?
  private var session: URLSession?
  private var socket: URLSessionWebSocketTask?
  private var remoteTrack: RTCVideoTrack?
  private var refreshWork: DispatchWorkItem?
  private var pingTimer: DispatchSourceTimer?
  private var sequence = 0
  private var closed = false
  private var ended = false
  private var connected = false
  private var selectedPath: String? // the route WebRTC picked for the picture

  init(_ input: FamilyAssistViewerInput, onEnded: @escaping (FamilyAssistViewerPeer, String) -> Void) {
    self.input = input
    sessionId = input.sessionId
    generation = input.generation
    self.onEnded = onEnded
    super.init()
  }

  func connect() { queue.async { self.open() } }

  /// Close now. Idempotent; every later callback is ignored.
  func close() {
    closingLock.lock(); closing = true; closingLock.unlock()
    queue.async { self.closeNow() }
  }

  private var inactive: Bool {
    closingLock.lock(); defer { closingLock.unlock() }
    return closing || closed
  }

  private func open() {
    guard !inactive else { return }
    guard let url = FamilyAssistWebRtc.signalingURL(base: input.signalingBaseUrl, sessionId: sessionId, ticket: input.ephemeralSignalingTicket) else {
      return end("signaling_failed")
    }
    factory = FamilyAssistWebRtc.makeFactory()
    let delegateQueue = OperationQueue()
    delegateQueue.maxConcurrentOperationCount = 1
    delegateQueue.underlyingQueue = queue
    let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: delegateQueue)
    let task = session.webSocketTask(with: url)
    self.session = session
    socket = task
    task.resume()
    receive()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 20, repeating: 20)
    timer.setEventHandler { [weak self] in self?.socket?.sendPing { _ in } }
    timer.resume()
    pingTimer = timer
  }

  // MARK: Signaling

  private func receive() {
    socket?.receive { [weak self] result in
      guard let self, !self.inactive else { return }
      switch result {
      case .success(.string(let text)): self.handle(text); self.receive()
      case .success: self.receive()
      case .failure: self.end("signaling_failed")
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let type = body["type"] as? String else { return end("signaling_invalid") }
    // A message that names another generation belongs to an older session: ignore it.
    if let messageGeneration = body["generation"] as? String, !messageGeneration.isEmpty, messageGeneration != generation { return }
    switch type {
    case "ready", "relay_credentials":
      guard let relay = body["relay"] as? [String: Any] else { return end("signaling_invalid") }
      if peer == nil { createPeer(relay) } else { applyRelay(relay) }
    case "offer":
      if let sdp = body["sdp"] as? String { setRemoteOffer(sdp) }
    case "ice_candidate":
      if let candidate = body["candidate"] as? String { peer?.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0")) { _ in } }
    case "pause_state":
      FamilyAssistRenderer.shared.setPaused(body["paused"] as? Bool == true)
    case "terminate":
      end((body["reason"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "helper_left")
    default:
      break
    }
  }

  private func createPeer(_ relay: [String: Any]) {
    guard let factory, let config = FamilyAssistWebRtc.configuration(relay) else { return end("transport_failed") }
    let created: RTCPeerConnection? = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
    guard let created else { return end("transport_failed") }
    peer = created
    reportPath("connecting")
    scheduleRelayRefresh(relay)
  }

  /// The helper applies a refreshed relay first; the sharer then restarts ICE onto it.
  private func applyRelay(_ relay: [String: Any]) {
    guard let peer else { return }
    guard let config = FamilyAssistWebRtc.configuration(relay), peer.setConfiguration(config) else { return end("relay_refresh_rejected") }
    scheduleRelayRefresh(relay)
  }

  private func scheduleRelayRefresh(_ relay: [String: Any]) {
    refreshWork?.cancel(); refreshWork = nil
    guard let raw = relay["expiresAt"] as? String, let expiry = FamilyAssistDates.parse(raw) else { return }
    let work = DispatchWorkItem { [weak self] in self?.send(["type": "relay_refresh"]) }
    refreshWork = work
    queue.asyncAfter(deadline: .now() + max(30, expiry.timeIntervalSinceNow - 360), execute: work)
  }

  private func setRemoteOffer(_ sdp: String) {
    peer?.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] error in
      guard let self else { return }
      self.queue.async {
        guard !self.inactive else { return }
        if error != nil { return self.end("sdp_failed") }
        self.createAnswer()
      }
    }
  }

  private func createAnswer() {
    peer?.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] sdp, error in
      guard let self else { return }
      self.queue.async {
        guard !self.inactive else { return }
        guard let sdp, error == nil else { return self.end("sdp_failed") }
        self.peer?.setLocalDescription(sdp) { error in
          self.queue.async {
            guard !self.inactive else { return }
            if error != nil { return self.end("sdp_failed") }
            self.send(["type": "answer", "sdp": sdp.sdp])
          }
        }
      }
    }
  }

  /// Queue only: numbering and sending happen together, so messages leave in sequence order (the server drops the
  /// connection on any out-of-order sequence).
  private func send(_ body: [String: Any]) {
    guard !inactive, let socket else { return }
    var value = body
    value["sequence"] = sequence
    value["generation"] = generation
    sequence += 1
    guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
    socket.send(.string(text)) { _ in }
  }

  /// Reports the ending once; the runtime closes the peer and records it (Android: FamilyAssistRtcPeer.end).
  private func end(_ reason: String) {
    guard !inactive, !ended else { return }
    ended = true
    onEnded(self, reason)
  }

  private func closeNow() {
    guard !closed else { return }
    closed = true
    refreshWork?.cancel(); refreshWork = nil
    pingTimer?.cancel(); pingTimer = nil
    socket?.cancel(with: .normalClosure, reason: nil); socket = nil
    session?.invalidateAndCancel(); session = nil
    // Order: the renderer comes off the track, then the connection closes, then the factory goes.
    remoteTrack?.remove(FamilyAssistRenderer.shared); remoteTrack = nil
    peer?.close(); peer = nil
    factory = nil
  }

  /// Queue only. Tells JS how the picture travels: connecting, direct, relayed or reconnecting.
  private func reportPath(_ path: String) {
    guard !inactive else { return }
    FamilyAssistRuntime.shared.updatePath(sessionId, generation, path)
  }

  private func updateState(_ captureState: String, _ event: String) {
    guard !inactive else { return }
    FamilyAssistRuntime.shared.update(sessionId, generation, captureState: captureState, event: event)
  }

  // MARK: RTCPeerConnectionDelegate (WebRTC signaling thread; every callback moves to `queue`)

  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
    queue.async { self.send(["type": "ice_candidate", "candidate": candidate.sdp]) }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
    queue.async {
      switch newState {
      case .connected:
        self.connected = true
        self.updateState("active", "capture_started")
        if let path = self.selectedPath { self.reportPath(path) }
      case .disconnected:
        self.connected = false
        self.updateState("starting", "transport_degraded")
        self.reportPath("reconnecting")
      case .failed: self.end("transport_failed")
      default: break
      }
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
    guard let track = rtpReceiver.track as? RTCVideoTrack else { return }
    queue.async {
      guard !self.inactive, self.remoteTrack == nil else { return }
      self.remoteTrack = track
      track.add(FamilyAssistRenderer.shared)
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChangeLocalCandidate local: RTCIceCandidate, remoteCandidate remote: RTCIceCandidate,
                      lastReceivedMs lastDataReceivedMs: Int32, changeReason reason: String) {
    let path = FamilyAssistRoute.path(local: local.sdp, remote: remote.sdp)
    queue.async {
      self.selectedPath = path
      if self.connected { self.reportPath(path) }
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
    end("signaling_closed")
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if error != nil { end("signaling_failed") }
  }
}
