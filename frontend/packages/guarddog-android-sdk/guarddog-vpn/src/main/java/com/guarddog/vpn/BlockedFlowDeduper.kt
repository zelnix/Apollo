package com.guarddog.vpn

import com.guarddog.core.clock.Clock

/**
 * Short-lived flow/destination deduplication. TCP SYN retries (and repeated matching
 * packets) within the window collapse into one reportable block per flow key.
 */
class BlockedFlowDeduper(private val windowMillis: Long, private val clock: Clock) {
    private val firstSeen = HashMap<String, Long>()

    @Synchronized
    fun shouldReport(flowKey: String): Boolean {
        val now = clock.nowEpochMillis()
        prune(now)
        val seen = firstSeen[flowKey]
        if (seen != null && now - seen < windowMillis) return false
        firstSeen[flowKey] = now
        return true
    }

    @Synchronized
    fun size(): Int = firstSeen.size

    private fun prune(now: Long) {
        val it = firstSeen.entries.iterator()
        while (it.hasNext()) if (now - it.next().value >= windowMillis) it.remove()
    }
}
