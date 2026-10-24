package com.hucentai.apollosecurity

import android.net.VpnService
import android.os.Build

/**
 * Android's Always-on VPN settings for Apollo, read through VpnService's own public API (Android 10+).
 *
 * Android only answers for the app whose VPN is connected right now, so callers read these while
 * Apollo's tunnel is up. `null` means Android didn't say (older Android, or the read failed) — never
 * "off". The calls are static binder queries keyed on Apollo's uid, so a detached VpnService
 * instance is enough to ask them.
 */
internal object ApolloVpnSystemState {
  /** Apollo is the Always-on VPN: Android reconnects it by itself (boot, updates, drops). */
  fun alwaysOn(): Boolean? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) runCatching { VpnService().isAlwaysOn }.getOrNull() else null

  /**
   * "Block connections without VPN" is on. Apollo's tunnel only carries website lookups and its
   * sinkhole routes, not the rest of the person's traffic, so with this on Android can stop apps
   * from connecting at all.
   */
  fun lockdown(): Boolean? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) runCatching { VpnService().isLockdownEnabled }.getOrNull() else null
}
