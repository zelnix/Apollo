import CryptoKit
import Foundation
import IdentityLookup

/// Filters SMS/MMS from unknown senders using a small local ruleset. iMessage and known contacts are
/// outside Apple's Message Filter scope. Raw message text and sender values never leave the extension.
@available(iOSApplicationExtension 14.0, *)
final class MessageFilterExtension: ILMessageFilterExtension, ILMessageFilterQueryHandling {
  private var suite: String {
    let extensionId = Bundle.main.bundleIdentifier ?? ""
    let appId = extensionId.replacingOccurrences(of: ".messagefilter", with: "")
    return "group.\(appId).apollo"
  }
  private let eventsKey = "apollo.textguard.events.v1"
  private let activityKey = "apollo.textguard.lastObservedAt"
  private let maxEvents = 50

  func handle(
    _ queryRequest: ILMessageFilterQueryRequest,
    context: ILMessageFilterExtensionContext,
    completion: @escaping (ILMessageFilterQueryResponse) -> Void
  ) {
    let body = (queryRequest.messageBody ?? "").lowercased()
    let sender = queryRequest.sender ?? ""
    let assessment = assess(body)
    record(sender: sender, body: body, assessment: assessment)

    let response = ILMessageFilterQueryResponse()
    response.action = assessment.score >= 3 ? .junk : .none
    completion(response)
  }

  private func assess(_ body: String) -> (score: Int, reasons: [String]) {
    var score = 0
    var reasons: [String] = []
    let urgent = ["urgent", "immediately", "final notice", "account suspended", "payment failed", "act now"]
    let payment = ["gift card", "crypto", "bitcoin", "bank transfer", "pay now", "refund fee"]
    let credential = ["verification code", "security code", "password", "recovery phrase", "sign in now"]
    if urgent.contains(where: body.contains) { score += 1; reasons.append("urgent pressure") }
    if payment.contains(where: body.contains) { score += 2; reasons.append("unusual payment request") }
    if credential.contains(where: body.contains) { score += 2; reasons.append("credential or code request") }
    if body.range(of: #"https?://|\b[a-z0-9-]+\.(top|click|xyz|zip|mov|shop)\b"#, options: .regularExpression) != nil {
      score += 1; reasons.append("link in an unexpected message")
    }
    return (score, reasons)
  }

  private func record(sender: String, body: String, assessment: (score: Int, reasons: [String])) {
    guard let defaults = UserDefaults(suiteName: suite) else { return }
    let observedAt = ISO8601DateFormatter().string(from: Date())
    let digest = SHA256.hash(data: Data("\(sender)|\(body)".utf8)).map { String(format: "%02x", $0) }.joined()
    let event: [String: Any] = [
      "id": digest,
      "observedAt": observedAt,
      "digest": digest,
      "score": assessment.score,
      "reasons": assessment.reasons,
      "filedAsJunk": assessment.score >= 3,
      "source": "ios_message_filter"
    ]
    var events = defaults.array(forKey: eventsKey) as? [[String: Any]] ?? []
    events.removeAll { ($0["id"] as? String) == digest }
    events.insert(event, at: 0)
    defaults.set(Array(events.prefix(maxEvents)), forKey: eventsKey)
    defaults.set(observedAt, forKey: activityKey)
  }
}