import Foundation
import UIKit
import UniformTypeIdentifiers

/// Apollo's Share Extension writes one complete, protected manifest only after every
/// submitted item has been inventoried and copied. The host imports by opaque UUID.
final class ShareViewController: UIViewController {
  private let appGroup = "<APP_GROUP>"
  private let urlScheme = "<URL_SCHEME>"
  private let maximumItems = 20
  private let maximumItemBytes: Int64 = 20 * 1024 * 1024
  private let maximumTotalBytes: Int64 = 50 * 1024 * 1024
  private let retentionSeconds: TimeInterval = 24 * 60 * 60
  private let timeoutSeconds: TimeInterval = 20
  private let stateQueue = DispatchQueue(label: "app.apollo.share-intake.state")
  private var completed = false
  private var results: [[String: Any]] = []
  private var failures: [String] = []
  private var totalBytes: Int64 = 0

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    processSubmittedItems()
  }

  private func processSubmittedItems() {
    cleanupExpiredHandoffs()
    guard let context = extensionContext else { return fail("Apollo could not open the share request.") }
    let extensionItems = context.inputItems.compactMap { $0 as? NSExtensionItem }
    let providers = extensionItems.flatMap { item in (item.attachments ?? []).map { (item, $0) } }
    guard !providers.isEmpty else { return fail("Nothing was supplied to Apollo.") }
    guard providers.count <= maximumItems else { return fail("Choose no more than 20 items at once.") }

    let handoffId = UUID().uuidString.lowercased()
    guard let directory = handoffDirectory(handoffId), createProtectedDirectory(directory) else {
      return fail("Apollo could not prepare protected storage for these items.")
    }
    let group = DispatchGroup()
    for (index, pair) in providers.enumerated() {
      group.enter()
      load(pair.1, context: pair.0.attributedContentText?.string, index: index, directory: directory) { group.leave() }
    }
    let timeout = DispatchWorkItem { [weak self] in self?.fail("The shared items took too long to import. Try fewer items.", cleanup: directory) }
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeout)
    group.notify(queue: .main) { [weak self] in
      timeout.cancel()
      self?.commit(handoffId: handoffId, expectedCount: providers.count, directory: directory)
    }
  }

  private func load(_ provider: NSItemProvider, context: String?, index: Int, directory: URL, done: @escaping () -> Void) {
    guard let type = supportedType(provider) else {
      stateQueue.sync { failures.append("Item \(index + 1) is not a supported link, text, image, or file.") }
      done(); return
    }
    provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { [weak self] item, error in
      defer { done() }
      guard let self else { return }
      if let error { self.stateQueue.sync { self.failures.append("Item \(index + 1) could not be loaded: \(error.localizedDescription)") }; return }
      do {
        let record = try self.makeRecord(item: item, declaredType: type.identifier, context: context, index: index, directory: directory)
        self.stateQueue.sync { self.results.append(record) }
      } catch {
        self.stateQueue.sync { self.failures.append("Item \(index + 1) could not be imported: \(error.localizedDescription)") }
      }
    }
  }

  private func supportedType(_ provider: NSItemProvider) -> UTType? {
    let supported: [UTType] = [.image, .url, .plainText, .pdf, .data, .item]
    return supported.first { provider.hasItemConformingToTypeIdentifier($0.identifier) }
  }

  private func makeRecord(item: NSSecureCoding?, declaredType: String, context: String?, index: Int, directory: URL) throws -> [String: Any] {
    if let url = item as? URL, declaredType == UTType.url.identifier, !url.isFileURL {
      return compact(["index": index, "kind": "url", "url": url.absoluteString, "declaredType": declaredType, "context": context])
    }
    if let text = item as? String {
      return compact(["index": index, "kind": "text", "text": String(text.prefix(200_000)), "declaredType": declaredType, "context": context])
    }
    if let image = item as? UIImage, let data = image.pngData() {
      return try writeData(data, safeName: "shared-image.png", declaredType: declaredType, actualType: UTType.png.identifier, index: index, context: context, directory: directory)
    }
    if let data = item as? Data {
      return try writeData(data, safeName: "shared-item", declaredType: declaredType, actualType: declaredType, index: index, context: context, directory: directory)
    }
    if let url = item as? URL, url.isFileURL {
      return try copyFile(url, declaredType: declaredType, index: index, context: context, directory: directory)
    }
    throw IntakeError.unsupported
  }

  private func copyFile(_ source: URL, declaredType: String, index: Int, context: String?, directory: URL) throws -> [String: Any] {
    let accessed = source.startAccessingSecurityScopedResource()
    defer { if accessed { source.stopAccessingSecurityScopedResource() } }
    let values = try source.resourceValues(forKeys: [.fileSizeKey, .nameKey, .contentTypeKey])
    let bytes = Int64(values.fileSize ?? 0)
    try admit(bytes)
    let safeName = sanitize(values.name ?? source.lastPathComponent)
    let suffix = source.pathExtension.isEmpty ? "" : ".\(source.pathExtension.lowercased())"
    let destination = directory.appendingPathComponent("\(UUID().uuidString.lowercased())\(suffix)")
    try FileManager.default.copyItem(at: source, to: destination)
    try protect(destination)
    return compact(["index": index, "kind": "file", "path": destination.absoluteString, "fileName": safeName, "size": bytes,
                    "mimeType": values.contentType?.preferredMIMEType ?? "application/octet-stream", "declaredType": declaredType,
                    "actualType": values.contentType?.identifier ?? UTType.data.identifier, "context": context])
  }

  private func writeData(_ data: Data, safeName: String, declaredType: String, actualType: String, index: Int, context: String?, directory: URL) throws -> [String: Any] {
    let bytes = Int64(data.count); try admit(bytes)
    let actual = UTType(actualType)
    let suffix = actual?.preferredFilenameExtension.map { ".\($0)" } ?? ""
    let destination = directory.appendingPathComponent("\(UUID().uuidString.lowercased())\(suffix)")
    try data.write(to: destination, options: .atomic)
    try protect(destination)
    return compact(["index": index, "kind": actual?.conforms(to: .image) == true ? "image" : "file", "path": destination.absoluteString,
                    "fileName": sanitize(safeName), "size": bytes, "mimeType": actual?.preferredMIMEType ?? "application/octet-stream",
                    "declaredType": declaredType, "actualType": actualType, "context": context])
  }

  private func admit(_ bytes: Int64) throws {
    guard bytes >= 0, bytes <= maximumItemBytes else { throw IntakeError.tooLarge }
    try stateQueue.sync {
      guard totalBytes + bytes <= maximumTotalBytes else { throw IntakeError.tooLarge }
      totalBytes += bytes
    }
  }

  private func commit(handoffId: String, expectedCount: Int, directory: URL) {
    let snapshot = stateQueue.sync { (results.sorted { ($0["index"] as? Int ?? 0) < ($1["index"] as? Int ?? 0) }, failures) }
    guard snapshot.1.isEmpty, snapshot.0.count == expectedCount else {
      return fail(snapshot.1.first ?? "Apollo could not import every shared item.", cleanup: directory)
    }
    let texts = snapshot.0.compactMap { $0["text"] as? String }
    let urls = snapshot.0.compactMap { $0["url"] as? String }
    let files = snapshot.0.filter { ($0["path"] as? String) != nil }.map { row in
      compact(["path": row["path"], "fileName": row["fileName"], "mimeType": row["mimeType"], "size": row["size"],
               "declaredType": row["declaredType"], "actualType": row["actualType"], "context": row["context"]])
    }
    let created = Date(); let expires = created.addingTimeInterval(retentionSeconds)
    let manifest: [String: Any] = ["schemaVersion": 1, "handoffId": handoffId, "state": "committed", "createdAt": iso(created), "expiresAt": iso(expires),
      "itemCount": expectedCount, "payload": compact(["text": texts.isEmpty ? nil : texts.joined(separator: "\n"), "webUrl": urls.first, "files": files])]
    do {
      let data = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
      let pending = directory.appendingPathComponent("manifest.pending.json")
      let complete = directory.appendingPathComponent("manifest.complete.json")
      try data.write(to: pending, options: .atomic); try protect(pending)
      try FileManager.default.moveItem(at: pending, to: complete); try protect(complete)
      openHost(handoffId)
    } catch { fail("Apollo could not finish the protected handoff.", cleanup: directory) }
  }

  private func openHost(_ handoffId: String) {
    guard finishOnce(), let url = URL(string: "\(urlScheme)://share?nativeHandoffId=\(handoffId)") else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication { application.open(url); break }
      responder = current.next
    }
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  private func fail(_ message: String, cleanup: URL? = nil) {
    DispatchQueue.main.async {
      guard self.finishOnce() else { return }
      if let cleanup { try? FileManager.default.removeItem(at: cleanup) }
      let alert = UIAlertController(title: "Couldn’t share with Apollo", message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Close", style: .default) { _ in self.extensionContext?.cancelRequest(withError: IntakeError.failed) })
      self.present(alert, animated: true)
    }
  }

  private func finishOnce() -> Bool {
    if completed { return false }
    completed = true
    return true
  }

  private func handoffDirectory(_ id: String) -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("ApolloShareHandoffs", isDirectory: true).appendingPathComponent(id, isDirectory: true)
  }
  private func createProtectedDirectory(_ url: URL) -> Bool {
    do { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]); return true }
    catch { return false }
  }
  private func protect(_ url: URL) throws { try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path) }
  private func sanitize(_ name: String) -> String {
    let leaf = URL(fileURLWithPath: name).lastPathComponent.replacingOccurrences(of: "\u{0000}", with: "")
    return String((leaf.isEmpty ? "shared-item" : leaf).prefix(120))
  }
  private func compact(_ input: [String: Any?]) -> [String: Any] { input.compactMapValues { $0 } }
  private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }

  private func cleanupExpiredHandoffs() {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("ApolloShareHandoffs") else { return }
    let directories = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    for directory in directories {
      let manifest = directory.appendingPathComponent("manifest.complete.json")
      let data = try? Data(contentsOf: manifest)
      let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      let expiry = (object?["expiresAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
      let modified = try? directory.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
      if (expiry ?? modified ?? .distantPast) <= Date() { try? FileManager.default.removeItem(at: directory) }
    }
  }
}

private enum IntakeError: LocalizedError {
  case unsupported, tooLarge, failed
  var errorDescription: String? {
    switch self { case .unsupported: return "unsupported item"; case .tooLarge: return "item exceeds Apollo’s protected intake limit"; case .failed: return "share intake failed" }
  }
}