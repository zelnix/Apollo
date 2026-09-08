package com.guarddog.vpn

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.protection.ProtectionEnforcementReporter
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.InetAddress

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

    // --- Gate Guard M2 Website Gate: all additive, all optional. Leaving [websiteGateEngine] or
    // [websiteGateRouteConfig] null (the default) means M2 is fully disabled and the service
    // behaves bit-for-bit as it did before this feature -- no DNS gateway, no sinkhole routes,
    // no addDnsServer call. Wired by the bridge in Phase 5; the plumbing itself lives here. ---
    @Volatile var websiteGateEngine: GuardDogSDKEngine? = null
    @Volatile var websiteGateRouteConfig: WebsiteGateRouteConfig? = null
    @Volatile var upstreamDnsResolverIpv4: String? = null
    @Volatile var websiteGateBindingLifetimeMillis: Long = 30_000L
    /** Local, on-device, reversible ALLOW-only overrides (see [WebsiteGateOverrideStore]); pushed
     * by the bridge from its own durable store, re-hydrated each session. Never null: the default
     * is the no-op store, so a bridge that never touches this behaves exactly as if it didn't exist. */
    @Volatile var websiteGateOverrideStore: WebsiteGateOverrideStore = NoWebsiteGateOverrides
    /** True only while a live TUN session actually constructed the DNS gateway pipeline (see
     * [GuardDogVpnService.establish]) -- the truthful "is Website Gate currently enforcing" signal
     * the bridge reports, never assumed merely because [websiteGateRouteConfig]/[websiteGateEngine]
     * happen to be configured. */
    @Volatile var websiteGateActive: Boolean = false
        internal set
}

/**
 * Android VpnService performing the M1 selective block, plus (additively) the Gate Guard M2
 * Website Gate DNS/sinkhole pipeline when the runtime is configured for it.
 *
 * Observed traffic path: IPv4 packets whose destination is the DNS/IP-verified dedicated
 * controlled IPv4 (M1), or one of the fixed M2 sinkhole pool addresses, routed to TUN by an
 * explicit /32 route, read from the TUN fd, parsed, intentionally dropped, deduped, reported as
 * evidence. A packet addressed to the fixed M2 virtual DNS endpoint is serviced (synthesized
 * sinkhole answer, NXDOMAIN, or untouched upstream forward) rather than dropped -- the only
 * packets this service ever writes back into the tunnel. Not covered: any other destination,
 * DoH/DoT, QUIC visibility, per-app attribution.
 */
class GuardDogVpnService : VpnService() {
    private val state = VpnStateRepository.shared
    private var session: TunSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val bindingCheck = OffThreadBindingCheck()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopProtection("stopped by user"); return START_NOT_STICKY }
            ACTION_START -> startProtection()
            // null intent = the system re-delivered a start after the process died (in-memory runtime is gone). Fail closed, explicitly.
            null -> fail("service restarted by the system without a live runtime (process died during start)")
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

        // DNS/IP binding re-check immediately before route install. Mismatch aborts. The lookup runs OFF the main thread
        // (NetworkOnMainThreadException otherwise — crashed the proof phone); the outcome is applied back on the main thread.
        bindingCheck.run(config, GuardDogVpnRuntime.resolver) { binding ->
            mainHandler.post {
                if (state.lifecycle != VpnLifecycleState.Starting) return@post // stopped/revoked/destroyed while resolving
                when (binding) {
                    is BindingResult.Match -> establish(config, reporter, binding.ipv4)
                    is BindingResult.Mismatch -> fail("DNS/IP binding mismatch: expected ${binding.expected}, resolved ${binding.resolved}")
                    is BindingResult.ResolutionFailed -> fail("controlled host did not resolve: ${binding.host}")
                }
            }
        }
    }

    private fun establish(config: VpnConfig, reporter: ProtectionEnforcementReporter, verifiedIpv4: String) {
        val websiteGateConfig = GuardDogVpnRuntime.websiteGateRouteConfig
        val websiteGateEngine = GuardDogVpnRuntime.websiteGateEngine
        val spec = if (websiteGateConfig != null) {
            SelectiveRouteInstaller.buildWebsiteGateSpec(config, verifiedIpv4, websiteGateConfig)
        } else {
            SelectiveRouteInstaller.buildSpec(config, verifiedIpv4)
        }
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
        // Gate Guard M2 Website Gate: null websiteGateConfig means the authorizer stays null too,
        // so PacketDropReporter's matching logic is bit-for-bit the M1-only check (see PacketDropReporter.onPacket).
        val websiteGateAuthorizer = websiteGateConfig?.let { WebsiteGatePacketAuthorizer(verifiedIpv4, it.sinkholePool.toSet()) }
        val dropReporter = PacketDropReporter(verifiedIpv4, deduper, reporter, SystemClock, websiteGateAuthorizer)
        GuardDogVpnRuntime.dropReporter = dropReporter

        // Gate Guard M2 Website Gate DNS pipeline: only constructed when BOTH a route config AND a
        // live shared-core engine are wired in. Either missing means dnsGateway stays null, and
        // TunPacketReader's read loop is exactly the M1 loop (no writes back into the tunnel at all).
        val dnsGateway = if (websiteGateConfig != null && websiteGateEngine != null) {
            val bindingStore = SinkholeBindingStore(
                websiteGateEngine, websiteGateConfig.sinkholePool, GuardDogVpnRuntime.websiteGateBindingLifetimeMillis, SystemClock,
                GuardDogVpnRuntime.websiteGateOverrideStore,
            )
            val upstream = GuardDogVpnRuntime.upstreamDnsResolverIpv4
            val forwarder: UpstreamDnsForwarder = if (upstream != null) {
                ProtectedUdpDnsForwarder(InetAddress.getByName(upstream), protector = SocketProtector { socket -> protect(socket) })
            } else {
                UpstreamDnsForwarder { _, _, _ -> null } // no upstream configured: fail open by silence
            }
            DnsGatewayPacketHandler(bindingStore, forwarder) { reason -> Log.d(TAG, "DNS gateway pass-through: $reason") }
        } else {
            null
        }

        val tunReader = TunPacketReader(
            input = FileInputStream(pfd.fileDescriptor),
            dropReporter = dropReporter,
            onError = { e: IOException ->
                Log.w(TAG, "TUN read failed: ${e.message}")
                state.transition(VpnLifecycleState.Degraded("TUN read error"))
            },
            output = if (dnsGateway != null) FileOutputStream(pfd.fileDescriptor) else null,
            dnsGatewayIpv4 = websiteGateConfig?.dnsGatewayIpv4,
            dnsGateway = dnsGateway,
        )
        // Retain the ParcelFileDescriptor inside the session; close() releases it exactly once.
        session = TunSession(pfd, tunReader, Thread(tunReader, "guarddog-tun-reader")) {
            GuardDogVpnRuntime.dropReporter = null
            GuardDogVpnRuntime.activeSession = null
            GuardDogVpnRuntime.websiteGateActive = false
        }.also { it.start() }
        GuardDogVpnRuntime.activeSession = session
        // Truthful signal for the bridge: only true because this exact session actually built the
        // DNS gateway pipeline above, never merely because config/engine happen to be set.
        GuardDogVpnRuntime.websiteGateActive = dnsGateway != null
        val running = VpnLifecycleState.Running(System.currentTimeMillis(), spec.routes[0].cidr)
        state.transition(running)
        startForegroundCompat(ProtectionNotificationFactory.build(this, running))
        Log.i(TAG, "Selective route installed: ${spec.routes.map { it.cidr }} (dnsGateway=${dnsGateway != null})")
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
        GuardDogVpnRuntime.websiteGateActive = false
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
