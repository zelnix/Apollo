package com.guarddog.vpn

import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.WebsiteGateAuthorization
import com.guarddog.core.clock.Clock
import com.guarddog.core.events.DnsThreatObservation
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Callback interface for DNS threat observations. Invoked when a DNS query for a hostname
 * matching an active BLOCK rule is successfully answered with a sinkhole address.
 * This is a DETECTION callback — it must never claim enforcement occurred.
 */
fun interface DnsThreatObservedListener {
    fun onDnsThreatObserved(observation: DnsThreatObservation)
}

/**
 * Gate Guard M2 Website Gate: owns the fixed, pre-provisioned sinkhole pool on the adapter side and
 * arms short-lived `WebsiteGateBinding`s in [engine] from real DNS observations only.
 *
 * Arming a binding is authorization input (see `GuardDogSDKEngine.authorizeWebsiteGateTarget`),
 * not enforcement. When a binding IS armed, this store fires [onThreatObserved] to record the
 * genuine DNS-level observation separately from any subsequent packet-drop enforcement evidence.
 */
class SinkholeBindingStore(
    private val engine: GuardDogSDKEngine,
    private val sinkholePool: List<String>,
    private val bindingLifetimeMillis: Long,
    private val clock: Clock,
    private val overrideStore: WebsiteGateOverrideStore = NoWebsiteGateOverrides,
    private val onThreatObserved: DnsThreatObservedListener? = null,
    /** Deduplication window in millis — repeated observations for the same hostname within this
     *  window fire the listener only once. Default: 5 minutes. */
    private val observationDedupeWindowMillis: Long = 300_000L,
) {
    init {
        require(sinkholePool.isNotEmpty()) { "sinkhole pool must not be empty" }
        require(bindingLifetimeMillis > 0) { "bindingLifetimeMillis must be positive" }
    }

    private val hostToIp = ConcurrentHashMap<String, String>()
    private val nextIndex = AtomicInteger(0)
    /** Per-hostname deduplication: tracks the last observation timestamp to avoid flooding. */
    private val lastObservedAt = ConcurrentHashMap<String, Long>()

    /** Arms (or refreshes) a binding for [host]. Returns the sinkhole IPv4 to answer the DNS query
     * with, or null if [engine] rejected the arming (or a local user ALLOW override is present --
     * see [WebsiteGateOverrideStore]) -- the caller must forward upstream instead. */
    fun arm(host: String): String? {
        if (overrideStore.overrideFor(host) == WebsiteGateOverrideDecision.ALLOW) return null
        val now = clock.nowEpochMillis()
        val expiresAt = now + bindingLifetimeMillis
        val sticky = hostToIp[host]?.takeIf { engine.currentWebsiteGateBinding(it)?.host == host }
        val candidateIp = sticky ?: nextAvailableIp(now, host)
        // If no IP could be found without displacing an active binding for a different host,
        // fail open rather than risk mis-attribution.
        candidateIp ?: return null
        return when (val result = engine.authorizeWebsiteGateTarget(host, candidateIp, expiresAt)) {
            is WebsiteGateAuthorization.Bound -> {
                hostToIp[host] = result.binding.sinkholeIpv4
                emitObservation(host, result.binding.sinkholeIpv4, result.binding.ruleId, result.binding.rulesetId, now)
                result.binding.sinkholeIpv4
            }
            is WebsiteGateAuthorization.Rejected -> null
        }
    }

    /** Fires the DnsThreatObservedListener (if set) for a successful BLOCK arming, with deduplication. */
    private fun emitObservation(host: String, sinkholeIpv4: String, ruleId: String?, rulesetId: String?, nowMillis: Long) {
        val listener = onThreatObserved ?: return
        val last = lastObservedAt[host]
        if (last != null && nowMillis - last < observationDedupeWindowMillis) return
        lastObservedAt[host] = nowMillis
        pruneObservationHistory(nowMillis)
        val observation = DnsThreatObservation(
            observationId = "dns-obs-${host}-${nowMillis}",
            hostname = host,
            ruleId = ruleId,
            rulesetId = rulesetId,
            observedAt = Instant.ofEpochMilli(nowMillis).toString(),
            sinkholeIpv4 = sinkholeIpv4,
        )
        try { listener.onDnsThreatObserved(observation) } catch (_: Throwable) { /* never crash the DNS handler for an observation failure */ }
    }

    private fun pruneObservationHistory(now: Long) {
        val it = lastObservedAt.entries.iterator()
        while (it.hasNext()) if (now - it.next().value >= observationDedupeWindowMillis * 2) it.remove()
    }

    /** Prefers a slot with no live (or already-expired) binding at all; refuses to overwrite a live
     * binding for a DIFFERENT host to prevent mis-attribution. Returns null on pool exhaustion. */
    private fun nextAvailableIp(now: Long, requestingHost: String): String? {
        // First pass: look for a free or expired slot.
        for (i in sinkholePool.indices) {
            val candidate = sinkholePool[Math.floorMod(nextIndex.getAndIncrement(), sinkholePool.size)]
            val existing = engine.currentWebsiteGateBinding(candidate)
            if (existing == null || existing.expiresAtEpochMillis <= now) return candidate
        }
        // Pool exhausted: every slot has a live binding. Return null to fail open — never overwrite
        // a different host's active binding, as that would cause mis-attributed blocks.
        return null
    }
}
