import ExpoModulesCore

/// ApolloSecurity — iOS (Swift) security module stub.
/// Phase 2 shell: reports truthful capabilities and status; no protection is
/// claimed. The security developer replaces the stubbed bodies with real
/// NetworkExtension / content-filter integrations. Every method returns JSON
/// matching the TypeScript contract in src/security/SecurityPlatformAdapter.ts.
public class ApolloSecurityModule: Module {
  private var running = false
  private var since: String? = nil
  private var blocked = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("ApolloSecurity")

    AsyncFunction("getCapabilities") { () -> String in
      return self.json([
        ["id": "link_guard", "title": "Link Guard", "status": self.running ? "active" : "available", "detail": "Checks links you paste or share into Apollo."],
        ["id": "known_threats", "title": "Known Threat Lookup", "status": self.running ? "active" : "available", "detail": "Privacy-preserving reputation checks using the link only."],
        ["id": "site_guard", "title": "Site Guard", "status": "coming_later", "detail": "Safari content-blocker integration is not yet implemented."],
        ["id": "connection_guard", "title": "Connection Guard", "status": "coming_later", "detail": "Network Extension integration is not yet implemented."],
        ["id": "share_intake", "title": "Share to Apollo", "status": "coming_later", "detail": "Share Extension is not yet implemented."],
      ])
    }

    AsyncFunction("getProtectionStatus") { () -> String in
      return self.statusJSON()
    }

    AsyncFunction("analyseURL") { (_ url: String) -> String in
      return self.json(["supported": false, "verdict": "unknown", "reasons": ["Native URL analysis not implemented yet."]])
    }

    AsyncFunction("analyseDomain") { (_ domain: String) -> String in
      return self.json(["supported": false, "verdict": "unknown", "reasons": ["Native domain analysis not implemented yet."]])
    }

    AsyncFunction("blockDestination") { (_ host: String) -> String in
      // Fail closed: no verified block until a real filter exists.
      return self.json(["verified": false, "method": "none", "detail": "No content filter is installed; block not verified.", "adapterLabel": "iOS security module", "blockedAt": NSNull()])
    }

    AsyncFunction("unblockDestination") { (_ host: String) -> String in
      self.blocked.remove(host)
      return self.json(["verified": true, "method": "none", "detail": "Nothing was blocked.", "adapterLabel": "iOS security module", "blockedAt": NSNull()])
    }

    AsyncFunction("getNetworkStatus") { () -> String in
      return self.json(["connected": true, "type": "unknown", "isInternetReachable": NSNull(), "inspectable": false, "checkedAt": self.now()])
    }

    AsyncFunction("getSecuritySignals") { () -> String in
      return "[]"
    }

    AsyncFunction("startProtection") { () -> String in
      self.running = true
      self.since = self.now()
      return self.statusJSON()
    }

    AsyncFunction("stopProtection") { () -> String in
      self.running = false
      self.since = nil
      return self.statusJSON()
    }

    AsyncFunction("getProtectionPermissions") { () -> String in
      return self.json([
        ["id": "network_filter", "title": "Content filter", "status": "not_applicable", "canAskAgain": false, "why": "Requires the Network Extension entitlement (not yet implemented)."],
        ["id": "notifications", "title": "Notifications", "status": "undetermined", "canAskAgain": true, "why": "Lets Apollo tell you when it barks."],
      ])
    }

    AsyncFunction("requestProtectionPermission") { (_ id: String) -> String in
      return self.json(["id": id, "title": id, "status": "not_applicable", "canAskAgain": false, "why": "Not implemented in this build."])
    }
  }

  private func statusJSON() -> String {
    return json([
      "running": running,
      "visibility": running ? "limited" : "none",
      "since": since ?? NSNull(),
      "adapterLabel": "iOS security module",
      "checkedAt": now(),
    ])
  }

  private func now() -> String { ISO8601DateFormatter().string(from: Date()) }

  private func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
