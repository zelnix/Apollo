package com.guarddog.vpn

/**
 * Gate Guard M2 Website Gate: merges the M1 single controlled destination with the fixed M2
 * sinkhole pool into one enumerable "is this destination one [PacketDropReporter] should treat as
 * a recognized enforcement target (never counted as unexpected)" check.
 *
 * Deliberately dumb: this class NEVER decides whether a THREAT_BLOCKED is actually emitted. That
 * is exclusively `GuardDogSDKEngine.reportBlockedPacket`'s job -- it independently checks the M1
 * `BlockAuthorization` table, then the strictly parallel M2 `WebsiteGateBinding` table, and emits
 * nothing at all if neither has a live match for the destination. This class only prevents a
 * legitimate M2 sinkhole packet from being miscounted as route-leak noise.
 */
class WebsiteGatePacketAuthorizer(
    private val controlledIpv4: String,
    private val sinkholePool: Set<String>,
) {
    init {
        require(sinkholePool.isNotEmpty()) { "sinkhole pool must not be empty" }
        require(controlledIpv4 !in sinkholePool) { "the M1 controlled endpoint must never overlap the M2 sinkhole pool" }
    }

    enum class Destination { M1_CONTROLLED, M2_SINKHOLE, UNRECOGNIZED }

    fun classify(destinationIpv4: String): Destination = when {
        destinationIpv4 == controlledIpv4 -> Destination.M1_CONTROLLED
        sinkholePool.contains(destinationIpv4) -> Destination.M2_SINKHOLE
        else -> Destination.UNRECOGNIZED
    }
}
