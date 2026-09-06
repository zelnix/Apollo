package com.guarddog.core.rules

import java.util.concurrent.ConcurrentHashMap

/**
 * Rollback protection: persists the highest accepted bundleVersion per rulesetId.
 * A correctly signed older (or equal) version must be rejected.
 * Core ships an in-memory implementation; the Expo Android module provides a
 * SharedPreferences-backed one (core stays platform-agnostic).
 */
interface BundleVersionStore {
    fun highestAccepted(rulesetId: String): Long?
    fun recordAccepted(rulesetId: String, bundleVersion: Long)
}

class InMemoryBundleVersionStore : BundleVersionStore {
    private val versions = ConcurrentHashMap<String, Long>()

    override fun highestAccepted(rulesetId: String): Long? = versions[rulesetId]

    override fun recordAccepted(rulesetId: String, bundleVersion: Long) {
        versions.merge(rulesetId, bundleVersion) { old, new -> maxOf(old, new) }
    }
}
