import Foundation
import NetworkExtension
import SystemExtensions

private let extensionIdentifier = "app.apollo.hwg.desktop.networkextension"

final class ExtensionController: NSObject, OSSystemExtensionRequestDelegate {
  private let operation: String
  private var finished = false

  init(operation: String) { self.operation = operation }

  func start() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.finish(error: "operation_timed_out") }
    if operation == "status" {
      let manager = NEFilterManager.shared()
      manager.loadFromPreferences { [weak self] error in
        if let error { self?.finish(error: "filter_status_failed: \(error.localizedDescription)") }
        else {
          let configured = (manager.providerConfiguration as? NEFilterProviderConfiguration)?.filterDataProviderBundleIdentifier == extensionIdentifier
          self?.finish(message: manager.isEnabled && configured ? "active" : "inactive")
        }
      }
    } else if operation == "deactivate" {
      configureFilter(enabled: false) { [weak self] error in
        if let error { self?.finish(error: "filter_disable_failed: \(error.localizedDescription)") }
        else { self?.submitSystemExtension(activate: false) }
      }
    } else { submitSystemExtension(activate: true) }
  }

  private func submitSystemExtension(activate: Bool) {
    let request = activate
      ? OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: extensionIdentifier, queue: .main)
      : OSSystemExtensionRequest.deactivationRequest(forExtensionWithIdentifier: extensionIdentifier, queue: .main)
    request.delegate = self
    OSSystemExtensionManager.shared.submitRequest(request)
  }

  private func configureFilter(enabled: Bool, completion: @escaping (Error?) -> Void) {
    let manager = NEFilterManager.shared()
    manager.loadFromPreferences { error in
      if let error { completion(error); return }
      if enabled {
        let provider = NEFilterProviderConfiguration()
        provider.filterDataProviderBundleIdentifier = extensionIdentifier
        provider.filterSockets = true
        provider.filterPackets = false
        manager.providerConfiguration = provider
        manager.localizedDescription = "Apollo Protection"
      }
      manager.isEnabled = enabled
      manager.saveToPreferences(completionHandler: completion)
    }
  }

  private func finish(message: String? = nil, error: String? = nil) {
    guard !finished else { return }
    finished = true
    if let error { fputs("configuration_failed: \(error)\n", stderr) }
    else if let message { print(message) }
    CFRunLoopStop(CFRunLoopGetMain())
  }

  func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .replace }
  func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) { fputs("Apollo Network Extension is waiting for approval in System Settings.\n", stderr) }
  func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) { finish(error: error.localizedDescription) }
  func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
    guard operation != "deactivate" else { finish(message: "inactive"); return }
    guard result == .completed else { finish(message: "restart_required"); return }
    configureFilter(enabled: true) { [weak self] error in
      if let error { self?.finish(error: "filter_enable_failed: \(error.localizedDescription)") }
      else { self?.finish(message: "active") }
    }
  }
}

let operation = CommandLine.arguments.dropFirst().first ?? "activate"
guard ["activate", "deactivate", "status"].contains(operation) else { fatalError("unsupported operation") }
let controller = ExtensionController(operation: operation)
controller.start()
RunLoop.main.run()