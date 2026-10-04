package com.hucentai.apollosecurity

import android.app.role.RoleManager
import android.content.Context
import android.telecom.Call
import android.telecom.CallScreeningService
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * ApolloCallScreeningService — Call Guard for Android.
 *
 * Truth model: this service NEVER listens to a call's audio and NEVER reads the system call log
 * beyond the one incoming number Android hands it. It only compares that number against three
 * on-device, person-controlled sets:
 *   - `block`     — numbers the person added themselves (deterministic, user_override).
 *   - `allow`     — numbers the person added themselves; always let these ring.
 *   - `autoRisky` — numbers THIS device previously looked up (via the backend's IPQualityScore
 *                   proxy — see services/phonerisk.py) and found to be high-risk. Per-device only;
 *                   nothing here is shared with other Apollo users in this build (see PRD).
 * A number in `block` or `autoRisky` causes a rejection REQUEST. Android supplies no separate
 * completion receipt here. The record is unverified and must never represent a packet drop.
 * Every other number rings completely
 * normally; Apollo never delays or silences a call based on a guess. Unknown numbers with no local
 * signal are queued (bounded, deduped) for the app to look up next time it's open — the 3rd-party
 * reputation lookup itself is too slow/unreliable to run inside this service's ~5 s response window.
 */
class ApolloCallScreeningService : CallScreeningService() {

  companion object {
    private const val PREFS = "apollo_callguard"
    private const val KEY_BLOCK = "block_numbers"
    private const val KEY_ALLOW = "allow_numbers"
    private const val KEY_AUTO_RISKY = "auto_risky_numbers"
    private const val KEY_PENDING = "pending_lookup_queue"
    private const val KEY_SEEN_PENDING = "seen_pending_numbers"
    private const val MAX_EVIDENCE = 50
    private const val MAX_PENDING = 20
    private const val MAX_SEEN_PENDING = 300

    private val evidenceLog = ArrayDeque<EnforcementEvidence>()
    fun recentEvidence(): List<EnforcementEvidence> = synchronized(evidenceLog) { evidenceLog.toList() }
    private fun recordEvidence(ev: EnforcementEvidence) = synchronized(evidenceLog) {
      evidenceLog.addLast(ev); while (evidenceLog.size > MAX_EVIDENCE) evidenceLog.removeFirst()
    }

    /** Digits and a leading '+' only — good enough for exact-match comparison without a full E.164 parse. */
    fun normalized(number: String?): String = (number ?: "").filter { it.isDigit() || it == '+' }

    /** E.164 canonicalization via Android's bundled PhoneNumberUtils + TelephonyManager country.
     * Returns cleaned digits if the platform cannot resolve a country or the number is unparseable. */
    fun toE164(raw: String?, ctx: Context): String {
      val stripped = normalized(raw)
      if (stripped.isBlank()) return ""
      if (stripped.startsWith("+") && stripped.length > 4) return stripped  // already international
      val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      val iso = (tm?.networkCountryIso ?: tm?.simCountryIso ?: "").uppercase()
      if (iso.isBlank()) return stripped
      return PhoneNumberUtils.formatNumberToE164(stripped, iso) ?: stripped
    }

    fun isRoleHeld(ctx: Context): Boolean {
      val rm = ctx.getSystemService(Context.ROLE_SERVICE) as? RoleManager ?: return false
      return try { rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) } catch (_: Exception) { false }
    }
    fun isRoleAvailable(ctx: Context): Boolean {
      val rm = ctx.getSystemService(Context.ROLE_SERVICE) as? RoleManager ?: return false
      return try { rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) } catch (_: Exception) { false }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun loadSet(ctx: Context, key: String): Set<String> = prefs(ctx).getStringSet(key, emptySet()) ?: emptySet()
    fun addToSet(ctx: Context, key: String, number: String) {
      val set = loadSet(ctx, key).toMutableSet(); set.add(toE164(number, ctx))
      prefs(ctx).edit().putStringSet(key, set).apply()
    }
    fun removeFromSet(ctx: Context, key: String, number: String) {
      val set = loadSet(ctx, key).toMutableSet(); set.remove(toE164(number, ctx))
      prefs(ctx).edit().putStringSet(key, set).apply()
    }
    fun markRisky(ctx: Context, number: String) = addToSet(ctx, KEY_AUTO_RISKY, number)

    fun blockAllowJson(ctx: Context): JSONObject = JSONObject()
      .put("block", JSONArray(loadSet(ctx, KEY_BLOCK).toList()))
      .put("allow", JSONArray(loadSet(ctx, KEY_ALLOW).toList()))
      .put("autoRisky", JSONArray(loadSet(ctx, KEY_AUTO_RISKY).toList()))

    private const val MAX_RETRY_ATTEMPTS = 4

    /** Numbers seen ringing with no local signal — non-destructive read.
     * Auto-purges entries that have exceeded [MAX_RETRY_ATTEMPTS].
     * Caller must acknowledge individual numbers after successful processing via [acknowledgePendingLookups]
     * or mark them failed via [retryPendingLookup]. */
    fun readPendingLookups(ctx: Context): JSONArray {
      val p = prefs(ctx)
      val raw = p.getString(KEY_PENDING, null) ?: return JSONArray()
      val queue = try { JSONArray(raw) } catch (_: Exception) { return JSONArray() }
      val live = JSONArray()
      var purged = false
      for (i in 0 until queue.length()) {
        val entry = queue.optJSONObject(i) ?: continue
        if (entry.optInt("attempts", 0) >= MAX_RETRY_ATTEMPTS) { purged = true; continue }
        live.put(entry)
      }
      if (purged) {
        if (live.length() == 0) p.edit().remove(KEY_PENDING).apply()
        else p.edit().putString(KEY_PENDING, live.toString()).apply()
      }
      return live
    }

    /** Remove successfully processed numbers from the pending queue. Numbers not in the queue are ignored. */
    fun acknowledgePendingLookups(ctx: Context, numbers: List<String>) {
      if (numbers.isEmpty()) return
      val p = prefs(ctx)
      val raw = p.getString(KEY_PENDING, null) ?: return
      val queue = try { JSONArray(raw) } catch (_: Exception) { return }
      val ackSet = numbers.toSet()
      val remaining = JSONArray()
      for (i in 0 until queue.length()) {
        val entry = queue.optJSONObject(i) ?: continue
        if (entry.optString("number") !in ackSet) remaining.put(entry)
      }
      if (remaining.length() == 0) p.edit().remove(KEY_PENDING).apply()
      else p.edit().putString(KEY_PENDING, remaining.toString()).apply()
    }

    /** Increment the retry counter for numbers that failed processing. Entries exceeding
     * [MAX_RETRY_ATTEMPTS] are purged on the next [readPendingLookups] call. */
    fun retryPendingLookup(ctx: Context, numbers: List<String>) {
      if (numbers.isEmpty()) return
      val p = prefs(ctx)
      val raw = p.getString(KEY_PENDING, null) ?: return
      val queue = try { JSONArray(raw) } catch (_: Exception) { return }
      val retrySet = numbers.toSet()
      val updated = JSONArray()
      for (i in 0 until queue.length()) {
        val entry = queue.optJSONObject(i) ?: continue
        if (entry.optString("number") in retrySet) {
          entry.put("attempts", entry.optInt("attempts", 0) + 1)
        }
        updated.put(entry)
      }
      p.edit().putString(KEY_PENDING, updated.toString()).apply()
    }

    private fun queuePendingLookup(ctx: Context, number: String) {
      val p = prefs(ctx)
      val seen = p.getStringSet(KEY_SEEN_PENDING, emptySet()) ?: emptySet()
      if (number in seen) return
      val queue = try { JSONArray(p.getString(KEY_PENDING, null) ?: "[]") } catch (_: Exception) { JSONArray() }
      queue.put(JSONObject().put("number", number).put("seenAtMs", System.currentTimeMillis()).put("attempts", 0))
      val trimmed = if (queue.length() > MAX_PENDING) {
        val arr = JSONArray(); for (i in (queue.length() - MAX_PENDING) until queue.length()) arr.put(queue.get(i)); arr
      } else queue
      val trimmedSeen = if (seen.size > MAX_SEEN_PENDING) seen.toList().takeLast(MAX_SEEN_PENDING).toSet() + number else seen + number
      p.edit().putString(KEY_PENDING, trimmed.toString()).putStringSet(KEY_SEEN_PENDING, trimmedSeen).apply()
    }
  }

  override fun onScreenCall(callDetails: Call.Details) {
    val ctx = applicationContext
    try {
      val number = toE164(callDetails.handle?.schemeSpecificPart, ctx)
      if (number.isBlank()) { respond(callDetails, disallow = false, reject = false); return }
      if (number in loadSet(ctx, KEY_ALLOW)) { respond(callDetails, disallow = false, reject = false); return }

      val block = loadSet(ctx, KEY_BLOCK)
      val risky = loadSet(ctx, KEY_AUTO_RISKY)
      if (number in block || number in risky) {
        respond(callDetails, disallow = true, reject = true, skipNotification = true)
        // Record evidence honestly: a rejection REQUEST was issued but Android provides no completion
        // receipt confirming the call was actually blocked. The evidence is "rejection_requested",
        // not "verified" — the caller may still reach voicemail or the system may override the request.
        recordEvidence(EnforcementEvidence.verifiedCallBlock(
          evidenceId = UUID.randomUUID().toString(), observedAt = Instant.now().toString(), number = number,
          ruleSource = if (number in block) "user_override" else "cloud_intel",
          osVersion = "Android ${android.os.Build.VERSION.RELEASE}", sdkVersion = ApolloDnsVpnService.MODULE_VERSION,
        ).copy(result = "rejection_requested", enforcedAction = "reject_requested", destinationDomain = null, matchedRuleId = "call_local_rule"))
        return
      }
      // No local signal at all — let it ring normally, and queue for a background reputation lookup.
      // A5: For numbers with no local signal, we still allow the call to ring (no silencing by default).
      // Silencing unidentified callers is a device-level setting (Android: Settings → Phone → Caller ID
      // & spam → "Filter spam calls"; iOS: Settings → Phone → Silence Unknown Callers) that the person
      // controls independently. Apollo does not claim silencing as its own action and preserves the
      // missed-call record (setSkipCallLog=false) so the person can review and check the number later.
      respond(callDetails, disallow = false, reject = false)
      queuePendingLookup(ctx, number)
    } catch (_: Exception) {
      // Never let a screening failure hang up a real call — always fall through to allow.
      respond(callDetails, disallow = false, reject = false)
    }
  }

  private fun respond(details: Call.Details, disallow: Boolean, reject: Boolean, skipNotification: Boolean = false) {
    val response = CallResponse.Builder()
      .setDisallowCall(disallow)
      .setRejectCall(reject)
      .setSkipNotification(skipNotification)
      .setSkipCallLog(false)
      .build()
    respondToCall(details, response)
  }
}
