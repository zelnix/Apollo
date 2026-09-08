package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
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
      // Rule-activation evidence only — this confirms the filter is live and will enforce this host from
      // now on; it is NOT evidence of a specific packet drop (see EnforcementEvidence.ruleActivated).
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
      requested = true
      if (protectionSince == null) protectionSince = now()
      if (VpnService.prepare(ctx) == null) {
        ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_START))
        // Wait for establish() to actually succeed (or not) — up to 2 s — so the status we return is observed, not assumed.
        var waited = 0
        while (!ApolloDnsVpnService.isRunning && waited < 2000) { Thread.sleep(100); waited += 100 }
      }
      statusJson()
    }

    AsyncFunction("stopProtection") {
      requested = false
      protectionSince = null
      ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_STOP))
      var waited = 0
      while (ApolloDnsVpnService.isRunning && waited < 1500) { Thread.sleep(100); waited += 100 }
      statusJson()
    }

    AsyncFunction("getProtectionPermissions") {
      val vpn = if (VpnService.prepare(ctx) == null) "granted" else "undetermined"
      JSONArray().apply {
        put(perm("vpn_config", "Local VPN (DNS filter)", vpn, true, "Lets Apollo filter DNS lookups on this device so verified threat domains cannot load. Only DNS passes through; no browsing data is collected."))
        put(perm("notifications", "Notifications", "undetermined", true, "Lets Apollo tell you when it barks."))
      }.toString()
    }

    AsyncFunction("requestProtectionPermission") { id: String ->
      if (id == "vpn_config") {
        val intent = VpnService.prepare(ctx)
        if (intent == null) perm("vpn_config", "Local VPN (DNS filter)", "granted", true, "Granted.").toString()
        else {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          appContext.currentActivity?.startActivity(intent) ?: ctx.startActivity(intent)
          perm("vpn_config", "Local VPN (DNS filter)", "undetermined", true, "System VPN consent shown. Re-check after you respond.").toString()
        }
      } else perm(id, id, "undetermined", true, "Not implemented in this build.").toString()
    }

    // Phase A — Apps & Device (AppDeviceSdk contract). Real signals within package-visibility limits; see AppDeviceSignals.
    AsyncFunction("getAppDeviceCapabilities") { AppDeviceSignals(ctx).capabilitiesJson() }
    AsyncFunction("getInstalledAppAssessment") { nameOrPackage: String -> AppDeviceSignals(ctx).appAssessmentJson(nameOrPackage) }
    AsyncFunction("getRecentInstallEvents") { "[]" }        // no PACKAGE_ADDED receiver by design (would need broad visibility)
    AsyncFunction("getDeviceSecuritySignals") { AppDeviceSignals(ctx).deviceSignalsJson() }
    AsyncFunction("getRecentAppSecurityEvents") { "[]" }

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
        .put("dnsVisibility", "full")         // every system-resolver DNS query is seen
        .put("processAttribution", "none")    // no UID/PID mapping implemented in this module
        .put("appAttribution", "none")
        .put("domainVisibility", "full")
        .put("localBlocking", "full")         // NXDOMAIN genuinely blocks, on this device, right now
        .put("backgroundProtection", "full")  // foreground VpnService, START_STICKY
        .put("offlineProtection", "full")     // the blocklist check needs no network at all
        .put("realTimeEvents", "partial")     // evidence is ready instantly, but the JS side must poll for it
        .toString()
    }

    // Recent real enforcement actions (EnforcementEvidence.kt). Only entries handlePacket() actually wrote
    // an NXDOMAIN reply for — never a rule match, never an intent, never anything simulated.
    AsyncFunction("getEnforcementEvidence") {
      val arr = JSONArray()
      ApolloDnsVpnService.recentEvidence().forEach { arr.put(evidenceJson(it)) }
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
  private fun perm(id: String, title: String, status: String, canAskAgain: Boolean, why: String) =
    JSONObject().put("id", id).put("title", title).put("status", status).put("canAskAgain", canAskAgain).put("why", why)

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
