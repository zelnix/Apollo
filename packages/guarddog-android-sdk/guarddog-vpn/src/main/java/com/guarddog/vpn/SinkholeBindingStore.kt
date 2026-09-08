package com.guarddog.vpn

import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.WebsiteGateAuthorization
import com.guarddog.core.clock.Clock
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Gate Guard M2 Website Gate: owns the fixed, pre-provisioned sinkhole pool on the adapter side and
 * arms short-lived `WebsiteGateBinding`s in [engine] from real DNS observations only.
 *
 * Never itself produces evidence or emits anything: arming a binding is authorization input (see
 * `GuardDogSDKEngine.authorizeWebsiteGateTarget`), not enforcement. A null return here means the
 * engine rejected the arming (no accepted M2 bundle, host not matched, rule action isn't `block`,
 * etc.) -- the caller must then fail open and forward the query upstream untouched.
 *
 * Assignment is per-host sticky (a still-blocked host reuses its previously assigned sinkhole IP
 * instead of needlessly rotating) with a free-slot-preferring round robin fallback. Disclosed
 * limitation: with a pool this small, two DIFFERENT hosts blocked at the same moment can
 * momentarily contend for the same slot; the short TTL bounds the window, and worst case is a
 * mis-attributed (not a missed or over-claimed) block -- the core invariant that DNS alone never
 * blocks, and only a real dropped packet against a live binding does, is unaffected either way.
 */
class SinkholeBindingStore(
    private val engine: GuardDogSDKEngine,
    private val sinkholePool: List<String>,
    private val bindingLifetimeMillis: Long,
    private val clock: Clock,
) {
    init {
        require(sinkholePool.isNotEmpty()) { "sinkhole pool must not be empty" }
        require(bindingLifetimeMillis > 0) { "bindingLifetimeMillis must be positive" }
    }

    private val hostToIp = ConcurrentHashMap<String, String>()
    private val nextIndex = AtomicInteger(0)

    /** Arms (or refreshes) a binding for [host]. Returns the sinkhole IPv4 to answer the DNS query
     * with, or null if [engine] rejected the arming -- the caller must forward upstream instead. */
    fun arm(host: String): String? {
        val now = clock.nowEpochMillis()
        val expiresAt = now + bindingLifetimeMillis
        val sticky = hostToIp[host]?.takeIf { engine.currentWebsiteGateBinding(it)?.host == host }
        val candidateIp = sticky ?: nextAvailableIp(now)
        return when (val result = engine.authorizeWebsiteGateTarget(host, candidateIp, expiresAt)) {
            is WebsiteGateAuthorization.Bound -> {
                hostToIp[host] = result.binding.sinkholeIpv4
                result.binding.sinkholeIpv4
            }
            is WebsiteGateAuthorization.Rejected -> null
        }
    }

    /** Prefers a slot with no live (or already-expired) binding at all; otherwise round robin. */
    private fun nextAvailableIp(now: Long): String {
        for (i in sinkholePool.indices) {
            val candidate = sinkholePool[Math.floorMod(nextIndex.getAndIncrement(), sinkholePool.size)]
            val existing = engine.currentWebsiteGateBinding(candidate)
            if (existing == null || existing.expiresAtEpochMillis <= now) return candidate
        }
        return sinkholePool[Math.floorMod(nextIndex.getAndIncrement(), sinkholePool.size)]
    }
}
