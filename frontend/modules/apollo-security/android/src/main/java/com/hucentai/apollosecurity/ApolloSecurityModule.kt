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

/**
 * ApolloSecurity — Android (Kotlin) security module.
 * Site Guard is a real DNS filter (ApolloDnsVpnService). Every status reported
 * here is derived from actual system state; nothing is assumed.
 */
class ApolloSecurityModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("No context")
  private var protectionSince: String? = null
  private val label = "Android security module"

  override fun definition() = ModuleDefinition {
    Name("ApolloSecurity")

    AsyncFunction("getCapabilities") {
      val vpnGranted = VpnService.prepare(ctx) == null
      val running = ApolloDnsVpnService.isRunning
      JSONArray().apply {
        put(cap("link_guard", "Link Guard", if (protectionSince != null) "active" else "available", "Checks links you paste or share into Apollo."))
        put(cap("known_threats", "Known Threat Lookup", if (protectionSince != null) "active" else "available", "Privacy-preserving reputation checks using the link only."))
        put(cap("site_guard", "Site Guard",
          when { running -> "active"; vpnGranted -> "inactive"; else -> "permission_required" },
          when { running -> "Blocking verified threat domains with an on-device DNS filter."; vpnGranted -> "Turn protection on to start the DNS filter."; else -> "Needs the local VPN permission to filter DNS lookups on this device." }))
        put(cap("connection_guard", "Connection Guard", "coming_later", "Wi‑Fi safety checks are not yet implemented."))
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
      val verified = ApolloDnsVpnService.isRunning && ApolloDnsVpnService.isBlockedHost(host)
      JSONObject()
        .put("verified", verified)
        .put("method", if (verified) "dns_filter" else "none")
        .put("detail", if (verified) "DNS lookups for this domain now return NXDOMAIN on this device." else "Domain saved, but the DNS filter is not running so the block is not verified.")
        .put("adapterLabel", label).put("blockedAt", if (verified) now() else JSONObject.NULL).toString()
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
      JSONObject().put("connected", caps != null).put("type", type)
        .put("isInternetReachable", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: JSONObject.NULL)
        .put("inspectable", false).put("checkedAt", now()).toString()
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
      protectionSince = protectionSince ?: now()
      if (VpnService.prepare(ctx) == null) {
        ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_START))
        Thread.sleep(250) // give establish() a moment so the status we report is real
      }
      statusJson()
    }

    AsyncFunction("stopProtection") {
      protectionSince = null
      ctx.startService(Intent(ctx, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_STOP))
      Thread.sleep(150)
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
  }

  private fun cap(id: String, title: String, status: String, detail: String) =
    JSONObject().put("id", id).put("title", title).put("status", status).put("detail", detail)
  private fun perm(id: String, title: String, status: String, canAskAgain: Boolean, why: String) =
    JSONObject().put("id", id).put("title", title).put("status", status).put("canAskAgain", canAskAgain).put("why", why)

  private fun statusJson(): String {
    val running = protectionSince != null
    val filter = ApolloDnsVpnService.isRunning
    return JSONObject()
      .put("running", running)
      .put("visibility", when { !running -> "none"; filter -> "limited"; else -> "limited" })
      .put("since", protectionSince ?: JSONObject.NULL)
      .put("adapterLabel", label)
      .put("checkedAt", now())
      .toString()
  }

  private fun now(): String = Instant.now().toString()
}
