import ExpoModulesCore
import Network
import NetworkExtension
import SafariServices

/// ApolloSecurity — iOS (Swift) security module.
/// Site Guard = Safari Content Blocker extension (ApolloContentBlocker). The app
/// writes rules to the shared App Group and asks Safari to reload the blocker.
/// A block is "verified" only when the reload succeeds AND the extension is
/// enabled in Settings › Safari › Extensions. Nothing is inferred.
public class ApolloSecurityModule: Module {
  private var protectionSince: String? = nil
  private let label = "iOS security module"
  private var blockerEnabled: Bool? = nil

  private var appBundleId: String { Bundle.main.bundleIdentifier ?? "" }
  private var blockerId: String { "\(appBundleId).contentblocker" }
  private var appGroup: String { "group.\(appBundleId).apollo" }
  private var listURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("blockerList.json")
  }
  private var blockedKey: String { "apollo.siteguard.blocked" }

  public func definition() -> ModuleDefinition {
    Name("ApolloSecurity")

    AsyncFunction("getCapabilities") { (promise: Promise) in
      self.refreshBlockerState { enabled in
        let running = self.protectionSince != nil
        let site: (String, String) = enabled == true
          ? (running ? "active" : "inactive", running ? "Safari blocks verified threat domains via Apollo's content blocker." : "Turn protection on to activate the Safari content blocker.")
          : ("permission_required", "Enable Apollo in Settings › Safari › Extensions to block threat sites in Safari.")
        promise.resolve(self.json([
          ["id": "link_guard", "title": "Link Guard", "status": running ? "active" : "available", "detail": "Checks links you paste or share into Apollo."],
          ["id": "known_threats", "title": "Known Threat Lookup", "status": running ? "active" : "available", "detail": "Privacy-preserving reputation checks using the link only."],
          ["id": "site_guard", "title": "Site Guard", "status": site.0, "detail": site.1],
          ["id": "connection_guard", "title": "Connection Guard", "status": running ? "active" : "available", "detail": "Limited on iOS: Apple only reveals whether the current Wi‑Fi is open or secured."],
          ["id": "share_intake", "title": "Share to Apollo", "status": "active", "detail": "Share a link from any app to check it."],
        ]))
      }
    }

    AsyncFunction("getProtectionStatus") { () -> String in self.statusJSON() }

    AsyncFunction("analyseURL") { (_ url: String) -> String in
      self.json(["supported": false, "verdict": "unknown", "reasons": ["Native URL analysis not implemented yet."]])
    }
    AsyncFunction("analyseDomain") { (_ domain: String) -> String in
      self.json(["supported": false, "verdict": "unknown", "reasons": ["Native domain analysis not implemented yet."]])
    }

    AsyncFunction("blockDestination") { (host: String, promise: Promise) in
      var hosts = self.blockedHosts(); hosts.insert(host.lowercased())
      self.saveBlockedHosts(hosts)
      guard self.writeRules(hosts) else {
        promise.resolve(self.json(["verified": false, "method": "none", "detail": "Could not write the Safari rule list (App Group unavailable).", "adapterLabel": self.label, "blockedAt": NSNull()]))
        return
      }
      SFContentBlockerManager.reloadContentBlocker(withIdentifier: self.blockerId) { error in
        self.refreshBlockerState { enabled in
          let verified = error == nil && enabled == true
          promise.resolve(self.json([
            "verified": verified,
            "method": verified ? "content_blocker" : "none",
            "detail": verified ? "Safari reloaded Apollo's rules; this domain is now blocked in Safari." : (enabled == true ? "Safari could not reload the rule list." : "Apollo's Safari extension is not enabled, so the block is not verified."),
            "adapterLabel": self.label,
            "blockedAt": verified ? self.now() : NSNull(),
          ]))
        }
      }
    }

    AsyncFunction("unblockDestination") { (host: String, promise: Promise) in
      var hosts = self.blockedHosts(); hosts.remove(host.lowercased())
      self.saveBlockedHosts(hosts); _ = self.writeRules(hosts)
      SFContentBlockerManager.reloadContentBlocker(withIdentifier: self.blockerId) { error in
        promise.resolve(self.json(["verified": error == nil, "method": "content_blocker", "detail": "Rule removed.", "adapterLabel": self.label, "blockedAt": NSNull()]))
      }
    }

    AsyncFunction("getNetworkStatus") { (promise: Promise) in
      // iOS exposes very little: NEHotspotNetwork (needs the Access Wi‑Fi Information entitlement + location
      // permission) reports whether the current Wi‑Fi is secure. Anything Apple hides is reported as "unknown".
      let monitor = NWPathMonitor(); let queue = DispatchQueue(label: "apollo.path")
      monitor.pathUpdateHandler = { path in
        monitor.cancel()
        let type: String = path.status != .satisfied ? "none" : path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "other"
        let vpn = path.availableInterfaces.contains { $0.type == .other && $0.name.hasPrefix("utun") }
        let finish: (String) -> Void = { sec in
          promise.resolve(self.json(["connected": path.status == .satisfied, "type": type, "isInternetReachable": path.status == .satisfied,
                                     "inspectable": self.protectionSince != nil, "wifiSecurity": sec, "captivePortal": NSNull(), "vpnActive": vpn, "checkedAt": self.now()]))
        }
        guard type == "wifi" else { finish("n/a"); return }
        if #available(iOS 14.0, *) {
          NEHotspotNetwork.fetchCurrent { net in
            guard let net = net else { finish("unknown"); return }
            if #available(iOS 15.0, *) {
              switch net.securityType { case .open: finish("open"); case .WEP: finish("wep"); case .personal: finish("wpa"); case .enterprise: finish("enterprise"); default: finish("unknown") }
            } else { finish(net.isSecure ? "wpa" : "open") }
          }
        } else { finish("unknown") }
      }
      monitor.start(queue: queue)
    }

    AsyncFunction("getSecuritySignals") { () -> String in "[]" }

    AsyncFunction("startProtection") { () -> String in
      if self.protectionSince == nil { self.protectionSince = self.now() }
      _ = self.writeRules(self.blockedHosts())
      SFContentBlockerManager.reloadContentBlocker(withIdentifier: self.blockerId, completionHandler: nil)
      return self.statusJSON()
    }
    AsyncFunction("stopProtection") { () -> String in
      self.protectionSince = nil
      return self.statusJSON()
    }

    AsyncFunction("getProtectionPermissions") { (promise: Promise) in
      self.refreshBlockerState { enabled in
        promise.resolve(self.json([
          ["id": "network_filter", "title": "Safari content blocker", "status": enabled == true ? "granted" : "denied", "canAskAgain": true,
           "why": "Enable Apollo under Settings › Safari › Extensions so Safari can block verified threat sites. Safari never shares what you browse with Apollo."],
          ["id": "notifications", "title": "Notifications", "status": "undetermined", "canAskAgain": true, "why": "Lets Apollo tell you when it barks."],
        ]))
      }
    }

    AsyncFunction("requestProtectionPermission") { (id: String, promise: Promise) in
      if id == "network_filter", let url = URL(string: UIApplication.openSettingsURLString) {
        DispatchQueue.main.async { UIApplication.shared.open(url) }
        promise.resolve(self.json(["id": id, "title": "Safari content blocker", "status": "undetermined", "canAskAgain": true, "why": "Opened Settings. Enable Apollo under Safari › Extensions, then return."]))
      } else {
        promise.resolve(self.json(["id": id, "title": id, "status": "undetermined", "canAskAgain": true, "why": "Not implemented in this build."]))
      }
    }
  }

  // MARK: - Helpers

  private func refreshBlockerState(_ done: @escaping (Bool?) -> Void) {
    SFContentBlockerManager.getStateOfContentBlocker(withIdentifier: blockerId) { state, error in
      let enabled: Bool? = error == nil ? state?.isEnabled : nil
      self.blockerEnabled = enabled
      done(enabled)
    }
  }

  private func blockedHosts() -> Set<String> {
    Set(UserDefaults(suiteName: appGroup)?.stringArray(forKey: blockedKey) ?? [])
  }
  private func saveBlockedHosts(_ hosts: Set<String>) {
    UserDefaults(suiteName: appGroup)?.set(Array(hosts).sorted(), forKey: blockedKey)
  }

  /// Writes Safari content-blocker rules: one "block" rule covering every verified host (and subdomains).
  private func writeRules(_ hosts: Set<String>) -> Bool {
    guard let url = listURL else { return false }
    let rules: [[String: Any]] = hosts.isEmpty
      ? [["trigger": ["url-filter": "^https?://apollo\\.invalid/"], "action": ["type": "block"]]]  // Safari requires ≥1 rule
      : [["trigger": ["url-filter": ".*", "if-domain": hosts.sorted().map { "*\($0)" }], "action": ["type": "block"]]]
    guard let data = try? JSONSerialization.data(withJSONObject: rules) else { return false }
    return (try? data.write(to: url, options: .atomic)) != nil
  }

  private func statusJSON() -> String {
    json([
      "running": protectionSince != nil,
      "visibility": protectionSince == nil ? "none" : "limited",
      "since": protectionSince ?? NSNull(),
      "adapterLabel": label,
      "checkedAt": now(),
    ])
  }

  private func now() -> String { ISO8601DateFormatter().string(from: Date()) }
  private func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
