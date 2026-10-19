package com.guarddog.core.rules

import java.util.concurrent.ConcurrentHashMap

/**
 * What the device has accepted for a rulesetId: the highest bundleVersion plus a SHA-256 content hash
 * for version conflict detection.
 */
data class AcceptedBundle(val bundleVersion: Long, val contentHash: String?)

/**
 * Rollback protection: persists the highest accepted bundle per rulesetId.
 *  - incoming version < highest              -> ROLLBACK
 *  - incoming version > highest              -> accepted, record replaces the highest
 *  - incoming version == highest, same content hash (or no prior hash) -> accepted idempotently
 *  - incoming version == highest, different content hash -> VERSION_CONFLICT
 * Core ships an in-memory implementation; the Expo Android module provides a SharedPreferences-backed one.
 */
interface BundleVersionStore {
    fun highestAccepted(rulesetId: String): AcceptedBundle?
    fun recordAccepted(rulesetId: String, bundleVersion: Long, contentHash: String?)
}

class InMemoryBundleVersionStore : BundleVersionStore {
    private val records = ConcurrentHashMap<String, AcceptedBundle>()

    override fun highestAccepted(rulesetId: String): AcceptedBundle? = records[rulesetId]

    override fun recordAccepted(rulesetId: String, bundleVersion: Long, contentHash: String?) {
        records.compute(rulesetId) { _, current -> merge(current, AcceptedBundle(bundleVersion, contentHash)) }
    }

    companion object {
        fun merge(current: AcceptedBundle?, incoming: AcceptedBundle): AcceptedBundle = when {
            current == null || incoming.bundleVersion > current.bundleVersion -> incoming
            incoming.bundleVersion == current.bundleVersion && current.contentHash == null -> AcceptedBundle(current.bundleVersion, incoming.contentHash)
            else -> current
        }
    }
}
