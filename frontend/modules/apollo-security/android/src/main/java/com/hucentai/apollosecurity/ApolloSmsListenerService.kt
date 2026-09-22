package com.hucentai.apollosecurity

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
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

/** Opt-in notification intake with encrypted, non-destructive mailbox semantics. */
class ApolloSmsListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || !isMessageNotification(sbn)) return
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
    enqueue(this, sbn.key ?: "${sbn.packageName}:${sbn.id}", sbn.packageName, sender, exposed)
  }

  private fun isMessageNotification(sbn: StatusBarNotification): Boolean {
    val category = sbn.notification.category
    if (category == Notification.CATEGORY_MESSAGE) return true
    return sbn.packageName in setOf("com.google.android.apps.messaging", "com.samsung.android.messaging")
  }

  companion object {
    private const val PREFS = "apollo_sms_guard"
    private const val QUEUE = "queue_v2"
    private const val OVERFLOW = "overflow_count"
    private const val QUEUE_ERRORS = "queue_error_count"
    private const val KEY_ALIAS = "apollo_sms_guard_aes_v1"
    private const val MAX_ITEMS = 64
    private const val MAX_TEXT = 250_000
    private val lock = Any()

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

    private fun enqueue(ctx: Context, sourceKey: String, sourcePackage: String, senderRaw: String, textRaw: String) = synchronized(lock) {
      val capturedAt = Instant.now(); val expiresAt = capturedAt.plus(15, ChronoUnit.MINUTES)
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
    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

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