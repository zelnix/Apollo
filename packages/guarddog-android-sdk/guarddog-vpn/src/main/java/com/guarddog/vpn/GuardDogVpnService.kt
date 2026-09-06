package com.guarddog.vpn

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.util.Log
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.protection.ProtectionEnforcementReporter
import java.io.FileInputStream
import java.io.IOException

/**
 * Runtime wiring injected by the bridge before the service starts: the config and the
 * core enforcement reporter (the SDK engine). Keeps the service free of Expo types.
 */
object GuardDogVpnRuntime {
    @Volatile var config: VpnConfig? = null
    @Volatile var reporter: ProtectionEnforcementReporter? = null
    @Volatile var resolver: HostResolver = SystemHostResolver
    @Volatile var dropReporter: PacketDropReporter? = null
        internal set
    /** The live TUN session while enforcing; null once closed. Read by the recovery proof. */
    @Volatile var activeSession: TunSession? = null
        internal set
}

/**
 * Android VpnService performing the M1 selective block.
 *
 * Observed traffic path (and nothing more): IPv4 packets whose destination is the
 * DNS/IP-verified dedicated controlled IPv4, routed to TUN by the /32 route, read from
 * the TUN fd, parsed, intentionally dropped, deduped, reported as evidence.
 * Not covered: any other destination, DNS, DoH/DoT, QUIC visibility, per-app attribution.
 */
class GuardDogVpnService : VpnService() {
    private val state = VpnStateRepository.shared
    private var session: TunSession? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopProtection("stopped by user"); return START_NOT_STICKY }
            ACTION_START, null -> startProtection()
        }
        return START_NOT_STICKY
    }

    private fun startProtection() {
        val config = GuardDogVpnRuntime.config
        val reporter = GuardDogVpnRuntime.reporter
        if (config == null || reporter == null) {
            fail("VPN runtime not configured (config/reporter missing)")
            return
        }
        // Foreground launch within the lifecycle window: channel + startForeground first.
        ProtectionNotificationFactory.ensureChannel(this)
        state.transition(VpnLifecycleState.Starting)
        startForegroundCompat(ProtectionNotificationFactory.build(this, VpnLifecycleState.Starting))

        if (prepare(this) != null) {
            fail("VPN consent missing at service start")
            return
        }

        // DNS/IP binding re-check immediately before route install. Mismatch aborts.
        when (val binding = ControlledEndpointResolver(config, GuardDogVpnRuntime.resolver).verifyBinding()) {
            is BindingResult.Match -> establish(config, reporter, binding.ipv4)
            is BindingResult.Mismatch -> fail("DNS/IP binding mismatch: expected ${binding.expected}, resolved ${binding.resolved}")
            is BindingResult.ResolutionFailed -> fail("controlled host did not resolve: ${binding.host}")
        }
    }

    private fun establish(config: VpnConfig, reporter: ProtectionEnforcementReporter, verifiedIpv4: String) {
        val spec = SelectiveRouteInstaller.buildSpec(config, verifiedIpv4)
        val pfd = try {
            SelectiveRouteInstaller.applyTo(Builder(), spec).establish()
        } catch (e: IllegalStateException) {
            null
        } catch (e: SecurityException) {
            null
        }
        if (pfd == null) {
            fail("establish() returned null (consent revoked or another VPN active)")
            return
        }
        val deduper = BlockedFlowDeduper(config.dedupeWindowMillis, SystemClock)
        val dropReporter = PacketDropReporter(verifiedIpv4, deduper, reporter, SystemClock)
        GuardDogVpnRuntime.dropReporter = dropReporter
        val tunReader = TunPacketReader(FileInputStream(pfd.fileDescriptor), dropReporter) { e: IOException ->
            Log.w(TAG, "TUN read failed: ${e.message}")
            state.transition(VpnLifecycleState.Degraded("TUN read error"))
        }
        // Retain the ParcelFileDescriptor inside the session; close() releases it exactly once.
        session = TunSession(pfd, tunReader, Thread(tunReader, "guarddog-tun-reader")) {
            GuardDogVpnRuntime.dropReporter = null
            GuardDogVpnRuntime.activeSession = null
        }.also { it.start() }
        GuardDogVpnRuntime.activeSession = session
        val running = VpnLifecycleState.Running(System.currentTimeMillis(), spec.routes[0].cidr)
        state.transition(running)
        startForegroundCompat(ProtectionNotificationFactory.build(this, running))
        Log.i(TAG, "Selective route installed: ${spec.routes[0].cidr} (only)")
    }

    override fun onRevoke() {
        cleanup()
        state.transition(VpnLifecycleState.Revoked)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        cleanup()
        if (state.lifecycle.isEnforcing || state.lifecycle == VpnLifecycleState.Starting) {
            state.transition(VpnLifecycleState.Stopped("service destroyed"))
        }
        super.onDestroy()
    }

    private fun stopProtection(reason: String) {
        cleanup()
        state.transition(VpnLifecycleState.Stopped(reason))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun fail(reason: String) {
        Log.w(TAG, "protection start aborted: $reason")
        cleanup()
        state.transition(VpnLifecycleState.Failed(reason))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /** Retain and correctly close the ParcelFileDescriptor; stop the reader thread (idempotent). */
    private fun cleanup() {
        session?.close()
        session = null
        GuardDogVpnRuntime.dropReporter = null
        GuardDogVpnRuntime.activeSession = null
    }

    private fun startForegroundCompat(notification: android.app.Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ProtectionNotificationFactory.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        } else {
            startForeground(ProtectionNotificationFactory.NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val TAG = "GuardDogVpn"
        const val ACTION_START = "com.guarddog.vpn.action.START"
        const val ACTION_STOP = "com.guarddog.vpn.action.STOP"
    }
}
