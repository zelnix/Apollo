package com.hucentai.apollosecurity

import android.content.SharedPreferences
import org.json.JSONArray

internal interface EvidencePersistence {
  fun load(): List<String>
  fun save(records: List<String>): Boolean
  fun loadOverflow(): Int
  fun saveOverflow(value: Int): Boolean
}

internal class SharedPreferencesEvidencePersistence(private val prefs: SharedPreferences) : EvidencePersistence {
  override fun load(): List<String> {
    val array = JSONArray(prefs.getString(KEY_RECORDS, "[]"))
    return (0 until array.length()).map { array.getJSONObject(it).toString() }
  }
  override fun save(records: List<String>): Boolean {
    val array = JSONArray(); records.forEach { array.put(org.json.JSONObject(it)) }
    return prefs.edit().putString(KEY_RECORDS, array.toString()).commit()
  }
  override fun loadOverflow(): Int = prefs.getInt(KEY_OVERFLOW, 0)
  override fun saveOverflow(value: Int): Boolean = prefs.edit().putInt(KEY_OVERFLOW, value).commit()

  companion object {
    private const val KEY_RECORDS = "pending_evidence_v2"
    private const val KEY_OVERFLOW = "evidence_overflow_v2"
  }
}

internal data class EvidenceInboxStatus(val pending: Int, val capacity: Int, val overflow: Int, val error: String?)

internal class BoundedEvidenceInbox(
  private val capacity: Int,
  private val persistence: EvidencePersistence,
  private val idOf: (String) -> String?,
) {
  @Volatile private var lastError: String? = null

  @Synchronized fun records(): List<String> = safeLoad()

  @Synchronized fun append(record: String): Boolean {
    val records = safeLoad()
    val id = idOf(record) ?: return fail("Native evidence failed bridge validation")
    if (records.any { idOf(it) == id }) return true
    if (records.size >= capacity) {
      val overflow = safeOverflow() + 1
      if (!safe { persistence.saveOverflow(overflow) }) fail("Native evidence inbox overflow could not be persisted")
      else lastError = "Native evidence inbox is full; a new packet record was not persisted"
      return false
    }
    if (!safe { persistence.save(records + record) }) return fail("Native evidence persistence failed")
    lastError = null
    return true
  }

  @Synchronized fun acknowledge(ids: Set<String>): Int {
    val current = safeLoad(); val kept = current.filterNot { idOf(it) in ids }
    if (!safe { persistence.save(kept) }) { fail("Native evidence acknowledgement persistence failed"); return 0 }
    lastError = null
    return current.size - kept.size
  }

  @Synchronized fun status(): EvidenceInboxStatus = EvidenceInboxStatus(safeLoad().size, capacity, safeOverflow(), lastError)
  fun reportFailure(message: String) { lastError = message }

  private fun safeLoad(): List<String> = try { persistence.load() } catch (_: Throwable) { fail("Native evidence storage is unreadable"); emptyList() }
  private fun safeOverflow(): Int = try { persistence.loadOverflow() } catch (_: Throwable) { fail("Native evidence overflow state is unreadable"); 0 }
  private fun safe(action: () -> Boolean): Boolean = try { action() } catch (_: Throwable) { false }
  private fun fail(message: String): Boolean { lastError = message; return false }
}