package com.hucentai.apollosecurity

import android.content.Context
import com.guarddog.core.rules.AcceptedBundle
import com.guarddog.core.rules.BundleVersionStore
import com.guarddog.core.rules.InMemoryBundleVersionStore

/**
 * SharedPreferences-backed BundleVersionStore for the production GuardDog runtime.
 * Uses a configurable key prefix so the production runtime's rollback state is isolated
 * from any other bundle acceptance path (e.g. guarddog-expo-module's own store).
 */
internal class ApolloBundleVersionStore(context: Context, private val prefix: String) : BundleVersionStore {
    private val prefs = context.getSharedPreferences("apollo_guarddog_bundle_versions", Context.MODE_PRIVATE)

    override fun highestAccepted(rulesetId: String): AcceptedBundle? {
        val key = "$prefix:$rulesetId"
        return if (prefs.contains(key))
            AcceptedBundle(prefs.getLong(key, 0), prefs.getString("$key.contentHash", null))
        else null
    }

    override fun recordAccepted(rulesetId: String, bundleVersion: Long, contentHash: String?) {
        val key = "$prefix:$rulesetId"
        val merged = InMemoryBundleVersionStore.merge(highestAccepted(rulesetId), AcceptedBundle(bundleVersion, contentHash))
        val editor = prefs.edit().putLong(key, merged.bundleVersion)
        if (merged.contentHash != null) editor.putString("$key.contentHash", merged.contentHash)
        else editor.remove("$key.contentHash")
        editor.apply()
    }
}
