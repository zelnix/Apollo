package com.guarddog.expo

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.BlockAuthorization
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.events.SecurityEventType
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import com.guarddog.core.rules.VerificationResult
import com.guarddog.vpn.GuardDogVpnRuntime
import com.guarddog.vpn.RecoveryInspector
import com.guarddog.vpn.VpnConfig
import com.guarddog.vpn.VpnStateRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Physical-device acceptance (Phase 5). Requires:
 *  - instrumentation args: controlledHost, controlledIpv4, controlledUrl, bundleJson (signed by backend)
 *  - VPN consent already granted on the device (VpnService.prepare(...) == null)
 * Skipped otherwise. NOT runtime-verified in the authoring environment.
 *
 * Proves: reachable before -> signed rule accepted -> consent -> selective /32 -> packet observed on TUN
 * -> intentionally dropped -> request fails -> genuine THREAT_BLOCKED (with enforcementEvidenceId) -> bridge record
 * -> RECOVERY: stop -> TUN closed -> STOPPED/INACTIVE -> no VPN transport -> real HTTPS 200 from the controlled endpoint again.
 */
@RunWith(AndroidJUnit4::class)
class AndroidBlockingProofE2ETest {
    @Test fun controlledEndpointIsBlockedOnlyAfterObservedDrop() {
        val args = InstrumentationRegistry.getArguments()
        val host = args.getString("controlledHost"); val ip = args.getString("controlledIpv4")
        val url = args.getString("controlledUrl"); val bundleJson = args.getString("bundleJson")
        assumeTrue("controlled endpoint args missing", host != null && ip != null && url != null && bundleJson != null)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("VPN consent must be granted beforehand", android.net.VpnService.prepare(context) == null)

        // 1. reachable before protection
        assertTrue("endpoint must be reachable before protection", httpOk(url!!))

        // 2. signed rule accepted independently on device
        val state = VpnStateRepository.shared
        val engine = GuardDogSDKEngine(RuleBundleVerifier(TrustedKeyRegistry.m1Default(), InMemoryBundleVersionStore(), SystemClock), state, SystemClock)
        assertTrue(engine.acceptRuleBundle(bundleJson!!) is VerificationResult.Accepted)
        val blocked = ArrayList<SecurityEvent>()
        val latch = CountDownLatch(1)
        engine.addEventListener { if (it.type == SecurityEventType.THREAT_BLOCKED) { blocked.add(it); latch.countDown() } }

        // 3. rule authority + DNS/IP binding + consent -> selective service
        GuardDogVpnRuntime.config = VpnConfig(host!!, ip!!, url, "gd-m1-controlled-block")
        GuardDogVpnRuntime.reporter = engine
        state.recordConsent(true)
        assertTrue(engine.authorizeControlledTarget(host, ip) is BlockAuthorization.Authorized)
        context.startForegroundService(android.content.Intent(context, com.guarddog.vpn.GuardDogVpnService::class.java))
        waitFor { state.lifecycle.isEnforcing }
        assertTrue(blocked.isEmpty()) // VPN start alone never produces THREAT_BLOCKED

        // 4. request fails, packet observed + dropped, one event despite retries
        assertTrue("endpoint must be unreachable under protection", !httpOk(url))
        assertTrue(latch.await(15, TimeUnit.SECONDS))
        val stats = GuardDogVpnRuntime.dropReporter!!.stats()
        assertTrue(stats.observedMatching >= 1 && stats.droppedMatching == stats.observedMatching)
        assertEquals(1, blocked.size)
        assertNotNull(blocked[0].enforcementEvidenceId)
        assertEquals(ip, blocked[0].destinationIp)
        assertNotNull(GuardDogExpoAdapters.toRecord(blocked[0]))
        // 5. unrelated destinations unaffected
        assertTrue(httpOk("https://www.gstatic.com/generate_204"))

        // 6. RECOVERY (AC-06): stop -> TUN closed -> STOPPED/INACTIVE -> no VPN route/transport -> real HTTPS 200 again
        val sessionBeforeStop = GuardDogVpnRuntime.activeSession
        assertNotNull("session must exist while enforcing", sessionBeforeStop)
        context.startService(android.content.Intent(context, com.guarddog.vpn.GuardDogVpnService::class.java).setAction(com.guarddog.vpn.GuardDogVpnService.ACTION_STOP))
        waitFor { !state.lifecycle.isEnforcing }
        val stateAfterStop = state.current().state
        assertTrue("state must be STOPPED or INACTIVE, was $stateAfterStop", stateAfterStop == ProtectionState.STOPPED || stateAfterStop == ProtectionState.INACTIVE)
        assertTrue("TUN descriptor must be closed", sessionBeforeStop!!.closed)
        assertTrue(GuardDogVpnRuntime.activeSession == null && GuardDogVpnRuntime.dropReporter == null)
        waitFor(timeoutMs = 15_000) { !RecoveryInspector.vpnTransportPresent(context) }
        val recovery = RecoveryInspector.inspect(context, state)
        assertTrue("recovery snapshot must be clean: $recovery", recovery.recovered)
        waitFor(timeoutMs = 20_000) { httpsStatus(url) == 200 }
        assertEquals("controlled endpoint must answer HTTPS 200 after stop", 200, httpsStatus(url))
        assertEquals(1, blocked.size) // stopping never produces THREAT_BLOCKED
    }

    private fun httpsStatus(url: String): Int? = try {
        (URL(url).openConnection() as HttpURLConnection).run { connectTimeout = 5000; readTimeout = 5000; instanceFollowRedirects = false; responseCode }
    } catch (e: Exception) { null }

    private fun httpOk(url: String): Boolean = try {
        (URL(url).openConnection() as HttpURLConnection).run { connectTimeout = 5000; readTimeout = 5000; responseCode in 200..399 }
    } catch (e: Exception) { false }

    private fun waitFor(timeoutMs: Long = 10_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!cond() && System.currentTimeMillis() < end) Thread.sleep(100)
        assertTrue(cond())
    }
}
