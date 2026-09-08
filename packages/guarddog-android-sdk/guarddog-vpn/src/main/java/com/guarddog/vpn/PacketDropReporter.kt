package com.guarddog.vpn

import com.guarddog.core.clock.Clock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.protection.ProtectionEnforcementReporter
import java.util.UUID

/** Counters exposed for the proof harness / tests. */
/**
 * `unexpectedPackets` = nonIpv4 + malformedIpv4 + wrongDestinationIpv4. Counts only — never destination addresses.
 * A non-zero `wrongDestinationIpv4` means an IPv4 packet for some other destination entered the /32-only TUN (route leak → blocker).
 */
data class DropStats(
    val observedMatching: Long, val droppedMatching: Long, val reportedBlocks: Long, val dedupedRetries: Long, val unexpectedPackets: Long,
    val nonIpv4: Long = 0, val malformedIpv4: Long = 0, val wrongDestinationIpv4: Long = 0,
)

/**
 * The ONLY producer of [BlockedThreatEvidence]. Invoked by [TunPacketReader] for every
 * packet actually read from the TUN file descriptor. A packet whose destination equals
 * the authorized controlled IPv4 is intentionally dropped (never written anywhere) and,
 * subject to deduplication, reported to the core engine.
 */
class PacketDropReporter(
    private val controlledIpv4: String,
    private val deduper: BlockedFlowDeduper,
    private val reporter: ProtectionEnforcementReporter,
    private val clock: Clock,
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
) {
    private var observedMatching = 0L
    private var droppedMatching = 0L
    private var reportedBlocks = 0L
    private var dedupedRetries = 0L
    private var unexpectedPackets = 0L
    private var nonIpv4 = 0L
    private var malformedIpv4 = 0L
    private var wrongDestinationIpv4 = 0L

    enum class Decision { DROP_MATCHING, DROP_UNEXPECTED }

    @Synchronized
    fun onPacket(info: Ipv4PacketInfo?): Decision = onPacket(info, Ipv4PacketParser.Kind.IPV4)

    /** [kind] classifies why a packet did not parse (from Ipv4PacketParser.classify) so unexpected traffic is diagnosable without logging addresses. */
    @Synchronized
    fun onPacket(info: Ipv4PacketInfo?, kind: Ipv4PacketParser.Kind): Decision {
        if (info == null || info.destinationIpv4 != controlledIpv4) {
            // Only controlledIpv4/32 is routed here; anything else is noise we cannot forward
            // (no forwarding engine in M1). Discarded and counted by category, never reported as a block.
            unexpectedPackets++
            when {
                info != null -> wrongDestinationIpv4++
                kind == Ipv4PacketParser.Kind.NON_IPV4 -> nonIpv4++
                else -> malformedIpv4++
            }
            return Decision.DROP_UNEXPECTED
        }
        observedMatching++
        droppedMatching++ // the caller never forwards: dropping == not writing the packet anywhere
        if (!deduper.shouldReport(info.flowKey)) {
            dedupedRetries++
            return Decision.DROP_MATCHING
        }
        reportedBlocks++
        reporter.reportBlockedPacket(
            BlockedThreatEvidence(
                enforcementEvidenceId = idGenerator(),
                destinationIpv4 = info.destinationIpv4,
                destinationPort = info.destinationPort,
                sourcePort = info.sourcePort,
                ipProtocol = info.protocol,
                packetLength = info.totalLength,
                observedAtEpochMillis = clock.nowEpochMillis(),
                flowKey = info.flowKey,
            ),
        )
        return Decision.DROP_MATCHING
    }

    @Synchronized
    fun stats(): DropStats = DropStats(observedMatching, droppedMatching, reportedBlocks, dedupedRetries, unexpectedPackets, nonIpv4, malformedIpv4, wrongDestinationIpv4)
}
