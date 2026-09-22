import Foundation
import SystemExtensions

final class RequestDelegate: NSObject, OSSystemExtensionRequestDelegate {
  private var finished = false
  func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .replace }
  func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) { fputs("Apollo Network Extension is waiting for approval in System Settings.\n", stderr) }
  func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) { fputs("configuration_failed: \(error.localizedDescription)\n", stderr); finished = true; CFRunLoopStop(CFRunLoopGetMain()) }
  func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) { print(result == .completed ? "active" : "restart_required"); finished = true; CFRunLoopStop(CFRunLoopGetMain()) }
}

let identifier = "app.apollo.hwg.desktop.networkextension"
let operation = CommandLine.arguments.dropFirst().first ?? "activate"
let request: OSSystemExtensionRequest = operation == "deactivate"
  ? .deactivationRequest(forExtensionWithIdentifier: identifier, queue: .main)
  : .activationRequest(forExtensionWithIdentifier: identifier, queue: .main)
let delegate = RequestDelegate()
request.delegate = delegate
OSSystemExtensionManager.shared.submitRequest(request)
RunLoop.main.run()