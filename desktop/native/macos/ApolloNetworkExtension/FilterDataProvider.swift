import Foundation
import Network
import NetworkExtension

final class FilterDataProvider: NEFilterDataProvider {
  private let suite = "group.app.apollo.hwg.apollo"
  private let evidenceFile = "enforcementEvidence.json"

  override func startFilter(completionHandler: @escaping (Error?) -> Void) { completionHandler(nil) }
  override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) { completionHandler() }

  override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
    guard let socket = flow as? NEFilterSocketFlow else { return .allow() }
    let hostname = socket.remoteHostname ?? (socket.remoteEndpoint as? NWHostEndpoint)?.hostname
    guard let host = hostname?.lowercased(), blocked(host) else { return .allow() }
    record(host: host, appId: flow.sourceAppIdentifier)
    return .drop()
  }

  private func blocked(_ host: String) -> Bool {
    let values: [String]
    if let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suite),
       let data = try? Data(contentsOf: root.appendingPathComponent("blockedDomains.json")),
       let decoded = try? JSONDecoder().decode([String].self, from: data) { values = decoded }
    else { values = [] }
    return values.contains { rule in host == rule || host.hasSuffix(".\(rule)") }
  }

  private func record(host: String, appId: String?) {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suite) else { return }
    let file = root.appendingPathComponent(evidenceFile)
    var values = ((try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] }) ?? []
    values.insert([
      "evidenceId": UUID().uuidString, "eventId": NSNull(), "deviceId": NSNull(), "platform": "macos",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString, "sdkVersion": "1.1.0",
      "observedAt": ISO8601DateFormatter().string(from: Date()), "mechanism": "network_extension",
      "direction": "outbound", "protocol": "unknown", "destination": ["ip": NSNull(), "domain": host, "port": NSNull()],
      "attribution": ["appId": appId ?? NSNull(), "processName": NSNull(), "confidence": appId == nil ? "unavailable" : "medium"],
      "matchedRuleId": host, "threatId": NSNull(), "requestedAction": "block", "enforcedAction": "blocked",
      "result": "verified", "ruleSource": "local_blocklist", "confidence": "high",
      "sourceMetadata": ["provider": "NEFilterDataProvider"], "correlationId": NSNull()
    ], at: 0)
    if let data = try? JSONSerialization.data(withJSONObject: Array(values.prefix(200)), options: [.sortedKeys]) { try? data.write(to: file, options: .atomic) }
  }
}