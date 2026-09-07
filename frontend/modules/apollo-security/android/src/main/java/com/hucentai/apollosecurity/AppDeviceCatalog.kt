package com.hucentai.apollosecurity

/**
 * Phase A — Apps & Device: the pure, JVM-testable half of the Android signals.
 *
 * Package visibility rule (Android 11+): Apollo does NOT request QUERY_ALL_PACKAGES and is NOT an AccessibilityService.
 * It can only see the packages declared in AndroidManifest `<queries>` — exactly the RISK_CATALOG below plus the stores
 * and browsers needed to name an install source. Anything outside that list is reported as "not visible", never guessed.
 */
object AppDeviceCatalog {
  /** Remote-access / screen-sharing tools commonly abused in "tech support" and bank-impersonation scams. */
  val RISK_CATALOG: Map<String, String> = linkedMapOf(
    "com.anydesk.anydeskandroid" to "AnyDesk",
    "com.teamviewer.teamviewer.market.mobile" to "TeamViewer",
    "com.teamviewer.quicksupport.market" to "TeamViewer QuickSupport",
    "com.teamviewer.host.market" to "TeamViewer Host",
    "com.rsupport.rs.activity.rsupport.aas2" to "RemoteView",
    "com.splashtop.remote.pad.v2" to "Splashtop",
    "com.splashtop.streamer.csrs" to "Splashtop SOS",
    "com.sand.airdroid" to "AirDroid",
    "com.sand.airmirror" to "AirMirror",
    "com.microsoft.rdc.androidx" to "Microsoft Remote Desktop",
    "com.realvnc.viewer.android" to "VNC Viewer",
    "com.logmein.rescuemobile" to "LogMeIn Rescue",
    "com.zoho.assist.agent" to "Zoho Assist",
    "com.aeroadmin.android" to "AeroAdmin",
    "com.ultraviewer.android" to "UltraViewer",
    "com.rustdesk.rustdesk" to "RustDesk",
    "net.grandcentrix.tv.remotedesktop" to "Remote Desktop",
  )

  val STORES: Map<String, String> = mapOf(
    "com.android.vending" to "play_store",
    "com.sec.android.app.samsungapps" to "other_store",
    "com.amazon.venezia" to "other_store",
    "com.huawei.appmarket" to "other_store",
    "com.xiaomi.mipicks" to "other_store",
  )
  val BROWSERS: Set<String> = setOf(
    "com.android.chrome", "org.mozilla.firefox", "com.microsoft.emmx", "com.opera.browser", "com.brave.browser",
    "com.sec.android.app.sbrowser", "com.duckduckgo.mobile.android", "com.android.browser",
  )
  val MESSENGERS: Set<String> = setOf(
    "com.whatsapp", "org.telegram.messenger", "com.facebook.orca", "com.google.android.apps.messaging", "com.samsung.android.messaging",
  )
  /** Everything Apollo needs to be able to see, for the manifest `<queries>` block. */
  val VISIBLE_PACKAGES: List<String> = (RISK_CATALOG.keys + STORES.keys + BROWSERS + MESSENGERS).toList()

  /** Maps the installing package (PackageManager.getInstallSourceInfo) to the SDK contract's installSource. */
  fun installSource(installingPackage: String?): String = when {
    installingPackage == null -> "not_sure"
    STORES.containsKey(installingPackage) -> STORES.getValue(installingPackage)
    BROWSERS.contains(installingPackage) -> "browser"
    MESSENGERS.contains(installingPackage) -> "message"
    installingPackage == "com.google.android.packageinstaller" || installingPackage == "com.android.packageinstaller" -> "browser" // sideloaded APK opened by the person
    else -> "not_sure"
  }

  fun isRemoteAccessTool(packageId: String): Boolean = RISK_CATALOG.containsKey(packageId.lowercase())

  /** Accepts a package id or a catalog display name ("AnyDesk") and returns the package id, if it is in the catalog. */
  fun resolveCatalogPackage(nameOrPackage: String): String? {
    val q = nameOrPackage.trim().lowercase()
    if (RISK_CATALOG.containsKey(q)) return q
    return RISK_CATALOG.entries.firstOrNull { it.value.lowercase() == q || q.replace(" ", "") == it.value.lowercase().replace(" ", "") }?.key
  }

  private val SYSTEM_PREFIXES = listOf("com.google.", "com.android.", "com.samsung.", "com.sec.", "android.", "com.motorola.", "com.oneplus.", "com.oppo.", "com.miui.", "com.huawei.")

  /**
   * Parses Settings.Secure ENABLED_ACCESSIBILITY_SERVICES ("pkg/cls:pkg/cls") and keeps third-party packages only.
   * Package names are reported (labels need visibility we don't have). Never includes Apollo itself.
   */
  fun thirdPartyServices(setting: String?, ownPackage: String): List<String> {
    if (setting.isNullOrBlank()) return emptyList()
    return setting.split(':').mapNotNull { it.substringBefore('/').trim().ifEmpty { null } }
      .filter { pkg -> pkg != ownPackage && SYSTEM_PREFIXES.none { pkg.startsWith(it) } }
      .distinct()
  }

  /** Android "dangerous" permissions worth explaining, mapped to the plain names the App engine understands. */
  val PERMISSION_LABELS: Map<String, String> = mapOf(
    "android.permission.READ_SMS" to "Read SMS", "android.permission.RECEIVE_SMS" to "Receive SMS", "android.permission.SEND_SMS" to "Send SMS",
    "android.permission.READ_CONTACTS" to "Contacts", "android.permission.CAMERA" to "Camera", "android.permission.RECORD_AUDIO" to "Microphone",
    "android.permission.ACCESS_FINE_LOCATION" to "Precise location", "android.permission.ACCESS_COARSE_LOCATION" to "Location",
    "android.permission.READ_CALL_LOG" to "Call log", "android.permission.CALL_PHONE" to "Make calls", "android.permission.READ_PHONE_STATE" to "Phone state",
    "android.permission.SYSTEM_ALERT_WINDOW" to "Display over other apps", "android.permission.BIND_ACCESSIBILITY_SERVICE" to "Accessibility service",
    "android.permission.REQUEST_INSTALL_PACKAGES" to "Install other apps", "android.permission.READ_MEDIA_IMAGES" to "Photos",
    "android.permission.READ_EXTERNAL_STORAGE" to "Files", "android.permission.POST_NOTIFICATIONS" to "Notifications",
    "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" to "Read notifications", "android.permission.BIND_DEVICE_ADMIN" to "Device admin",
  )

  fun plainPermissions(requested: Array<String>?): List<String> = (requested ?: emptyArray()).mapNotNull { PERMISSION_LABELS[it] }.distinct()
}
