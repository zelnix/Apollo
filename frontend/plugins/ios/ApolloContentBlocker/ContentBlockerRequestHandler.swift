import UIKit
import MobileCoreServices
import UniformTypeIdentifiers

/// ApolloContentBlocker — Safari Content Blocker extension.
/// Safari calls this handler to load the rule list. Rules are written by the
/// main app into the shared App Group container (blockerList.json); if none
/// exists yet we fall back to the bundled (empty) list. Safari never tells the
/// extension which pages were blocked, so no browsing data is observed here.
class ContentBlockerRequestHandler: NSObject, NSExtensionRequestHandling {
  func beginRequest(with context: NSExtensionContext) {
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    // Extension bundle id is "<app>.contentblocker" → app group is "group.<app>.apollo"
    let appBundleId = bundleId.replacingOccurrences(of: ".contentblocker", with: "")
    let group = "group.\(appBundleId).apollo"
    var url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("blockerList.json")
    if url == nil || !FileManager.default.fileExists(atPath: url!.path) {
      url = Bundle.main.url(forResource: "blockerList", withExtension: "json")
    }
    guard let listURL = url, let attachment = NSItemProvider(contentsOf: listURL) else {
      context.cancelRequest(withError: NSError(domain: "ApolloContentBlocker", code: 1))
      return
    }
    let item = NSExtensionItem()
    item.attachments = [attachment]
    context.completeRequest(returningItems: [item], completionHandler: nil)
  }
}
