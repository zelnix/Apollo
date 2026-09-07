package com.hucentai.apollosecurity

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Phase A — Apps & Device: real Android signals behind the AppDeviceSdk contract.
 *
 * Truth rules: every field the platform cannot expose to a normal app is `null` (the UI lists it under "cannot see").
 * No QUERY_ALL_PACKAGES, no AccessibilityService, no device-admin — only readable Settings, ConnectivityManager,
 * DevicePolicyManager.activeAdmins and PackageManager lookups for the packages declared in `<queries>`.
 */
class AppDeviceSignals(private val ctx: Context) {
  private val pm: PackageManager get() = ctx.packageManager

  fun capabilitiesJson(): String = JSONObject()
    .put("installEvents", "unsupported")            // needs QUERY_ALL_PACKAGES or a PACKAGE_ADDED receiver we deliberately don't use
    .put("appPermissions", "supported")             // catalog packages only (see AppDeviceCatalog.VISIBLE_PACKAGES)
    .put("accessibilityServices", "supported")      // Settings.Secure, readable
    .put("overlayApps", "unsupported")              // would need every package's appops
    .put("notificationAccess", "supported")         // Settings.Secure enabled_notification_listeners
    .put("vpnState", "supported")
    .put("profileState", "supported")               // active device admins
    .put("appNetworkCorrelation", "unsupported")
    .toString()

  /** DeviceSignals contract (src/domain/deviceAnalysis.ts). */
  fun deviceSignalsJson(): String {
    val own = ctx.packageName
    val a11y = AppDeviceCatalog.thirdPartyServices(secure(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), own)
    val listeners = AppDeviceCatalog.thirdPartyServices(secure("enabled_notification_listeners"), own)
    val vpn = vpnActive()
    val admins = try { (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).activeAdmins ?: emptyList() } catch (_: Exception) { null }
    val remote = installedCatalogApps()
    val dev = try { Settings.Global.getInt(ctx.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1 } catch (_: Exception) { null }
    return JSONObject()
      .put("platform", "android")
      .put("unknownSourcesEnabled", JSONObject.NULL)          // per-app since Android 8; not readable for other apps
      .put("thirdPartyAccessibilityServices", JSONArray(a11y))
      .put("overlayApps", JSONObject.NULL)
      .put("notificationAccessApps", JSONArray(listeners))
      .put("vpnActive", vpn ?: JSONObject.NULL)
      // Only Apollo's own filter is a "known" provider; any other VPN is reported as unknown (null), never as trusted.
      .put("vpnProviderKnown", if (vpn == true) (if (ApolloDnsVpnService.isRunning) true else JSONObject.NULL) else JSONObject.NULL)
      .put("managementProfile", when { admins == null -> "unknown"; admins.isNotEmpty() -> "present"; else -> "none" })
      .put("userTrustedCertificates", JSONObject.NULL)         // user CA store is not readable by apps
      .put("remoteAccessApps", JSONArray(remote.map { it.second }))
      .put("developerOptions", dev ?: JSONObject.NULL)
      .toString()
  }

  /** SdkAppAssessment for a catalog package (or catalog display name). Null when Apollo cannot see that app. */
  fun appAssessmentJson(nameOrPackage: String): String {
    val pkg = AppDeviceCatalog.resolveCatalogPackage(nameOrPackage) ?: return "null"
    val info = try { pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS) } catch (_: Exception) { return "null" }
    val installing: String? = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) pm.getInstallSourceInfo(pkg).installingPackageName else @Suppress("DEPRECATION") pm.getInstallerPackageName(pkg)
    } catch (_: Exception) { null }
    val appLabel = try { pm.getApplicationLabel(info.applicationInfo!!).toString() } catch (_: Exception) { AppDeviceCatalog.RISK_CATALOG[pkg] ?: pkg }
    return JSONObject()
      .put("packageId", pkg)
      .put("appName", appLabel)
      .put("developer", JSONObject.NULL)                       // Android exposes no developer name
      .put("installSource", AppDeviceCatalog.installSource(installing))
      .put("installedAt", Instant.ofEpochMilli(info.firstInstallTime).toString())
      .put("permissions", JSONArray(AppDeviceCatalog.plainPermissions(info.requestedPermissions)))
      .put("remoteAccessCapability", AppDeviceCatalog.isRemoteAccessTool(pkg))
      .put("network", JSONObject.NULL)
      .toString()
  }

  /** (packageId, label) for every catalog app present on the device — the only apps Apollo may see. */
  fun installedCatalogApps(): List<Pair<String, String>> = AppDeviceCatalog.RISK_CATALOG.mapNotNull { (pkg, name) ->
    try { pm.getPackageInfo(pkg, 0); pkg to name } catch (_: PackageManager.NameNotFoundException) { null } catch (_: Exception) { null }
  }

  private fun secure(key: String): String? = try { Settings.Secure.getString(ctx.contentResolver, key) } catch (_: Exception) { null }

  private fun vpnActive(): Boolean? = try {
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val caps = cm.getNetworkCapabilities(cm.activeNetwork)
    if (caps == null) null else caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || cm.allNetworks.any { n -> cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
  } catch (_: Exception) { null }
}
