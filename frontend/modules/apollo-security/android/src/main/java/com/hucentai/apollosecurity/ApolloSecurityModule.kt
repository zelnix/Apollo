package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.provider.Settings
import com.guarddog.core.protection.ProtectionState
import com.guarddog.vpn.GuardDogVpnService
import com.guarddog.vpn.RecoveryInspector
import com.guarddog.vpn.VpnStateRepository
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * ApolloSecurity — Android (Kotlin) security module.
 * Site Guard is a real DNS filter (ApolloDnsVpnService). Every status reported
 * here is derived from actual system state; nothing is assumed.
 */
class ApolloSecurityModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("No context")
  private val label = "Android security module"

  // Truth model. `requested` is the person's intent and survives process recreation (SharedPreferences).
  // `operational` is NEVER stored: it is read from ApolloDnsVpnService.isRunning every time it is reported.
  private val prefs get() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private var requested: Boolean
    get() = prefs.getBoolean(KEY_REQUESTED, false)
    set(v) { prefs.edit().putBoolean(KEY_REQUESTED, v).apply() }
  private var protectionSince: String?
    get() = prefs.getString(KEY_SINCE, null)
    set(v) { prefs.edit().putString(KEY_SINCE, v).apply() }
  private fun guardDogCandidate(): ApolloGuardDogCandidateRuntime = ApolloGuardDogProcessOwner.get(ctx)
  private fun guardDogProduction(): ApolloGuardDogProductionRuntime = ApolloGuardDogProductionOwner.get(ctx)

  companion object {
    private const val PREFS = "apollo_siteguard"
    private const val KEY_REQUESTED = "protection_requested"
    private const val KEY_SINCE = "protection_since"
    /** Exactly what the DNS filter sees (single source of truth: SiteGuardTruth.COVERAGE). */
    const val COVERAGE = SiteGuardTruth.COVERAGE
    val COVERAGE_SCOPE = SiteGuardTruth.COVERAGE_SCOPE
  }

  override fun definition() = ModuleDefinition {
    Name("ApolloSecurity")

    // Stage 1D acceptance candidate. These functions are deliberately separate from production
    // Site Guard; JS can only select them in the explicit non-production candidate profile.
    Function("getGuardDogCandidateCapabilities") { guardDogCandidate().capabilities() }
    Function("getGuardDogCandidateStatus") { guardDogCandidate().status() }
    Function("configureGuardDogCandidate") { json: String -> guardDogCandidate().configure(json) }
    Function("acceptGuardDogCandidateBundle") { json: String -> guardDogCandidate().acceptBundle(json) }
    AsyncFunction("startGuardDogCandidate") { guardDogCandidate().start() }
    AsyncFunction("stopGuardDogCandidate") { guardDogCandidate().stop() }
    Function("analyzeGuardDogCandidateUrl") { url: String -> guardDogCandidate().analyzeUrl(url) }
    Function("getGuardDogCandidateEvidence") { guardDogCandidate().evidence() }
    Function("acknowledgeGuardDogCandidateEvidence") { ids: String -> guardDogCandidate().acknowledgeEvidence(ids) }
    Function("getGuardDogCandidateRecovery") { guardDogCandidate().recovery() }
    AsyncFunction("probeGuardDogCandidateFresh") { timeoutMs: Int -> guardDogCandidate().freshProbe(timeoutMs) }
    AsyncFunction("getGuardDogCandidateProvenance") { guardDogCandidate().provenance() }
    AsyncFunction("runGuardDogCandidateAcceptance") { timeoutMs: Int -> guardDogCandidate().runConsolidatedAcceptance(timeoutMs) }
    Function("getGuardDogProductionCapabilities") { guardDogProduction().capabilities() }
    Function("getGuardDogProductionStatus") { guardDogProduction().status() }
    Function("configureGuardDogProduction") { json: String -> guardDogProduction().configure(json) }
    Function("installGuardDogProductionTrustManifest") { json: String -> guardDogProduction().installTrustManifest(json) }
    Function("acceptGuardDogProductionRuleBundle") { json: String -> guardDogProduction().acceptBundle(json) }
    AsyncFunction("refreshGuardDogProductionAuthority") { guardDogProduction().refreshAuthority() }
    AsyncFunction("startGuardDogProduction") { guardDogProduction().start() }
    AsyncFunction("stopGuardDogProduction") { guardDogProduction().stop() }
    Function("analyzeGuardDogProductionUrl") { url: String -> guardDogProduction().analyzeUrl(url) }
    Function("getGuardDogProductionEvidence") { guardDogProduction().evidence() }
    Function("acknowledgeGuardDogProductionEvidence") { ids: String -> guardDogProduction().acknowledgeEvidence(ids) }
    Function("getGuardDogProductionRecovery") { guardDogProduction().recovery() }

    AsyncFunction("getCapabilities") {
      val vpnGranted = VpnService.prepare(ctx) == null
      val running = ApolloDnsVpnService.isRunning
      JSONArray().apply {
        put(cap("link_guard", "Link Guard", if (requested) "active" else "available", "Checks links you paste or share into Apollo."))
        put(cap("known_threats", "Known Threat Lookup", if (requested) "active" else "available", "Privacy-preserving reputation checks using the link only."))
        put(cap("site_guard", "Site Guard",
          when { running -> "active"; vpnGranted -> "inactive"; else -> "permission_required" },
          when { running -> "Blocking verified threat domains with an on-device DNS filter."; vpnGranted -> "Turn protection on to start the DNS filter."; else -> "Needs the local VPN permission to filter DNS lookups on this device." }))
        put(cap("connection_guard", "Connection Guard", if (requested) "active" else "available", "Warns about open, WEP or captive-portal Wi‑Fi using Android's own network report."))
        put(cap("share_intake", "Share to Apollo", "active", "Share a link from any app to check it."))
      }.toString()
    }

    AsyncFunction("getProtectionStatus") { statusJson() }

    AsyncFunction("analyseURL") { _: String ->
      JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("Native URL analysis not implemented yet.")).toString()
    }
    AsyncFunction("analyseDomain") { _: String ->
      JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("Native domain analysis not implemented yet.")).toString()
    }

    AsyncFunction("blockDestination") { host: String ->
      ApolloDnsVpnService.addBlocked(ctx, host)
      val verified = SiteGuardTruth.verifiedBlock(ApolloDnsVpnService.isRunning, host, ApolloDnsVpnService.loadBlocked(ctx))
      // "verified" here means the filter is live and this host is now enforced going forward — it is
      // NOT a claim that a packet was ever dropped. The attached evidence says so explicitly
      // (result="unverified") so it can never pass isVerifiedEnforcement / _derive_verified_block.
      // Only ApolloDnsVpnService.handlePacket() observing and dropping a real query may do that.
      val evidence = if (verified) EnforcementEvidence.ruleActivated(
        evidenceId = UUID.randomUUID().toString(), observedAt = now(), domain = host,
        osVersion = platformVersion(), sdkVersion = ApolloDnsVpnService.MODULE_VERSION,
      ) else null
      JSONObject()
        .put("verified", verified)
        .put("method", if (verified) "dns_filter" else "none")
        .put("detail", if (verified) "DNS lookups for this domain now return NXDOMAIN on this device." else "Domain saved, but the DNS filter is not running so the block is not verified.")
        .put("adapterLabel", label).put("blockedAt", if (verified) now() else JSONObject.NULL)
        .put("evidence", if (evidence != null) evidenceJson(evidence) else JSONObject.NULL)
        .toString()
    }

    AsyncFunction("unblockDestination") { host: String ->
      ApolloDnsVpnService.removeBlocked(ctx, host)
      JSONObject().put("verified", true).put("method", "dns_filter").put("detail", "Domain removed from the DNS filter.")
        .put("adapterLabel", label).put("blockedAt", JSONObject.NULL).toString()
    }

    AsyncFunction("getNetworkStatus") {
      val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val caps = cm.getNetworkCapabilities(cm.activeNetwork)
      val type = when {
        caps == null -> "none"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
      }
      // Connection Guard: Wi‑Fi security type (API 31+) and captive-portal flag come straight from the platform.
      var wifiSecurity = if (type == "wifi") "unknown" else "n/a"
      if (type == "wifi" && android.os.Build.VERSION.SDK_INT >= 31) {
        val info = caps?.transportInfo as? android.net.wifi.WifiInfo
        wifiSecurity = when (info?.currentSecurityType) {
          android.net.wifi.WifiInfo.SECURITY_TYPE_OPEN, android.net.wifi.WifiInfo.SECURITY_TYPE_OWE -> "open"
          android.net.wifi.WifiInfo.SECURITY_TYPE_WEP -> "wep"
          android.net.wifi.WifiInfo.SECURITY_TYPE_PSK -> "wpa"
          android.net.wifi.WifiInfo.SECURITY_TYPE_SAE -> "wpa3"
          android.net.wifi.WifiInfo.SECURITY_TYPE_EAP, android.net.wifi.WifiInfo.SECURITY_TYPE_EAP_WPA3_ENTERPRISE -> "enterprise"
          null -> "unknown"
          else -> "unknown"
        }
      }
      val captive = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL)
      // SSID needs ACCESS_FINE_LOCATION at runtime; Android returns "<unknown ssid>" otherwise.
      val rawSsid = if (type == "wifi" && android.os.Build.VERSION.SDK_INT >= 31) (caps?.transportInfo as? android.net.wifi.WifiInfo)?.ssid else null
      val ssid = rawSsid?.trim('"')?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
      JSONObject().put("connected", caps != null).put("type", type)
        .put("isInternetReachable", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: JSONObject.NULL)
        .put("inspectable", requested).put("wifiSecurity", wifiSecurity)
        .put("captivePortal", captive ?: JSONObject.NULL).put("vpnActive", type == "vpn").put("ssid", ssid ?: JSONObject.NULL).put("checkedAt", now()).toString()
    }

    AsyncFunction("getSecuritySignals") {
      val arr = JSONArray()
      if (ApolloDnsVpnService.lastBlockedAt > 0) {
        arr.put(JSONObject().put("code", "dns_block").put("severity", "info")
          .put("plain", "Site Guard blocked ${ApolloDnsVpnService.blockedCount} lookup(s) for verified threat domains.")
          .put("occurredAt", Instant.ofEpochMilli(ApolloDnsVpnService.lastBlockedAt).toString()))
      }
      arr.toString()
    }

    AsyncFunction("startProtection") {
      ApolloEnforcementTransitions.coordinator.serialized {
        check(ApolloGuardDogEngineOwnership.current() == null) { "GuardDog owns the enforcement transition" }
        val oldGuardDog = RecoveryInspector.inspect(ctx, VpnStateRepository.shared)
        if (!oldGuardDog.recovered) {
          ctx.startService(Intent(ctx, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
          check(ApolloEnforcementTransitions.coordinator.await(8_000) { RecoveryInspector.inspect(ctx, VpnStateRepository.shared).recovered }) { "GuardDog did not release its selective route" }
        }
        requested = true
        if (protectionSince == null) protectionSince = now()
        if (VpnService.prepare(ctx) == null) {
          ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_START))
          check(ApolloEnforcementTransitions.coordinator.await(4_000) { ApolloDnsVpnService.isRunning }) { "Legacy Site Guard start timed out" }
        }
        statusJson()
      }
    }

    AsyncFunction("stopProtection") {
      ApolloEnforcementTransitions.coordinator.serialized {
        requested = false; protectionSince = null
        ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_STOP))
        check(ApolloEnforcementTransitions.coordinator.await(4_000) { !ApolloDnsVpnService.isRunning }) { "Legacy Site Guard stop timed out" }
        statusJson()
      }
    }

    AsyncFunction("getProtectionPermissions") {
      val observedAt = now()
      val vpn = if (VpnService.prepare(ctx) == null) "granted" else "undetermined"
      // Notifications: a fresh OS observation. `enabled` mirrors NotificationManager.areNotificationsEnabled(); on API 33+
      // the runtime POST_NOTIFICATIONS grant is checked as well. Apollo's own request history is a separate fact.
      val notificationsEnabled = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
      val postGranted = if (android.os.Build.VERSION.SDK_INT >= 33)
        ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED else true
      val notificationsState = when {
        notificationsEnabled && postGranted -> "granted"
        requestedAt("notifications") != null -> "denied"
        else -> "undetermined"
      }
      val listener = ApolloSmsListenerService.isEnabled(ctx)
      JSONArray().apply {
        put(perm("vpn_config", "Local VPN (DNS filter)", vpn, true, "Lets Apollo filter DNS lookups on this device so verified threat domains cannot load. Only DNS passes through; no browsing data is collected.", observedAt, enabled = vpn == "granted"))
        put(perm("notifications", "Notifications", notificationsState, notificationsState != "denied" || android.os.Build.VERSION.SDK_INT < 33, "Lets Apollo tell you when it barks.", observedAt, enabled = notificationsEnabled && postGranted))
        put(perm("network_filter", "Notification access (Text Gate)", if (listener) "granted" else "undetermined", true, "Lets Apollo read message notifications you allow so Text Gate can warn you. Apollo never reads SMS directly.", observedAt, enabled = listener))
        put(perm("accessibility", "Accessibility service", "not_applicable", false, "Apollo does not use an accessibility service.", observedAt, enabled = null, unavailableReason = "not_implemented"))
      }.toString()
    }

    AsyncFunction("requestProtectionPermission") { id: String ->
      recordRequest(id)
      val observedAt = now()
      when (id) {
        "vpn_config" -> {
          val intent = VpnService.prepare(ctx)
          if (intent == null) perm("vpn_config", "Local VPN (DNS filter)", "granted", true, "Granted.", observedAt, enabled = true).put("requestState", "already_granted").toString()
          else {
            try {
              intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
              perm("vpn_config", "Local VPN (DNS filter)", "undetermined", true, "System VPN consent opened. Apollo will check the result when you return.", observedAt, enabled = false).put("requestState", "system_ui_opened").toString()
            } catch (_: Exception) {
              perm("vpn_config", "Local VPN (DNS filter)", "undetermined", true, "Android could not open VPN consent.", observedAt, enabled = false).put("requestState", "launch_failed").toString()
            }
          }
        }
        "notifications" -> {
          // Notification consent is granted in the system UI. Apollo opens its own notification settings page so the person
          // decides there; the fresh state is read on return (getProtectionPermissions), never assumed.
          val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          try {
            appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
            perm("notifications", "Notifications", "undetermined", true, "Notification settings opened. Apollo will check when you return.", observedAt, enabled = null).put("requestState", "system_ui_opened").toString()
          } catch (_: Exception) {
            perm("notifications", "Notifications", "undetermined", true, "Android could not open notification settings.", observedAt, enabled = null).put("requestState", "launch_failed").toString()
          }
        }
        "network_filter" -> {
          val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          try {
            appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
            perm("network_filter", "Notification access (Text Gate)", "undetermined", true, "Notification access settings opened. Apollo will check when you return.", observedAt, enabled = null).put("requestState", "system_ui_opened").toString()
          } catch (_: Exception) {
            perm("network_filter", "Notification access (Text Gate)", "undetermined", true, "Android could not open notification access settings.", observedAt, enabled = null).put("requestState", "launch_failed").toString()
          }
        }
        else -> perm(id, id, "not_applicable", false, "Apollo does not request this permission on Android.", observedAt, enabled = null, unavailableReason = "not_implemented").put("requestState", "unsupported").toString()
      }
    }

    // Real device facts for investigation guidance (manufacturer/model/OS/form factor). No inference from screen width.
    AsyncFunction("getDeviceProfileFacts") {
      val cfg = ctx.resources.configuration
      val pm = ctx.packageManager
      val formFactor = when {
        pm.hasSystemFeature("android.hardware.type.pc") -> "desktop"
        pm.hasSystemFeature("android.software.leanback") -> "unknown"
        cfg.smallestScreenWidthDp >= 600 -> "tablet"
        else -> "phone"
      }
      JSONObject()
        .put("manufacturer", android.os.Build.MANUFACTURER)
        .put("model", android.os.Build.MODEL)
        .put("osVersion", platformVersion())
        .put("formFactor", formFactor)
        .put("locale", java.util.Locale.getDefault().toLanguageTag())
        .toString()
    }

    // Phase A — Apps & Device (AppDeviceSdk contract). Real signals within package-visibility limits; see AppDeviceSignals.
    AsyncFunction("getAppDeviceCapabilities") { AppDeviceSignals(ctx).capabilitiesJson() }
    AsyncFunction("getInstalledAppAssessment") { nameOrPackage: String -> AppDeviceSignals(ctx).appAssessmentJson(nameOrPackage) }
    AsyncFunction("getRecentInstallEvents") { "[]" }        // no PACKAGE_ADDED receiver by design (would need broad visibility)
    AsyncFunction("getDeviceSecuritySignals") { AppDeviceSignals(ctx).deviceSignalsJson() }
    AsyncFunction("getRecentAppSecurityEvents") { "[]" }

    // Gate 2 — Text Guard (MessagingSdk contract). The ONLY mechanism used is opt-in
    // NotificationListenerService access (ApolloSmsListenerService) — no READ_SMS, ever, and no
    // default-SMS-app role. `smsFiltering`/`notificationIntegration` mirror the real, live-read
    // Settings.Secure listener grant; `senderReputation` stays honestly unsupported (no number
    // reputation source is wired). Link checks and Share-to-Apollo already work regardless.
    AsyncFunction("getMessagingCapabilities") {
      val enabled = ApolloSmsListenerService.isEnabled(ctx)
      JSONObject()
        .put("smsFiltering", if (enabled) "supported" else "permission_required")
        .put("linkInterception", "supported")
        .put("senderReputation", "unsupported")
        .put("shareExtension", "supported")
        .put("notificationIntegration", if (enabled) "supported" else "permission_required")
        .toString()
    }
    // Protected inbox semantics: reading is non-destructive; acknowledge only exact IDs after durable submission.
    AsyncFunction("getRecentMessageSecurityEvents") { ApolloSmsListenerService.readQueue(ctx).toString() }
    AsyncFunction("acknowledgeMessageSecurityEvents") { idsJson: String ->
      val ids = JSONArray(idsJson); val values = mutableSetOf<String>()
      for (index in 0 until ids.length()) values.add(ids.optString(index))
      JSONObject().put("acknowledged", ApolloSmsListenerService.acknowledge(ctx, values)).toString()
    }
    AsyncFunction("configureTextBackgroundHandoff") { configJson: String ->
      val config = JSONObject(configJson)
      JSONObject().put("configured", ApolloSmsListenerService.configureHandoff(ctx, config.getString("backendUrl"), config.getString("deviceToken"))).toString()
    }
    AsyncFunction("openSmsListenerSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
      JSONObject().put("opened", true).toString()
    }

    // Call Guard (CallSdk contract). Real Android signal: RoleManager.ROLE_CALL_SCREENING held by
    // ApolloCallScreeningService — never a live call is read here, only role/list state.
    // `numberReputation` is always "supported": the actual lookup is backend-proxied
    // (POST /api/call/risk-check via services/phonerisk.py) and works regardless of native readiness;
    // /call/risk-check itself reports source="not_configured" honestly if no IPQS key is set.
    AsyncFunction("getCallProtectionCapabilities") {
      val held = ApolloCallScreeningService.isRoleHeld(ctx)
      JSONObject()
        .put("callScreening", if (held) "supported" else "permission_required")
        .put("callerIdentification", "unsupported")
        .put("numberReputation", "supported")
        .put("voicemailTranscript", "unsupported")
        .put("liveTranscript", "unsupported")
        .toString()
    }
    AsyncFunction("requestCallScreeningRole") {
      val rm = ctx.getSystemService(Context.ROLE_SERVICE) as? android.app.role.RoleManager
      val opened = if (rm != null && ApolloCallScreeningService.isRoleAvailable(ctx) && !ApolloCallScreeningService.isRoleHeld(ctx)) {
        val intent = rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_CALL_SCREENING).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
        true
      } else false
      JSONObject().put("opened", opened).toString()
    }
    // Mailbox semantics, same pattern as Text Guard's queue — draining clears it.
    AsyncFunction("getPendingCallLookups") { ApolloCallScreeningService.drainPendingLookups(ctx).toString() }
    AsyncFunction("getCallBlockAllowList") { ApolloCallScreeningService.blockAllowJson(ctx).toString() }
    AsyncFunction("addCallListEntry") { json: String ->
      val body = JSONObject(json)
      val key = if (body.optString("kind") == "allow") "allow_numbers" else "block_numbers"
      ApolloCallScreeningService.addToSet(ctx, key, body.optString("number"))
      JSONObject().put("ok", true).toString()
    }
    AsyncFunction("removeCallListEntry") { json: String ->
      val body = JSONObject(json)
      val key = if (body.optString("kind") == "allow") "allow_numbers" else "block_numbers"
      ApolloCallScreeningService.removeFromSet(ctx, key, body.optString("number"))
      JSONObject().put("ok", true).toString()
    }
    AsyncFunction("markNumberRisky") { json: String ->
      ApolloCallScreeningService.markRisky(ctx, JSONObject(json).optString("number"))
      JSONObject().put("ok", true).toString()
    }

    // Cross-Platform Architecture Directive (src/security/PlatformCapabilityProfile.ts). Capability is the
    // DEPLOYED reality of THIS build, not the theoretical Android ceiling — Site Guard here is DNS-only by
    // design (see ApolloDnsVpnService header), so it is honestly narrower than a full packet-filtering VPN.
    AsyncFunction("getPlatformCapabilityProfile") {
      JSONObject()
        .put("platform", "android")
        .put("platformVersion", platformVersion())
        .put("sdkVersion", ApolloDnsVpnService.MODULE_VERSION)
        .put("capabilityVersion", "1") // keep in sync with CAPABILITY_PROFILE_VERSION in PlatformCapabilityProfile.ts
        .put("networkFiltering", "partial")   // DNS-only tunnel, not a general packet filter
        .put("packetVisibility", "partial")   // only IPv4/UDP/port-53 packets are inspected
        .put("dnsVisibility", "full")         // every PLAINTEXT UDP/53 system-resolver query is seen — Android
        // Private DNS (DoT) and app-level DoH bypass this tunnel entirely (see ApolloDnsVpnService header);
        // this is a known platform-behaviour limit, captured here rather than hidden by overclaiming.
        .put("processAttribution", "none")    // no UID/PID mapping implemented in this module
        .put("appAttribution", "none")
        .put("domainVisibility", "full")
        .put("localBlocking", "full")         // NXDOMAIN genuinely blocks, on this device, right now
        .put("backgroundProtection", "full")  // foreground VpnService, START_STICKY
        .put("offlineProtection", "full")     // the blocklist check needs no network at all
        .put("realTimeEvents", "partial")     // evidence is ready instantly, but the JS side must poll for it
        // Ceiling scope for a general VpnService is packet:all/dns:all (see PLATFORM_CAPABILITY_BASELINES.android
        // in PlatformCapabilityProfile.ts) — but THIS deployed module only tunnels DNS (UDP/53), so it must
        // self-report the narrower real scope, not the ceiling.
        .put("scope", JSONArray(listOf("dns:udp-53")))
        .toString()
    }

    // Recent real enforcement actions (EnforcementEvidence.kt). Only entries handlePacket() actually wrote
    // an NXDOMAIN reply for — never a rule match, never an intent, never anything simulated.
    AsyncFunction("getEnforcementEvidence") {
      val arr = JSONArray()
      ApolloDnsVpnService.recentEvidence().forEach { arr.put(evidenceJson(it)) }
      ApolloCallScreeningService.recentEvidence().forEach { arr.put(evidenceJson(it)) }
      arr.toString()
    }
  }

  private fun platformVersion(): String = "Android ${android.os.Build.VERSION.RELEASE}"

  private fun evidenceJson(ev: EnforcementEvidence): JSONObject = JSONObject()
    .put("evidenceId", ev.evidenceId)
    .put("eventId", ev.eventId ?: JSONObject.NULL)
    .put("deviceId", ev.deviceId ?: JSONObject.NULL)
    .put("platform", ev.platform)
    .put("osVersion", ev.osVersion ?: JSONObject.NULL)
    .put("sdkVersion", ev.sdkVersion ?: JSONObject.NULL)
    .put("observedAt", ev.observedAt)
    .put("mechanism", ev.mechanism)
    .put("direction", ev.direction)
    .put("protocol", ev.protocol)
    .put("destination", JSONObject().put("ip", ev.destinationIp ?: JSONObject.NULL).put("domain", ev.destinationDomain ?: JSONObject.NULL).put("port", ev.destinationPort ?: JSONObject.NULL))
    .put("attribution", JSONObject().put("appId", ev.appId ?: JSONObject.NULL).put("processName", ev.processName ?: JSONObject.NULL).put("confidence", ev.attributionConfidence))
    .put("matchedRuleId", ev.matchedRuleId ?: JSONObject.NULL)
    .put("threatId", ev.threatId ?: JSONObject.NULL)
    .put("requestedAction", ev.requestedAction)
    .put("enforcedAction", ev.enforcedAction)
    .put("result", ev.result)
    .put("ruleSource", ev.ruleSource)
    .put("confidence", ev.confidence)
    .put("sourceMetadata", JSONObject())
    .put("correlationId", ev.correlationId ?: JSONObject.NULL)

  private fun cap(id: String, title: String, status: String, detail: String) =
    JSONObject().put("id", id).put("title", title).put("status", status).put("detail", detail)
  private fun perm(id: String, title: String, status: String, canAskAgain: Boolean, why: String, observedAt: String = now(), enabled: Boolean? = null, unavailableReason: String? = null): JSONObject {
    // `requested`/`lastRequestedAt` = Apollo's own recorded request history (SharedPreferences); `status`/`enabled` = fresh OS observation.
    val requestedAt = requestedAt(id)
    return JSONObject().put("id", id).put("title", title).put("status", status).put("canAskAgain", canAskAgain).put("why", why)
      .put("requested", requestedAt != null).put("lastRequestedAt", requestedAt ?: JSONObject.NULL)
      .put("enabled", enabled ?: JSONObject.NULL).put("observedAt", observedAt).put("unavailableReason", unavailableReason ?: JSONObject.NULL)
  }

  private fun requestedAt(id: String): String? = prefs.getString("perm_requested_at_$id", null)
  private fun recordRequest(id: String) { prefs.edit().putString("perm_requested_at_$id", now()).apply() }

  /**
   * requested  = what the person asked for (persisted intent)
   * operational = ApolloDnsVpnService.isRunning, observed now — the only source of "protection is on"
   * degradedReason explains any gap between the two, in plain words.
   */
  private fun statusJson(): String {
    // Live facts in, derived truth out (SiteGuardTruth is pure and unit-tested). Nothing here is cached.
    val d = SiteGuardTruth.derive(requested = requested, vpnRunning = ApolloDnsVpnService.isRunning, vpnGranted = VpnService.prepare(ctx) == null)
    val ts = now()
    return JSONObject()
      .put("running", d.operational)
      .put("requested", requested)
      .put("operational", d.operational)
      .put("enforcementMethod", d.enforcementMethod)
      .put("coverage", d.coverage)
      .put("coverageScope", JSONArray(d.coverageScope))
      .put("lastVerified", ts) // isRunning is read from the live service at this instant
      .put("degradedReason", d.degradedReason ?: JSONObject.NULL)
      .put("visibility", d.visibility)
      .put("since", if (requested) (protectionSince ?: JSONObject.NULL) else JSONObject.NULL)
      .put("adapterLabel", label)
      .put("checkedAt", ts)
      .toString()
  }

  private fun now(): String = Instant.now().toString()
}
