import Foundation
import ReplayKit
import WebRTC

final class SampleHandler: RPBroadcastSampleHandler, RTCPeerConnectionDelegate, URLSessionWebSocketDelegate {
  private let appGroup = "group.app.apollo.hwg.apollo"
  private var handoff: Handoff?
  private var socket: URLSessionWebSocketTask?
  private let factory = RTCPeerConnectionFactory()
  private var peer: RTCPeerConnection?
  private var source: RTCVideoSource?
  private var track: RTCVideoTrack?
  private var sequence = 0
  private var lastFrameNs: Int64 = 0
  private var paused = false
  private var refreshWork: DispatchWorkItem?

  override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return fail("Protected storage is unavailable.") }
    let url = root.appendingPathComponent("family-assist-handoff.json")
    guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(Handoff.self, from: data), value.expiresAt > Date() else { return fail("This help request expired. Return to Apollo and try again.") }
    try? FileManager.default.removeItem(at: url); handoff = value; publishState("starting", event: "capture_starting"); connect(value)
  }
  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video, let handoff, command(for: handoff) != "stop" else { if self.handoff != nil && command(for: handoff) == "stop" { finishBroadcastWithError(BroadcastError.stopped) }; return }
    let shouldPause = command(for: handoff) == "pause"; if shouldPause != paused { paused = shouldPause; track?.isEnabled = !shouldPause; send(["type": "pause_state", "paused": shouldPause]) }
    guard !paused, CMSampleBufferDataIsReady(sampleBuffer), let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let time = Int64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1_000_000_000)
    guard time - lastFrameNs >= 66_000_000 else { return }; lastFrameNs = time
    source?.capturer(RTCVideoCapturer(delegate: source!), didCapture: RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixel), rotation: ._0, timeStampNs: time))
  }
  override func broadcastPaused() { paused = true; track?.isEnabled = false; publishState("paused", event: "capture_paused"); send(["type": "pause_state", "paused": true]) }
  override func broadcastResumed() { paused = false; track?.isEnabled = true; publishState("active", event: "capture_started"); send(["type": "pause_state", "paused": false]) }
  override func broadcastFinished() { publishState("stopped", event: "capture_stopped", reason: "os_terminated"); terminate("os_terminated") }

  private func connect(_ value: Handoff) {
    var base = value.signalingBaseUrl.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    base += "/family/assist/sessions/\(value.sessionId)/signal"
    guard var components = URLComponents(string: base) else { return fail("The secure signaling address is invalid.") }
    components.queryItems = [URLQueryItem(name: "ticket", value: value.ephemeralSignalingTicket)]
    guard let url = components.url else { return fail("The secure signaling address is invalid.") }
    socket = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil).webSocketTask(with: url); socket?.resume(); receive()
  }
  private func receive() { socket?.receive { [weak self] result in if case let .success(message) = result, case let .string(text) = message { self?.handle(text); self?.receive() } else { self?.fail("The helper connection ended.") } } }
  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = body["type"] as? String else { return }
    if type == "ready", let relay = body["relay"] as? [String: Any] { createPeer(relay) }
    if type == "relay_credentials", let relay = body["relay"] as? [String: Any] { applyRelay(relay) }
    if type == "answer", let sdp = body["sdp"] as? String { peer?.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { _ in } }
    if type == "ice_candidate", let candidate = body["candidate"] as? String { peer?.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0")) }
    if type == "terminate" { finishBroadcastWithError(BroadcastError.stopped) }
  }
  private func createPeer(_ relay: [String: Any]) {
    guard let config = configuration(relay) else { return fail("The relay configuration was rejected.") }
    peer = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
    source = factory.videoSource(); source?.adaptOutputFormat(toWidth: 1280, height: 720, fps: 15)
    if let source { track = factory.videoTrack(with: source, trackId: "apollo-screen"); peer?.add(track!, streamIds: ["apollo-family-assist"]) }
    scheduleRelayRefresh(relay); createOffer(iceRestart: false)
  }
  private func configuration(_ relay: [String: Any]) -> RTCConfiguration? {
    guard relay["provider"] as? String == "cloudflare", let rows = relay["iceServers"] as? [[String: Any]] else { return nil }
    let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan
    config.iceServers = rows.compactMap { row in guard let urls = row["urls"] as? [String], !urls.isEmpty else { return nil }; return RTCIceServer(urlStrings: urls, username: row["username"] as? String, credential: row["credential"] as? String) }
    return config.iceServers.count == rows.count ? config : nil
  }
  private func applyRelay(_ relay: [String: Any]) {
    guard let config = configuration(relay), peer?.setConfiguration(config) == true else { return fail("The refreshed relay configuration was rejected.") }
    scheduleRelayRefresh(relay); peer?.restartIce(); createOffer(iceRestart: true)
  }
  private func createOffer(iceRestart: Bool) {
    let mandatory = iceRestart ? ["IceRestart": "true"] : nil
    peer?.offer(for: RTCMediaConstraints(mandatoryConstraints: mandatory, optionalConstraints: nil)) { [weak self] sdp, error in guard let self, let sdp, error == nil else { return }; self.peer?.setLocalDescription(sdp) { error in if error == nil { self.send(["type": "offer", "sdp": sdp.sdp]) } } }
  }
  private func scheduleRelayRefresh(_ relay: [String: Any]) {
    refreshWork?.cancel(); guard let raw = relay["expiresAt"] as? String, let expiry = ISO8601DateFormatter().date(from: raw) else { return }
    let work = DispatchWorkItem { [weak self] in self?.send(["type": "relay_refresh"]) }; refreshWork = work
    DispatchQueue.global().asyncAfter(deadline: .now() + max(30, expiry.timeIntervalSinceNow - 300), execute: work)
  }
  private func send(_ body: [String: Any]) { guard let handoff else { return }; var value = body; value["sequence"] = sequence; value["generation"] = handoff.generation; sequence += 1; guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }; socket?.send(.string(text)) { _ in } }
  private func command(for handoff: Handoff) -> String? { guard let body = UserDefaults(suiteName: appGroup)?.dictionary(forKey: "family-assist-command"), body["sessionId"] as? String == handoff.sessionId, body["generation"] as? String == handoff.generation else { return nil }; return body["command"] as? String }
  private func publishState(_ state: String, event: String, failure: String? = nil, reason: String? = nil) {
    guard let handoff else { return }
    UserDefaults(suiteName: appGroup)?.set(["sessionId": handoff.sessionId, "generation": handoff.generation, "captureState": state,
      "lastTransitionAt": ISO8601DateFormatter().string(from: Date()), "failureCode": failure ?? NSNull(), "endReason": reason ?? NSNull(), "type": event], forKey: "family-assist-extension-state")
  }
  private func terminate(_ reason: String) {
    guard let handoff else { return close() }
    var body: [String: Any] = ["type": "terminate", "reason": reason, "sequence": sequence, "generation": handoff.generation]; sequence += 1
    guard let data = try? JSONSerialization.data(withJSONObject: body), let text = String(data: data, encoding: .utf8) else { return close() }
    socket?.send(.string(text)) { [weak self] _ in self?.close() }
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) { [weak self] in self?.close() }
  }
  private func fail(_ detail: String) { publishState("failed", event: "capture_failed", failure: "transport_failed"); terminate("transport_failed"); finishBroadcastWithError(NSError(domain: "ApolloFamilyAssist", code: 1, userInfo: [NSLocalizedDescriptionKey: detail])) }
  private func close() { refreshWork?.cancel(); refreshWork = nil; track?.isEnabled = false; peer?.close(); peer = nil; source = nil; track = nil; socket?.cancel(with: .normalClosure, reason: nil); socket = nil; handoff = nil }
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) { send(["type": "ice_candidate", "candidate": candidate.sdp]) }
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) { if newState == .connected { publishState("active", event: "helper_connected") }; if newState == .failed { fail("The private screen connection failed.") } }
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) { dataChannel.close() }
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {}
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {}
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) { if handoff != nil { fail("The helper connection ended.") } }
}

private struct Handoff: Codable { let sessionId: String; let generation: String; let captureScope: String; let ephemeralSignalingTicket: String; let signalingBaseUrl: String; let helperDisplayName: String; let expiresAt: Date }
private enum BroadcastError: LocalizedError { case stopped; var errorDescription: String? { "Screen sharing stopped." } }