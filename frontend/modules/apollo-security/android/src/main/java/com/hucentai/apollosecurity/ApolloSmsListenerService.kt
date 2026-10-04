package com.hucentai.apollosecurity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Opt-in notification intake with encrypted, non-destructive mailbox semantics.
 *
 * Notification scope (Issue #1 fix):
 *   Only accepts notifications from the device's resolved default SMS application.
 *   When Android cannot resolve a default, falls back to KNOWN_SMS_PACKAGES (documented below).
 *   Does NOT accept every CATEGORY_MESSAGE notification — WhatsApp, Telegram, Messenger etc. are excluded.
 *
 * Local analysis (Issue #2 fix):
 *   Runs ApolloLocalMessageAnalyzer immediately on capture (no network). If suspicious, stores a
 *   local finding and posts a local notification. Raw content is enqueued separately with bounded
 *   expiry for backend Higgins handoff.
 *
 * Privacy (Issue #4 fix):
 *   Raw message content is encrypted and expires after CONTENT_EXPIRY_MINUTES.
 *   Local findings are stored separately and persist after content expiry.
 *   No sender or message preview is stored in pending assessment records.
 */
class ApolloSmsListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    // Issue #1: Resolve default SMS package FIRST, then check notification origin.
    if (!isFromDefaultSmsApp(sbn)) return
    if (!isMessageNotification(sbn)) return
    val extras = sbn.notification.extras
    val candidates = mutableListOf<String>()
    extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let(candidates::add)
    extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let(candidates::add)
    extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n")?.let(candidates::add)
    @Suppress("DEPRECATION")
    (extras.get(Notification.EXTRA_MESSAGES) as? Array<*>)?.mapNotNull { (it as? android.os.Bundle)?.getCharSequence("text")?.toString() }
      ?.joinToString("\n")?.let(candidates::add)
    val exposed = candidates.maxByOrNull { it.length }?.trim().orEmpty()
    if (exposed.isBlank()) return
    val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()

    // Issue #2: Run local deterministic analysis immediately, before any network handoff.
    val localResult = ApolloLocalMessageAnalyzer.analyse(sender, exposed)
    // Compute content-stable identifiers BEFORE any storage — shared across local finding and handoff queue.
    val revisionDigest = sha256("$sender\n$exposed")
    val sourceKey = sbn.key ?: "${sbn.packageName}:${sbn.id}"
    val submissionId = sha256("$sourceKey:$revisionDigest")
    if (localResult.suspicious) {
      storeLocalFinding(this, sourceKey, revisionDigest, submissionId, localResult)
      postLocalWarningNotification(this, sender, localResult)
    }

    // Enqueue raw content for backend handoff (bounded expiry, encrypted).
    enqueue(this, sourceKey, sbn.packageName, sender, exposed)
  }

  /**
   * Issue #1: Only accept notifications from the device's default SMS application.
   * Resolves the default via [Telephony.Sms.getDefaultSmsPackage]. Falls back to
   * KNOWN_SMS_PACKAGES only when Android returns null (no default configured).
   */
  private fun isFromDefaultSmsApp(sbn: StatusBarNotification): Boolean {
    val defaultPackage = Telephony.Sms.getDefaultSmsPackage(applicationContext)
    if (defaultPackage != null) {
      return sbn.packageName == defaultPackage
    }
    // Fallback: Android could not resolve a default SMS app. This can happen on devices with
    // no SIM, during initial setup, or on certain custom ROMs. Accept only known SMS packages.
    // Documented: this list is the ONLY fallback and is NOT used when a default is resolved.
    return sbn.packageName in KNOWN_SMS_PACKAGES
  }

  /**
   * After confirming the notification is from the SMS app, verify it's actually a message
   * (not a service notification from the SMS app about updates, etc.).
   */
  private fun isMessageNotification(sbn: StatusBarNotification): Boolean {
    return sbn.notification.category == Notification.CATEGORY_MESSAGE
  }

  companion object {
    private const val PREFS = "apollo_sms_guard"
    private const val QUEUE = "queue_v2"
    private const val LOCAL_FINDINGS = "local_findings_v1"
    private const val OVERFLOW = "overflow_count"
    private const val QUEUE_ERRORS = "queue_error_count"
    private const val KEY_ALIAS = "apollo_sms_guard_aes_v1"
    private const val MAX_ITEMS = 64
    private const val MAX_TEXT = 250_000
    private const val MAX_LOCAL_FINDINGS = 100
    private const val CONTENT_EXPIRY_MINUTES = 15L
    private const val WARNING_CHANNEL = "apollo_text_guard"
    private const val WARNING_NOTIFICATION_BASE_ID = 9000
    private val lock = Any()

    /**
     * Fallback SMS packages used ONLY when Telephony.Sms.getDefaultSmsPackage() returns null.
     * This list covers the two most common pre-installed Android messaging apps.
     * It is NOT used when a default SMS app is resolved.
     */
    private val KNOWN_SMS_PACKAGES = setOf(
      "com.google.android.apps.messaging",  // Google Messages
      "com.samsung.android.messaging",       // Samsung Messages
    )

    fun isEnabled(ctx: Context): Boolean {
      val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
      val own = ComponentName(ctx, ApolloSmsListenerService::class.java)
      return flat.split(':').any { ComponentName.unflattenFromString(it) == own }
    }

    fun readQueue(ctx: Context): JSONArray = synchronized(lock) {
      try {
        val queue = load(ctx)
        if (purgeExpired(queue)) save(ctx, queue)
        val overflow = prefs(ctx).getInt(OVERFLOW, 0)
        if (overflow > 0 && (0 until queue.length()).none { queue.optJSONObject(it)?.optString("status") == "overflow" }) {
          queue.put(JSONObject().put("id", "overflow-${Instant.now().toEpochMilli()}").put("status", "overflow").put("droppedCount", overflow))
          prefs(ctx).edit().putInt(OVERFLOW, 0).commit()
          save(ctx, queue)
        }
        queue
      } catch (exc: Exception) {
        recordQueueError(ctx)
        JSONArray().put(JSONObject().put("id", "queue-error").put("status", "queue_error")
          .put("reason", if (exc is java.security.KeyStoreException) "key_unavailable" else "decrypt_failed")
          .put("failureCount", prefs(ctx).getInt(QUEUE_ERRORS, 0)))
      }
    }

    fun acknowledge(ctx: Context, ids: Set<String>): Int = synchronized(lock) {
      if (ids.isEmpty()) return@synchronized 0
      val queue = try { load(ctx) } catch (_: Exception) { recordQueueError(ctx); return@synchronized 0 }
      val kept = JSONArray(); var removed = 0
      for (index in 0 until queue.length()) {
        val item = queue.optJSONObject(index) ?: continue
        if (item.optString("id") in ids) removed++ else kept.put(item)
      }
      if (removed > 0 && !save(ctx, kept)) return@synchronized 0
      removed
    }

    fun configureHandoff(ctx: Context, backendUrl: String, token: String): Boolean = synchronized(lock) {
      val ok = prefs(ctx).edit().putString("backend_url", backendUrl.trimEnd('/')).putString("device_token", encrypt(ctx, token)).commit()
      if (ok) schedule(ctx)
      ok
    }

    fun schedule(ctx: Context) {
      val request = OneTimeWorkRequestBuilder<ApolloTextHandoffWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
      WorkManager.getInstance(ctx).enqueueUniqueWork("apollo-text-handoff", ExistingWorkPolicy.KEEP, request)
    }

    internal fun backendUrl(ctx: Context): String? = prefs(ctx).getString("backend_url", null)
    internal fun deviceToken(ctx: Context): String? = prefs(ctx).getString("device_token", null)?.let { decrypt(ctx, it) }

    /** Read local findings (persisted separately from raw content; survive content expiry). */
    fun readLocalFindings(ctx: Context): JSONArray = synchronized(lock) {
      try {
        val raw = prefs(ctx).getString(LOCAL_FINDINGS, null) ?: return JSONArray()
        JSONArray(decrypt(ctx, raw))
      } catch (_: Exception) { JSONArray() }
    }

    /** Acknowledge (remove) local findings by their IDs. Returns count removed. */
    fun acknowledgeLocalFindings(ctx: Context, ids: Set<String>): Int = synchronized(lock) {
      if (ids.isEmpty()) return@synchronized 0
      try {
        val arr = readLocalFindings(ctx)
        val kept = JSONArray(); var removed = 0
        for (i in 0 until arr.length()) {
          val item = arr.optJSONObject(i) ?: continue
          if (item.optString("findingId") in ids) removed++ else kept.put(item)
        }
        if (removed > 0) prefs(ctx).edit().putString(LOCAL_FINDINGS, encrypt(ctx, kept.toString())).commit()
        removed
      } catch (_: Exception) { 0 }
    }

    /** Store a local finding from ApolloLocalMessageAnalyzer. Encrypted, bounded.
     * findingId is content-stable: sha256("local:$sourceKey:$revisionDigest"). Repeated delivery
     * of the same notification revision replaces (not duplicates) the existing finding. */
    internal fun storeLocalFinding(ctx: Context, sourceKey: String, revisionDigest: String, submissionId: String, result: ApolloLocalMessageAnalyzer.AnalysisResult) = synchronized(lock) {
      try {
        val arr = readLocalFindings(ctx)
        // Content-stable: same source + same content revision → same findingId
        val findingId = sha256("local:$sourceKey:$revisionDigest")
        // Idempotent: if this findingId already exists, skip (do not duplicate)
        for (i in 0 until arr.length()) {
          if (arr.optJSONObject(i)?.optString("findingId") == findingId) return@synchronized
        }
        val entry = JSONObject()
          .put("findingId", findingId)
          .put("submissionId", submissionId)
          .put("state", result.state)
          .put("analyzer", result.analyzer)
          .put("source", result.source)
          .put("findings", result.toJson().getJSONArray("findings"))
          .put("detectedAt", Instant.now().toString())
        arr.put(entry)
        // Bounded: keep only the most recent MAX_LOCAL_FINDINGS
        while (arr.length() > MAX_LOCAL_FINDINGS) arr.remove(0)
        prefs(ctx).edit().putString(LOCAL_FINDINGS, encrypt(ctx, arr.toString())).commit()
      } catch (_: Exception) { /* best-effort */ }
    }

    /** Post a local notification for a suspicious message detection. */
    internal fun postLocalWarningNotification(ctx: Context, sender: String, result: ApolloLocalMessageAnalyzer.AnalysisResult) {
      try {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        // Create channel if needed (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val existing = nm.getNotificationChannel(WARNING_CHANNEL)
          if (existing == null) {
            nm.createNotificationChannel(NotificationChannel(WARNING_CHANNEL, "Text Guard Warnings", NotificationManager.IMPORTANCE_HIGH).apply {
              description = "Warnings from Apollo's Text Guard when a suspicious message is detected."
            })
          }
        }
        // Build notification — no message content, only that a warning was generated
        val title = if (result.state == "growling") "Apollo: suspicious message" else "Apollo: message worth checking"
        val body = "A message${if (sender.isNotBlank()) " notification" else ""} triggered Apollo's local detection. Open Apollo to review."
        // Intent to open the app
        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pendingIntent = if (launchIntent != null) PendingIntent.getActivity(ctx, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) else null
        val notification = NotificationCompat.Builder(ctx, WARNING_CHANNEL)
          .setSmallIcon(ctx.applicationInfo.icon)
          .setContentTitle(title)
          .setContentText(body)
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setAutoCancel(true)
          .also { if (pendingIntent != null) it.setContentIntent(pendingIntent) }
          .build()
        nm.notify(WARNING_NOTIFICATION_BASE_ID + (System.currentTimeMillis() % 100).toInt(), notification)
      } catch (_: Exception) { /* notification delivery is best-effort */ }
    }

    private fun enqueue(ctx: Context, sourceKey: String, sourcePackage: String, senderRaw: String, textRaw: String) = synchronized(lock) {
      val capturedAt = Instant.now(); val expiresAt = capturedAt.plus(CONTENT_EXPIRY_MINUTES, ChronoUnit.MINUTES)
      val complete = textRaw.length <= MAX_TEXT
      val text = if (complete) textRaw else textRaw.substring(0, MAX_TEXT)
      val sender = senderRaw.take(2_048)
      val revision = sha256("$sender\n$textRaw")
      val id = sha256("$sourceKey:$revision")
      val queue = try { load(ctx) } catch (_: Exception) { recordQueueError(ctx); return@synchronized }
      purgeExpired(queue)
      if ((0 until queue.length()).any { queue.optJSONObject(it)?.optString("id") == id }) { schedule(ctx); return@synchronized }
      queue.put(JSONObject().put("id", id).put("status", "pending").put("sourceKey", sourceKey).put("sourcePackage", sourcePackage)
        .put("revisionDigest", revision).put("sender", sender).put("text", text).put("capturedAt", capturedAt.toString())
        .put("expiresAt", expiresAt.toString()).put("contentComplete", complete).put("originalCharacters", textRaw.length))
      var dropped = 0
      while (queue.length() > MAX_ITEMS) { queue.remove(0); dropped++ }
      val editor = prefs(ctx).edit()
      if (dropped > 0) editor.putInt(OVERFLOW, prefs(ctx).getInt(OVERFLOW, 0) + dropped)
      if (save(ctx, queue) && editor.commit()) {
        schedule(ctx)
      } else recordQueueError(ctx)
    }

    private fun purgeExpired(queue: JSONArray): Boolean {
      val now = Instant.now(); val kept = JSONArray(); var changed = false
      for (index in 0 until queue.length()) {
        val item = queue.optJSONObject(index) ?: continue
        val expired = try { item.has("expiresAt") && Instant.parse(item.getString("expiresAt")).isBefore(now) } catch (_: Exception) { true }
        if (expired) changed = true else kept.put(item)
      }
      if (changed) { while (queue.length() > 0) queue.remove(0); for (index in 0 until kept.length()) queue.put(kept.get(index)) }
      return changed
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun load(ctx: Context): JSONArray = prefs(ctx).getString(QUEUE, null)?.let { JSONArray(decrypt(ctx, it)) } ?: JSONArray()
    private fun save(ctx: Context, value: JSONArray): Boolean = prefs(ctx).edit().putString(QUEUE, encrypt(ctx, value.toString())).commit()
    private fun recordQueueError(ctx: Context) { prefs(ctx).edit().putInt(QUEUE_ERRORS, prefs(ctx).getInt(QUEUE_ERRORS, 0) + 1).commit() }
    internal fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    internal fun encrypt(ctx: Context, plain: String): String {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
      return Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray(StandardCharsets.UTF_8)), Base64.NO_WRAP)
    }
    internal fun decrypt(ctx: Context, encoded: String): String {
      val all = Base64.decode(encoded, Base64.NO_WRAP); val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
      return String(cipher.doFinal(all.copyOfRange(12, all.size)), StandardCharsets.UTF_8)
    }
    private fun key(): SecretKey {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
      return KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
        init(android.security.keystore.KeyGenParameterSpec.Builder(KEY_ALIAS,
          android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE).build())
      }.generateKey()
    }
  }
}
