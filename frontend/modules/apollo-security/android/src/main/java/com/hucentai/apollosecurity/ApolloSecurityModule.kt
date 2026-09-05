package com.hucentai.apollosecurity

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * ApolloSecurity — Android (Kotlin) security module stub.
 * Phase 2 shell: reports truthful capabilities and status; no protection is
 * claimed. The security developer replaces stubbed bodies with real
 * VpnService / DNS-filter integrations. Every method returns JSON matching
 * src/security/SecurityPlatformAdapter.ts.
 */
class ApolloSecurityModule : Module() {
  private var running = false
  private var since: String? = null
  private val blocked = mutableSetOf<String>()

  override fun definition() = ModuleDefinition {
    Name("ApolloSecurity")

    AsyncFunction("getCapabilities") {
      JSONArray().apply {
        put(cap("link_guard", "Link Guard", if (running) "active" else "available", "Checks links you paste or share into Apollo."))
        put(cap("known_threats", "Known Threat Lookup", if (running) "active" else "available", "Privacy-preserving reputation checks using the link only."))
        put(cap("site_guard", "Site Guard", "coming_later", "Local VPN / DNS filtering is not yet implemented."))
        put(cap("connection_guard", "Connection Guard", "coming_later", "Wi‑Fi safety checks are not yet implemented."))
        put(cap("share_intake", "Share to Apollo", "coming_later", "Share intent intake is not yet implemented."))
      }.toString()
    }

    AsyncFunction("getProtectionStatus") { statusJson() }

    AsyncFunction("analyseURL") { _: String ->
      JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("Native URL analysis not implemented yet.")).toString()
    }

    AsyncFunction("analyseDomain") { _: String ->
      JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("Native domain analysis not implemented yet.")).toString()
    }

    AsyncFunction("blockDestination") { _: String ->
      // Fail closed: no verified block until a real filter exists.
      JSONObject().put("verified", false).put("method", "none").put("detail", "No local filter is installed; block not verified.")
        .put("adapterLabel", "Android security module").put("blockedAt", JSONObject.NULL).toString()
    }

    AsyncFunction("unblockDestination") { host: String ->
      blocked.remove(host)
      JSONObject().put("verified", true).put("method", "none").put("detail", "Nothing was blocked.")
        .put("adapterLabel", "Android security module").put("blockedAt", JSONObject.NULL).toString()
    }

    AsyncFunction("getNetworkStatus") {
      JSONObject().put("connected", true).put("type", "unknown").put("isInternetReachable", JSONObject.NULL)
        .put("inspectable", false).put("checkedAt", now()).toString()
    }

    AsyncFunction("getSecuritySignals") { "[]" }

    AsyncFunction("startProtection") { running = true; since = now(); statusJson() }
    AsyncFunction("stopProtection") { running = false; since = null; statusJson() }

    AsyncFunction("getProtectionPermissions") {
      JSONArray().apply {
        put(JSONObject().put("id", "vpn_config").put("title", "Local VPN filter").put("status", "not_applicable").put("canAskAgain", false)
          .put("why", "Requires VpnService integration (not yet implemented)."))
        put(JSONObject().put("id", "notifications").put("title", "Notifications").put("status", "undetermined").put("canAskAgain", true)
          .put("why", "Lets Apollo tell you when it barks."))
      }.toString()
    }

    AsyncFunction("requestProtectionPermission") { id: String ->
      JSONObject().put("id", id).put("title", id).put("status", "not_applicable").put("canAskAgain", false).put("why", "Not implemented in this build.").toString()
    }
  }

  private fun cap(id: String, title: String, status: String, detail: String) =
    JSONObject().put("id", id).put("title", title).put("status", status).put("detail", detail)

  private fun statusJson(): String = JSONObject()
    .put("running", running)
    .put("visibility", if (running) "limited" else "none")
    .put("since", since ?: JSONObject.NULL)
    .put("adapterLabel", "Android security module")
    .put("checkedAt", now())
    .toString()

  private fun now(): String = Instant.now().toString()
}
