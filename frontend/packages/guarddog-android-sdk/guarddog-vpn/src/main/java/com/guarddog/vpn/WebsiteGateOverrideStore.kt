package com.guarddog.vpn

import com.guarddog.core.net.HostCanonicalizer
import java.util.concurrent.ConcurrentHashMap

/**
 * Gate Guard M2 Website Gate: a user's local, on-device decision about a specific host,
 * independent of the signed rule bundle.
 *
 * ALLOW is deliberately the ONLY override this phase supports: it can only PREVENT a sinkhole
 * arming that the rule bundle would otherwise trigger for that host (see [SinkholeBindingStore.arm]) --
 * it can never, by itself, arm a binding or produce a THREAT_BLOCKED. There is intentionally no
 * BLOCK override: only the signed, verified rule authority chain
 * (`GuardDogSDKEngine.authorizeWebsiteGateTarget`) may ever arm a binding that can lead to
 * enforcement evidence. This keeps local overrides safe to expose to the user as fully reversible
 * and auditable, with zero risk of fabricating evidence or bypassing the rule authority chain.
 */
enum class WebsiteGateOverrideDecision { ALLOW, NONE }

fun interface WebsiteGateOverrideStore {
    fun overrideFor(host: String): WebsiteGateOverrideDecision
}

/** M1-equivalent default: no overrides configured. This is the ONLY thing that makes the new
 * [SinkholeBindingStore] constructor parameter additive -- every Phase 4 caller that doesn't pass
 * an override store gets this, and [SinkholeBindingStore.arm] behaves bit-for-bit as it did before
 * this phase. */
object NoWebsiteGateOverrides : WebsiteGateOverrideStore {
    override fun overrideFor(host: String) = WebsiteGateOverrideDecision.NONE
}

/**
 * Simple in-memory, thread-safe, mutable override cache -- the fast runtime store the DNS pipeline
 * consults synchronously on the TUN read thread. The durable, user-facing, auditable record lives
 * on the JS side (AsyncStorage, see frontend/src/sdk/websiteGateOverrides.ts); this cache is
 * rebuilt from there each app/bridge session (this object does not persist across process death,
 * exactly like [GuardDogVpnRuntime.config] is re-pushed by the bridge every session).
 *
 * All hosts are stored canonicalized (see [HostCanonicalizer]) so lookups from the DNS pipeline
 * (which always passes an already-canonical host) match reliably; a host that fails
 * canonicalization is rejected by [setAllowed] (returns false) rather than silently stored.
 */
class MutableWebsiteGateOverrideStore : WebsiteGateOverrideStore {
    private val allowedHosts = ConcurrentHashMap.newKeySet<String>()

    override fun overrideFor(host: String): WebsiteGateOverrideDecision =
        if (allowedHosts.contains(host)) WebsiteGateOverrideDecision.ALLOW else WebsiteGateOverrideDecision.NONE

    /** Returns false (and stores nothing) if [host] fails canonicalization. */
    fun setAllowed(host: String, allowed: Boolean): Boolean {
        val canonical = HostCanonicalizer.canonicalize(host) ?: return false
        if (allowed) allowedHosts.add(canonical) else allowedHosts.remove(canonical)
        return true
    }

    fun allowedHostsSnapshot(): Set<String> = allowedHosts.toSet()

    fun clear() = allowedHosts.clear()
}
