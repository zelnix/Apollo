package com.hucentai.apollosecurity

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * Apollo's ONE answer to Android's own "connect the VPN" request.
 *
 * Android starts this service (action `android.net.VpnService`, package-scoped) when the person has
 * chosen Apollo as the Always-on VPN: when Always-on is switched on, after a reboot or unlock, after
 * an app update, and whenever Apollo's VPN went down while Always-on is set. It is the only component
 * in the package that carries that intent filter: `plugins/withGuardDogEngine.js` replaces the
 * certified `GuardDogVpnService` declaration with one WITHOUT the filter (the certified source and
 * its own manifest are untouched). The certified service still establishes the tunnel exactly as
 * before — it simply never receives this system request, which it was designed to ignore.
 *
 * What it does: rebuilds protection from the persisted, already-validated configuration and rule
 * bundle via [ApolloGuardDogProductionRuntime.startForSystemRequest], then stops itself. Nothing is
 * assumed: when protection cannot start (never set up, no current rules, no network), the reason is
 * recorded and reported in the protection status, and the tunnel stays down.
 */
class ApolloAlwaysOnVpnStarter : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val app = applicationContext
    // Off the main thread: starting waits for the network and for the tunnel to come up. Android
    // grants a short background-start window with this request, which covers both waits.
    Thread({
      try {
        if (!ApolloGuardDogProductionOwner.isEligible(app)) {
          Log.w(TAG, "Android asked Apollo to connect, but production protection is disabled in this build")
        } else {
          val runtime = ApolloGuardDogProductionOwner.get(app)
          runtime.awaitPhysicalDns(NETWORK_WAIT_MS)
          runtime.startForSystemRequest()
        }
      } catch (t: Throwable) {
        Log.w(TAG, "Android asked Apollo to connect and it couldn't: ${t.message}")
      } finally {
        stopSelf(startId)
      }
    }, "apollo-always-on-start").start()
    return START_NOT_STICKY
  }

  companion object {
    private const val TAG = "ApolloAlwaysOn"
    /** At boot the network can arrive a few seconds after Android's request. */
    private const val NETWORK_WAIT_MS = 20_000L
  }
}
