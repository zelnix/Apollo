import Foundation
import WebRTC

final class FamilyAssistViewerPeer: NSObject, RTCPeerConnectionDelegate, URLSessionWebSocketDelegate {
  private let input: FamilyAssistViewerInput
  private let factory = RTCPeerConnectionFactory()
  private var peer: RTCPeerConnection?
  private var socket: URLSessionWebSocketTask?
  private var sequence = 0
  private weak var renderer: RTCVideoRenderer?
  private var remoteTrack: RTCVideoTrack?
  init(_ input: FamilyAssistViewerInput) { self.input = input; super.init() }
  func attach(_ value: RTCVideoRenderer?) { if let renderer { remoteTrack?.remove(renderer) }; renderer = value; if let value { remoteTrack?.add(value) } }
  func connect() {
    guard var components = URLComponents(string: input.signalingBaseUrl.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://") + "/family/assist/sessions/\(input.sessionId)/signal") else { return }
    components.queryItems = [URLQueryItem(name: "ticket", value: input.ephemeralSignalingTicket)]
    guard let url = components.url else { return }
    socket = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil).webSocketTask(with: url); socket?.resume(); receive()
  }
  private func receive() { socket?.receive { [weak self] result in if case let .success(message) = result, case let .string(text) = message { self?.handle(text); self?.receive() } } }
  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = body["type"] as? String else { return }
    if type == "ready", let relay = body["relay"] as? [String: Any] { createPeer(relay) }
    if type == "offer", let sdp = body["sdp"] as? String { peer?.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] error in if error == nil { self?.createAnswer() } } }
    if type == "ice_candidate", let candidate = body["candidate"] as? String { peer?.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0")) }
    if type == "pause_state", body["paused"] as? Bool == true { attach(nil) } else if type == "pause_state" { attach(FamilyAssistViewerRegistry.shared.renderer) }
    if type == "terminate" { close() }
  }
  private func createPeer(_ relay: [String: Any]) {
    let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan
    config.iceServers = [RTCIceServer(urlStrings: relay["uris"] as? [String] ?? [], username: relay["username"] as? String, credential: relay["credential"] as? String)]
    peer = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
  }
  private func createAnswer() { peer?.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] sdp, error in guard let self, let sdp, error == nil else { return }; self.peer?.setLocalDescription(sdp) { error in if error == nil { self.send(["type": "answer", "sdp": sdp.sdp]) } } } }
  private func send(_ body: [String: Any]) { var value = body; value["sequence"] = sequence; value["generation"] = input.generation; sequence += 1; guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }; socket?.send(.string(text)) { _ in } }
  func close() { if let renderer { remoteTrack?.remove(renderer) }; remoteTrack = nil; peer?.close(); peer = nil; socket?.cancel(with: .normalClosure, reason: nil); socket = nil }
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) { if let track = stream.videoTracks.first { remoteTrack = track; attach(FamilyAssistViewerRegistry.shared.renderer); FamilyAssistCoordinator.shared.transition("active", event: "capture_started") } }
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) { if let track = rtpReceiver.track as? RTCVideoTrack { remoteTrack = track; attach(FamilyAssistViewerRegistry.shared.renderer); FamilyAssistCoordinator.shared.transition("active", event: "capture_started") } }
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) { send(["type": "ice_candidate", "candidate": candidate.sdp]) }
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) { if newState == .failed { FamilyAssistCoordinator.shared.transition("failed", event: "capture_failed", failure: "transport_failed") } }
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) { dataChannel.close() }
  func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {}
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {}
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) { FamilyAssistCoordinator.shared.transition("stopped", event: "helper_disconnected") }
}