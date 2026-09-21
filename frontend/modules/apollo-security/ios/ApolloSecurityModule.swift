import CallKit
import ExpoModulesCore
import Network
import NetworkExtension
import SafariServices
import UIKit
import UserNotifications

/// ApolloSecurity — iOS (Swift) security module.
/// Site Guard = Safari Content Blocker extension (ApolloContentBlocker). The app
/// writes rules to the shared App Group and asks Safari to reload the blocker.
/// A block is "verified" only when the reload succeeds AND the extension is
/// enabled in Settings › Safari › Extensions. Nothing is inferred.
public class ApolloSecurityModule: Module {
  private let label = "iOS security module"
  /// Bumped whenever this module's observable behaviour changes. Mirrors ApolloDnsVpnService.MODULE_VERSION on Android.
  private let moduleVersion = "1.0.0"
  /// Last observed extension state + when it was observed. Never assumed; refreshed from SFContentBlockerManager.
  private var blockerEnabled: Bool? = nil
  private var blockerVerifiedAt: String? = nil

  /// Exactly what the Safari content blocker covers. Everything else is NOT covered and the UI says so.
  private let coverage = "Covers websites opened in Safari (and Safari View Controller inside other apps). Not covered: Chrome, Firefox and other browsers, in-app browsers that don't use Safari, and non-browser apps."
  private let coverageScope = ["browser:safari"]

  // Truth model: `requested` is the person's intent, persisted in the App Group so it survives relaunch.
  // `operational` is never stored — it is derived from the extension state each time it is reported.
  private var requestedKey: String { "apollo.siteguard.requested" }
  private var sinceKey: String { "apollo.siteguard.since" }
  private var requested: Bool {
    get { UserDefaults(suiteName: appGroup)?.bool(forKey: requestedKey) ?? false }
    set { UserDefaults(suiteName: appGroup)?.set(newValue, forKey: requestedKey) }
  }
  private var protectionSince: String? {
    get { UserDefaults(suiteName: appGroup)?.string(forKey: sinceKey) }
    set { UserDefaults(suiteName: appGroup)?.set(newValue, forKey: sinceKey) }
  }
  private var rulesWritten: Bool { listURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false }

  private var appBundleId: String { Bundle.main.bundleIdentifier ?? "" }
  private var blockerId: String { "\(appBundleId).contentblocker" }
  private var appGroup: String { "group.\(appBundleId).apollo" }
  private var listURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("blockerList.json")
  }
  private var blockedKey: String { "apollo.siteguard.blocked" }

  // Call Guard — CXCallDirectoryExtension (ApolloCallDirectory), same App Group as Site Guard.
  // The extension only ever gets a STATIC list at reload time (Apple gives it no per-call callback,
  // unlike Android's CallScreeningService) — so `pendingLookups` can never be populated on iOS, and
  // `getEnforcementEvidence` must stay "[]" here too: Apple never reports back which entry, if any,
  // actually caused a block. See ApolloCallDirectory/CallDirectoryHandler.swift for what the
  // extension itself does with this list.
  private var callDirectoryId: String { "\(appBundleId).calldirectory" }
  private var callListURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("callDirectory.json")
  }
  private func loadCallLists() -> [String: [String]] {
    guard let url = callListURL, let data = try? Data(contentsOf: url),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [String]] else {
      return ["block": [], "allow": [], "autoRisky": []]
    }
    return ["block": obj["block"] ?? [], "allow": obj["allow"] ?? [], "autoRisky": obj["autoRisky"] ?? []]
  }
  private func saveCallLists(_ lists: [String: [String]]) -> Bool {
    guard let url = callListURL, let data = try? JSONSerialization.data(withJSONObject: lists) else { return false }
    return (try? data.write(to: url, options: .atomic)) != nil
  }
  private func reloadCallDirectory(_ done: @escaping () -> Void) {
    CXCallDirectoryManager.sharedInstance().reloadExtension(withIdentifier: callDirectoryId) { _ in done() }
  }

  public func definition() -> ModuleDefinition {
    Name("ApolloSecurity")

    AsyncFunction("getCapabilities") { (promise: Promise) in
      self.refreshBlockerState { enabled in
        let running = self.requested
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

    AsyncFunction("getProtectionStatus") { (promise: Promise) in
      self.refreshBlockerState { _ in promise.resolve(self.statusJSON()) }
    }

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
        let finish: (String, String?) -> Void = { sec, ssid in
          promise.resolve(self.json(["connected": path.status == .satisfied, "type": type, "isInternetReachable": path.status == .satisfied,
                                     "inspectable": self.requested, "wifiSecurity": sec, "captivePortal": NSNull(), "vpnActive": vpn, "ssid": ssid ?? NSNull(), "checkedAt": self.now()]))
        }
        guard type == "wifi" else { finish("n/a", nil); return }
        if #available(iOS 14.0, *) {
          NEHotspotNetwork.fetchCurrent { net in
            guard let net = net else { finish("unknown", nil); return }
            if #available(iOS 15.0, *) {
              switch net.securityType { case .open: finish("open", net.ssid); case .WEP: finish("wep", net.ssid); case .personal: finish("wpa", net.ssid); case .enterprise: finish("enterprise", net.ssid); default: finish("unknown", net.ssid) }
            } else { finish(net.isSecure ? "wpa" : "open", net.ssid) }
          }
        } else { finish("unknown", nil) }
      }
      monitor.start(queue: queue)
    }

    AsyncFunction("getSecuritySignals") { () -> String in "[]" }

    // Gate 2 — Text Guard (MessagingSdk contract). Honest today: unlike Android, iOS gives
    // third-party apps NO mechanism to observe Messages notifications at all (there is no
    // NotificationListenerService equivalent on this platform). A real Message Filter Extension
    // (ILMessageFilterExtension) needs its own Xcode extension target + the
    // com.apple.developer.message-filter entitlement — see TextGuardFilterExtension.swift, which is
    // scaffolding for that future native build and is explicitly NOT wired into an active target here.
    AsyncFunction("getMessagingCapabilities") { () -> String in
      self.json(["smsFiltering": "unsupported", "linkInterception": "supported", "senderReputation": "unsupported", "shareExtension": "supported", "notificationIntegration": "unsupported"])
    }
    AsyncFunction("getRecentMessageSecurityEvents") { () -> String in "[]" }
    AsyncFunction("openSmsListenerSettings") { () -> String in self.json(["opened": false]) }

    // Call Guard (CallSdk contract). `callScreening` reflects CXCallDirectoryManager's OWN reported
    // enabled status for ApolloCallDirectory — never assumed. `numberReputation` is always
    // "supported": the lookup is backend-proxied (POST /api/call/risk-check) and works regardless of
    // extension state. `callerIdentification` mirrors the same enabled status — the extension can add
    // identification entries once the person has turned it on in Settings › Phone › Call Blocking &
    // Identification (Apple gives apps no deep link straight to that screen).
    AsyncFunction("getCallProtectionCapabilities") { (promise: Promise) in
      CXCallDirectoryManager.sharedInstance().getEnabledStatusForExtension(withIdentifier: self.callDirectoryId) { status, _ in
        let enabled = status == .enabled
        promise.resolve(self.json([
          "callScreening": enabled ? "supported" : "permission_required",
          "callerIdentification": enabled ? "supported" : "permission_required",
          "numberReputation": "supported",
          "voicemailTranscript": "unsupported",
          "liveTranscript": "unsupported",
        ]))
      }
    }
    AsyncFunction("requestCallScreeningRole") { () -> String in
      // Apple has no API to deep-link directly to Phone › Call Blocking & Identification — only to
      // the app's own Settings page. The in-app copy tells the person exactly where to go from there.
      if let url = URL(string: UIApplication.openSettingsURLString) { DispatchQueue.main.async { UIApplication.shared.open(url) } }
      return self.json(["opened": true])
    }
    // Apple gives CXCallDirectoryProvider no per-call callback — there is no ringing event for iOS to
    // observe and queue, unlike Android's CallScreeningService. Always honestly empty.
    AsyncFunction("getPendingCallLookups") { () -> String in "[]" }
    AsyncFunction("getCallBlockAllowList") { () -> String in self.json(self.loadCallLists()) }
    AsyncFunction("addCallListEntry") { (json: String, promise: Promise) in
      guard let body = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String],
            let number = body["number"], !number.isEmpty else { promise.resolve(self.json(["ok": false])); return }
      let key = body["kind"] == "allow" ? "allow" : "block"
      var lists = self.loadCallLists()
      lists[key] = Array(Set((lists[key] ?? []) + [number]))
      _ = self.saveCallLists(lists)
      self.reloadCallDirectory { promise.resolve(self.json(["ok": true])) }
    }
    AsyncFunction("removeCallListEntry") { (json: String, promise: Promise) in
      guard let body = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String],
            let number = body["number"] else { promise.resolve(self.json(["ok": false])); return }
      let key = body["kind"] == "allow" ? "allow" : "block"
      var lists = self.loadCallLists()
      lists[key] = (lists[key] ?? []).filter { $0 != number }
      _ = self.saveCallLists(lists)
      self.reloadCallDirectory { promise.resolve(self.json(["ok": true])) }
    }
    AsyncFunction("markNumberRisky") { (json: String, promise: Promise) in
      guard let body = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String],
            let number = body["number"], !number.isEmpty else { promise.resolve(self.json(["ok": false])); return }
      var lists = self.loadCallLists()
      lists["autoRisky"] = Array(Set((lists["autoRisky"] ?? []) + [number]))
      _ = self.saveCallLists(lists)
      self.reloadCallDirectory { promise.resolve(self.json(["ok": true])) }
    }

    // Phase A — Apps & Device (AppDeviceSdk contract). iPhone exposes exactly two facts; the rest is honestly null.
    AsyncFunction("getAppDeviceCapabilities") { () -> String in self.json(DeviceSignalsTruth.capabilities()) }
    AsyncFunction("getInstalledAppAssessment") { (_ name: String) -> String in "null" }   // iOS has no app list / permission API
    AsyncFunction("getRecentInstallEvents") { () -> String in "[]" }
    AsyncFunction("getRecentAppSecurityEvents") { () -> String in "[]" }
    AsyncFunction("getDeviceSecuritySignals") { (promise: Promise) in
      let managed = UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed") != nil
      let scoped = ((CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any])?["__SCOPED__"] as? [String: Any])?.keys.map { $0 } ?? []
      let monitor = NWPathMonitor(); let queue = DispatchQueue(label: "apollo.device.path")
      monitor.pathUpdateHandler = { path in
        monitor.cancel()
        let names = path.availableInterfaces.map { $0.name }
        let vpn: Bool? = path.status == .satisfied ? DeviceSignalsTruth.vpnActive(interfaceNames: names, scopedProxyKeys: scoped) : nil
        promise.resolve(self.json(DeviceSignalsTruth.signals(vpnActive: vpn, managedConfigPresent: managed)))
      }
      monitor.start(queue: queue)
    }

    AsyncFunction("startProtection") { (promise: Promise) in
      self.requested = true
      if self.protectionSince == nil { self.protectionSince = self.now() }
      _ = self.writeRules(self.blockedHosts())
      // Report only after Safari has answered: reload result + real extension state.
      SFContentBlockerManager.reloadContentBlocker(withIdentifier: self.blockerId) { _ in
        self.refreshBlockerState { _ in promise.resolve(self.statusJSON()) }
      }
    }
    AsyncFunction("stopProtection") { (promise: Promise) in
      self.requested = false
      self.protectionSince = nil
      // Turning protection off must also stop enforcing: write an empty rule list and reload.
      _ = self.writeRules([])
      SFContentBlockerManager.reloadContentBlocker(withIdentifier: self.blockerId) { _ in
        self.refreshBlockerState { _ in promise.resolve(self.statusJSON()) }
      }
    }

    AsyncFunction("getProtectionPermissions") { (promise: Promise) in
      self.refreshBlockerState { enabled in
        // Notifications: a fresh UNUserNotificationCenter observation, separate from Apollo's recorded request history.
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          let observedAt = self.now()
          let notifState: String
          switch settings.authorizationStatus {
          case .authorized, .provisional, .ephemeral: notifState = "granted"
          case .denied: notifState = "denied"
          default: notifState = "undetermined"
          }
          promise.resolve(self.json([
            self.perm("network_filter", "Safari content blocker", enabled == true ? "granted" : (enabled == false ? "denied" : "undetermined"), true,
                      "Enable Apollo under Settings › Safari › Extensions so Safari can block verified threat sites. Safari never shares what you browse with Apollo.", observedAt, enabled: enabled),
            self.perm("notifications", "Notifications", notifState, notifState != "denied", "Lets Apollo tell you when it barks.", observedAt, enabled: notifState == "granted"),
            self.perm("vpn_config", "Local VPN", "not_applicable", false, "Apollo on iOS uses a Safari content blocker, not a VPN.", observedAt, enabled: nil, unavailableReason: "not_implemented"),
            self.perm("accessibility", "Accessibility service", "not_applicable", false, "iOS exposes no accessibility-service permission to apps.", observedAt, enabled: nil, unavailableReason: "os_restricted"),
          ]))
        }
      }
    }

    AsyncFunction("requestProtectionPermission") { (id: String, promise: Promise) in
      self.recordRequest(id)
      let observedAt = self.now()
      if id == "network_filter", let url = URL(string: UIApplication.openSettingsURLString) {
        DispatchQueue.main.async { UIApplication.shared.open(url) }
        promise.resolve(self.json(self.perm(id, "Safari content blocker", "undetermined", true, "Opened Settings. Enable Apollo under Safari › Extensions, then return.", observedAt, enabled: nil)))
      } else if id == "notifications" {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
          promise.resolve(self.json(self.perm(id, "Notifications", granted ? "granted" : "denied", false, granted ? "Granted." : "Declined in the system prompt. It can be changed under Settings › Apollo › Notifications.", self.now(), enabled: granted)))
        }
      } else {
        promise.resolve(self.json(self.perm(id, id, "not_applicable", false, "Apollo does not request this permission on iOS.", observedAt, enabled: nil, unavailableReason: "not_implemented")))
      }
    }

    // Real device facts for investigation guidance. Form factor comes from the interface idiom, never from screen width.
    AsyncFunction("getDeviceProfileFacts") { () -> String in
      let idiom = UIDevice.current.userInterfaceIdiom
      let formFactor = idiom == .pad ? "tablet" : idiom == .phone ? "phone" : idiom == .mac ? "desktop" : "unknown"
      var systemInfo = utsname(); uname(&systemInfo)
      let machine = withUnsafePointer(to: &systemInfo.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(validatingUTF8: $0) } } ?? UIDevice.current.model
      return self.json(["manufacturer": "Apple", "model": machine, "osVersion": self.platformVersion(), "formFactor": formFactor, "locale": Locale.current.identifier])
    }

    // Cross-Platform Architecture Directive: describes what THIS deployed mechanism — a Safari
    // Content Blocker (declarative WebKit rule matching) — actually does, never the theoretical
    // NEFilterDataProvider ceiling recorded as PLATFORM_CAPABILITY_BASELINES.ios in
    // PlatformCapabilityProfile.ts. Mirrors ApolloSecurityModule.kt's getPlatformCapabilityProfile
    // shape exactly; keep both in sync with PlatformCapabilityProfile.ts.
    AsyncFunction("getPlatformCapabilityProfile") { () -> String in
      self.json([
        "platform": "ios",
        "platformVersion": self.platformVersion(),
        "sdkVersion": self.moduleVersion,
        "capabilityVersion": "1", // keep in sync with CAPABILITY_PROFILE_VERSION in PlatformCapabilityProfile.ts
        // The content blocker filters URL loads inside Safari via a declarative rule list —
        // real, but scoped to one browser and pattern-based, not a network/VPN interception.
        "networkFiltering": "partial",
        // WebKit evaluates rules internally; the extension never sees a packet or a flow.
        "packetVisibility": "none",
        // No DNS-level visibility at all — matching is on URL patterns, not resolved queries.
        "dnsVisibility": "none",
        // Safari content blockers have no process concept.
        "processAttribution": "none",
        // Scoped to Safari only; there is no cross-app attribution to claim.
        "appAttribution": "none",
        // WebKit does not report back which domains matched a rule — no observation, only a
        // static block outcome. Reporting "none" here (not "partial") keeps this consistent
        // with getEnforcementEvidence() always returning [] below.
        "domainVisibility": "none",
        // Real: a matching rule genuinely stops the load, but only inside Safari.
        "localBlocking": "partial",
        // The compiled rule list runs inside Safari's own extension process, independent of
        // Apollo's app lifecycle — but only while the person is using Safari.
        "backgroundProtection": "partial",
        // The rule list is written to disk ahead of time; enforcing it needs no connectivity.
        "offlineProtection": "full",
        // Apple gives third-party apps zero feedback about content-blocker rule hits.
        "realTimeEvents": "none",
        "scope": self.coverageScope, // ["browser:safari"] — never claim broader reach than this
      ])
    }

    // Safari gives Apollo no per-hit evidence for content-blocker matches (see comment above on
    // domainVisibility/realTimeEvents), and CXCallDirectoryProvider gives no per-call feedback either
    // (see the Call Guard block above) — so unlike Android's DNS tunnel + CallScreeningService, there
    // is nothing to list here, ever. Must stay [] until iOS moves to mechanisms that report individual
    // verified actions. A manual "Block" tap must never appear here either — see blockDestination()
    // above, whose `verified` flag already reflects the same "no observed drop" truth for the app's own UI.
    AsyncFunction("getEnforcementEvidence") { () -> String in "[]" }
  }

  // MARK: - Helpers

  private func refreshBlockerState(_ done: @escaping (Bool?) -> Void) {
    SFContentBlockerManager.getStateOfContentBlocker(withIdentifier: blockerId) { state, error in
      let enabled: Bool? = error == nil ? state?.isEnabled : nil
      self.blockerEnabled = enabled
      if enabled != nil { self.blockerVerifiedAt = self.now() }
      done(enabled)
    }
  }

  private func blockedHosts() -> Set<String> {
    Set(UserDefaults(suiteName: appGroup)?.stringArray(forKey: blockedKey) ?? [])
  }
  private func saveBlockedHosts(_ hosts: Set<String>) {
    UserDefaults(suiteName: appGroup)?.set(Array(hosts).sorted(), forKey: blockedKey)
  }

  /// Writes the Safari rule list built by SiteGuardTruth.rules (pure, unit-tested).
  private func writeRules(_ hosts: Set<String>) -> Bool {
    guard let url = listURL, let data = try? JSONSerialization.data(withJSONObject: SiteGuardTruth.rules(for: hosts)) else { return false }
    return (try? data.write(to: url, options: .atomic)) != nil
  }

  /// requested = intent · operational = extension enabled (observed) AND rules written · degradedReason = the gap.
  /// Derivation lives in SiteGuardTruth so it is unit-tested; this only reads observed inputs and formats.
  private func statusJSON() -> String {
    let wants = requested
    let d = SiteGuardTruth.derive(requested: wants, blockerEnabled: blockerEnabled, rulesWritten: rulesWritten)
    return json([
      "running": d.operational,
      "requested": wants,
      "operational": d.operational,
      "enforcementMethod": d.enforcementMethod,
      "coverage": d.operational ? coverage : "Nothing is being blocked in Safari right now. Link checks you run in Apollo still work.",
      "coverageScope": d.operational ? coverageScope : [],
      "lastVerified": blockerVerifiedAt ?? NSNull(),
      "degradedReason": d.degradedReason ?? NSNull(),
      "visibility": wants ? "limited" : "none",
      "since": wants ? (protectionSince ?? NSNull()) : NSNull(),
      "adapterLabel": label,
      "checkedAt": now(),
    ])
  }

  private func now() -> String { ISO8601DateFormatter().string(from: Date()) }
  private func platformVersion() -> String { "iOS \(UIDevice.current.systemVersion)" }
  /// `requested`/`lastRequestedAt` = Apollo's recorded request history; `status`/`enabled` = fresh OS observation.
  private func perm(_ id: String, _ title: String, _ status: String, _ canAskAgain: Bool, _ why: String, _ observedAt: String, enabled: Bool?, unavailableReason: String? = nil) -> [String: Any] {
    let requestedAt = UserDefaults.standard.string(forKey: "apollo.perm_requested_at.\(id)")
    return ["id": id, "title": title, "status": status, "canAskAgain": canAskAgain, "why": why,
            "requested": requestedAt != nil, "lastRequestedAt": requestedAt ?? NSNull(), "enabled": enabled ?? NSNull(),
            "observedAt": observedAt, "unavailableReason": unavailableReason ?? NSNull()]
  }
  private func recordRequest(_ id: String) { UserDefaults.standard.set(now(), forKey: "apollo.perm_requested_at.\(id)") }
  private func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
