package com.hucentai.apollosecurity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Text Guard — Android NotificationListenerService.
 *
 * Truth model: Apollo NEVER reads the SMS content provider (no READ_SMS permission is requested or
 * used anywhere in this app). Instead, with the person's explicit, revocable consent — granted one
 * screen away in Settings, exactly like Accessibility or any other "special access" — Apollo observes
 * the TEXT of a notification the instant your default messaging app posts it (the same content a lock
 * screen preview would show) and queues it for the SAME on-device Text & Message engine + Email/Text
 * Guard link assessment already used for a pasted message (see ApolloContext.checkMessage). Nothing in
 * THIS file ever decides a verdict — it only captures metadata and, for a narrow set of obvious markers,
 * fires an immediate local heuristic nudge (never a verdict) so the person isn't left waiting for the
 * app to be reopened before hearing anything at all.
 */
class ApolloSmsListenerService : NotificationListenerService() {

  companion object {
    private const val PREFS = "apollo_textguard"
    private const val KEY_QUEUE = "captured_queue"
    private const val KEY_SEEN_KEYS = "seen_notification_keys"
    private const val MAX_QUEUE = 20
    private const val MAX_SEEN = 200
    private const val CHANNEL_ID = "apollo_text_guard"
    private const val NOTIFY_ID = 20260601

    /** Read-and-clear in one shot ("mailbox" semantics) so the JS side never re-processes an item —
     * see ApolloSecurityModule.getRecentMessageSecurityEvents / ApolloContext's poll loop. */
    fun drainQueue(ctx: Context): JSONArray {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: return JSONArray()
      prefs.edit().remove(KEY_QUEUE).apply()
      return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    /** True only when Apollo itself is listed as an enabled notification-listener component —
     * mirrors the same Settings.Secure parsing AppDeviceCatalog.thirdPartyServices() uses to report
     * OTHER apps' listener access, applied here to Apollo's own. Never cached; read live. */
    fun isEnabled(ctx: Context): Boolean {
      val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
      return flat.split(':').any { it.substringBefore('/').trim() == ctx.packageName }
    }
  }

  /** Restricted to the device's default SMS app plus the two catalogued messaging apps
   * (AppDeviceCatalog.MESSENGERS) — deliberately excludes WhatsApp/Telegram/Messenger: the user asked
   * Apollo to scan SMS, not every chat app it happens to have notification access to. */
  private fun allowedPackages(): Set<String> {
    val default = try { Telephony.Sms.getDefaultSmsPackage(this) } catch (_: Exception) { null }
    val known = setOf("com.google.android.apps.messaging", "com.samsung.android.messaging")
    return known + setOfNotNull(default)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      if (sbn.packageName !in allowedPackages()) return
      // Group/summary notifications ("3 new messages") carry no useful body — the real per-message
      // notification for the same thread is posted separately and captured on its own.
      if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val seen = (prefs.getStringSet(KEY_SEEN_KEYS, emptySet()) ?: emptySet()).toMutableSet()
      if (seen.contains(sbn.key)) return
      val extras = sbn.notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
      val text = (extras.getCharSequence(Notification.EXTRA_TEXT) ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))?.toString()?.trim().orEmpty()
      if (text.isBlank()) return

      seen.add(sbn.key)
      val trimmedSeen = if (seen.size > MAX_SEEN) seen.toList().takeLast(MAX_SEEN).toSet() else seen
      prefs.edit().putStringSet(KEY_SEEN_KEYS, trimmedSeen).apply()

      val item = JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("sender", title.take(80))
        .put("text", text.take(1500))
        .put("packageName", sbn.packageName)
        .put("postedAtMs", sbn.postTime)
      val queue = try { JSONArray(prefs.getString(KEY_QUEUE, null) ?: "[]") } catch (_: Exception) { JSONArray() }
      queue.put(item)
      val trimmedQueue = if (queue.length() > MAX_QUEUE) {
        val arr = JSONArray()
        for (i in (queue.length() - MAX_QUEUE) until queue.length()) arr.put(queue.get(i))
        arr
      } else queue
      prefs.edit().putString(KEY_QUEUE, trimmedQueue.toString()).apply()

      maybeNudge(title, text)
    } catch (_: Exception) {
      // Never let a capture failure crash the system notification pipeline.
    }
  }

  /** Best-effort, entirely LOCAL heuristic — never a verdict, never sent anywhere. Only fires for a
   * narrow set of obvious markers so the person hears something before reopening Apollo; the real,
   * authoritative check (on-device engine + backend link/RDAP assessment) runs when the app is next
   * opened and drains the queue above via ApolloContext's poll loop. */
  private fun maybeNudge(sender: String, text: String) {
    val t = text.lowercase()
    val hasUrl = Regex("https?://|www\\.[a-z0-9-]+\\.[a-z]{2,}").containsMatchIn(t)
    val worrying = Regex(
      "verification code|security code|one[- ]time (code|password)|otp|gift ?cards?|urgent|suspended|" +
        "locked|anydesk|teamviewer|remote access|overdue|refund|customs|toll|final notice"
    ).containsMatchIn(t)
    if (!hasUrl && !worrying) return
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Text Guard", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Apollo flags a text message worth checking"
          }
        )
      }
      val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP) } ?: Intent()
      val pending = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val iconRes = resources.getIdentifier("ic_launcher", "mipmap", packageName).let { if (it != 0) it else android.R.drawable.ic_dialog_info }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
      val notif = builder
        .setContentTitle("Apollo noticed a message worth checking")
        .setContentText(if (sender.isNotBlank()) "From $sender — open Text Guard to check it." else "Open Apollo's Text Guard to check it.")
        .setSmallIcon(iconRes)
        .setAutoCancel(true)
        .setContentIntent(pending)
        .build()
      nm.notify(NOTIFY_ID, notif)
    } catch (_: Exception) {
      // The queued item above is still there for the next poll even if the nudge itself fails.
    }
  }
}
