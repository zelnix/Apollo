import Foundation
import WebRTC

/// The one WebRTC set-up path for Family Help in the app (the Broadcast extension is a separate process with its own).
/// SSL and the audio session are set up once per process, before the first factory; each viewer peer owns the factory
/// it gets here and releases it when it closes. Nothing else in the app module builds a factory.
/// Audio stays off: Family Help is video only, so WebRTC never starts the microphone or takes over the app's sound.
enum FamilyAssistWebRtc {
  private static let setUp: Void = {
    _ = RTCInitializeSSL()
    let audio = RTCAudioSession.sharedInstance()
    audio.useManualAudio = true
    audio.isAudioEnabled = false
  }()

  static func makeFactory() -> RTCPeerConnectionFactory {
    _ = setUp
    return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
  }

  /// Cloudflare temporary relay servers from the signaling server; nil when anything is missing or unexpected.
  static func configuration(_ relay: [String: Any]) -> RTCConfiguration? {
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

  static func signalingURL(base: String, sessionId: String, ticket: String) -> URL? {
    let root = base.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard var components = URLComponents(string: root + "/family/assist/sessions/\(sessionId)/signal") else { return nil }
    components.queryItems = [URLQueryItem(name: "ticket", value: ticket)]
    return components.url
  }
}
