package com.hucentai.apollosecurity

import android.content.SharedPreferences
import com.guarddog.core.events.DnsThreatObservation
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bounded, persistent inbox for DNS-level threat observations — entirely separate from
 * the enforcement evidence inbox ([BoundedEvidenceInbox]). DNS observations record that
 * Apollo observed and redirected a DNS query; they never claim a block occurred.
 *
 * Thread-safe. SharedPreferences keys are deliberately distinct from enforcement evidence
 * to prevent any accidental cross-contamination.
 */
internal class ApolloDnsThreatInbox(
    private val prefs: SharedPreferences,
    private val capacity: Int = 64,
) {
    @Volatile private var lastError: String? = null

    @Synchronized
    fun append(observation: DnsThreatObservation): Boolean {
        val records = safeLoad()
        // Deduplicate by observationId.
        if (records.any { it.optString("observationId") == observation.observationId }) return true
        if (records.size() >= capacity) {
            lastError = "DNS threat observation inbox is full; a new observation was not persisted"
            return false
        }
        val record = JSONObject()
            .put("observationId", observation.observationId)
            .put("hostname", observation.hostname)
            .put("ruleId", observation.ruleId ?: JSONObject.NULL)
            .put("rulesetId", observation.rulesetId ?: JSONObject.NULL)
            .put("observedAt", observation.observedAt)
            .put("decision", observation.decision)
            .put("sinkholeIpv4", observation.sinkholeIpv4 ?: JSONObject.NULL)
            .put("coverageScope", observation.coverageScope)
            .put("evidenceType", observation.evidenceType)
        val updated = JSONArray()
        for (i in 0 until records.length()) updated.put(records.getJSONObject(i))
        updated.put(record)
        return if (safe { prefs.edit().putString(KEY_RECORDS, updated.toString()).commit() }) {
            lastError = null; true
        } else {
            lastError = "DNS threat observation persistence failed"; false
        }
    }

    @Synchronized
    fun records(): String {
        return safeLoad().toString()
    }

    @Synchronized
    fun acknowledge(ids: Set<String>): Int {
        val current = safeLoad()
        val kept = JSONArray()
        var removed = 0
        for (i in 0 until current.length()) {
            val obj = current.getJSONObject(i)
            if (obj.optString("observationId") in ids) { removed++ }
            else kept.put(obj)
        }
        if (!safe { prefs.edit().putString(KEY_RECORDS, kept.toString()).commit() }) {
            lastError = "DNS threat observation acknowledgement persistence failed"
            return 0
        }
        lastError = null
        return removed
    }

    @Synchronized
    fun status(): DnsThreatInboxStatus {
        val records = safeLoad()
        return DnsThreatInboxStatus(pending = records.length(), capacity = capacity, error = lastError)
    }

    fun reportFailure(message: String) { lastError = message }

    private fun safeLoad(): JSONArray = try {
        JSONArray(prefs.getString(KEY_RECORDS, "[]"))
    } catch (_: Throwable) {
        lastError = "DNS threat observation storage is unreadable"; JSONArray()
    }

    private fun safe(action: () -> Boolean): Boolean = try { action() } catch (_: Throwable) { false }

    companion object {
        private const val KEY_RECORDS = "pending_dns_observations_v1"
    }
}

internal data class DnsThreatInboxStatus(val pending: Int, val capacity: Int, val error: String?)
