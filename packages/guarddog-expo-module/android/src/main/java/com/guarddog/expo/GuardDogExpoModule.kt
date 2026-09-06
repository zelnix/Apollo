package com.guarddog.expo

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.BlockAuthorization
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.rules.BundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import com.guarddog.expo.dto.BridgeProtectionConfigRecord
import com.guarddog.vpn.BindingResult
import com.guarddog.vpn.ControlledEndpointResolver
import com.guarddog.vpn.GuardDogVpnRuntime
import com.guarddog.vpn.GuardDogVpnService
import com.guarddog.vpn.RecoveryInspector
import com.guarddog.vpn.VpnLifecycleState
import com.guarddog.vpn.VpnStateRepository
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Rollback store persisted across process restarts (core stays platform-agnostic). */
class SharedPreferencesBundleVersionStore(context: Context) : BundleVersionStore {
    private val prefs = context.getSharedPreferences("guarddog_bundle_versions", Context.MODE_PRIVATE)
    override fun highestAccepted(rulesetId: String): Long? = if (prefs.contains(rulesetId)) prefs.getLong(rulesetId, 0) else null
    override fun recordAccepted(rulesetId: String, bundleVersion: Long) {
        val current = highestAccepted(rulesetId) ?: -1
        if (bundleVersion > current) prefs.edit().putLong(rulesetId, bundleVersion).apply()
    }
}

/**
 * Concrete Expo module class (discoverable by autolinking; no typealias shortcut).
 * Public surface is platform-neutral: requestPermission("vpn"), startProtection(), ...
 * All Android orchestration (consent intent, service, route) stays inside.
 */
class GuardDogExpoModule : Module() {
    private val state = VpnStateRepository.shared
    private lateinit var engine: GuardDogSDKEngine
    private var pendingConsent: Promise? = null

    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

    override fun definition() = ModuleDefinition {
        Name("GuardDogSecurity")
        Events(EVENT_SECURITY, EVENT_STATE)

        OnCreate {
            val verifier = RuleBundleVerifier(TrustedKeyRegistry.m1Default(), SharedPreferencesBundleVersionStore(context), SystemClock)
            engine = GuardDogSDKEngine(verifier, state, SystemClock)
            engine.addEventListener { event ->
                GuardDogExpoAdapters.toRecord(event)?.let { sendEvent(EVENT_SECURITY, it.toBundle()) }
            }
            state.addListener { sendEvent(EVENT_STATE, GuardDogExpoAdapters.toRecord(it).toBundle()) }
            GuardDogVpnRuntime.reporter = engine
        }

        Function("getCapabilities") { GuardDogExpoAdapters.androidCapabilities() }
        Function("getProtectionState") { GuardDogExpoAdapters.toRecord(state.current()) }

        Function("configure") { record: BridgeProtectionConfigRecord ->
            GuardDogVpnRuntime.config = GuardDogExpoAdapters.toVpnConfig(record)
        }

        Function("acceptRuleBundle") { rawJson: String -> GuardDogExpoAdapters.toRecord(engine.acceptRuleBundle(rawJson)) }

        Function("analyzeUrl") { url: String ->
            engine.analyzeUrl(url)?.let { mapOf("sanitizedUrl" to it.sanitizedUrl, "host" to it.host, "verdict" to it.verdict, "ruleId" to it.ruleId) }
        }

        AsyncFunction("requestPermission") { kind: String, promise: Promise ->
            if (kind != "vpn") { promise.resolve("unsupported"); return@AsyncFunction }
            val intent = VpnService.prepare(context)
            if (intent == null) { state.recordConsent(true); promise.resolve("granted"); return@AsyncFunction }
            val activity = appContext.currentActivity ?: throw CodedException("ERR_NO_ACTIVITY", "No foreground activity for consent", null)
            pendingConsent = promise
            state.transition(VpnLifecycleState.ConsentRequired)
            activity.startActivityForResult(intent, VPN_CONSENT_REQUEST)
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != VPN_CONSENT_REQUEST) return@OnActivityResult
            val granted = payload.resultCode == Activity.RESULT_OK
            state.recordConsent(granted)
            pendingConsent?.resolve(if (granted) "granted" else "denied")
            pendingConsent = null
        }

        AsyncFunction("startProtection") { promise: Promise ->
            val config = GuardDogVpnRuntime.config ?: throw CodedException("ERR_NOT_CONFIGURED", "configure() not called", null)
            if (!state.consentGranted || VpnService.prepare(context) != null) throw CodedException("ERR_CONSENT", "VPN consent not granted", null)
            if (engine.acceptedBundle() == null) throw CodedException("ERR_NO_BUNDLE", "no accepted signed rule bundle", null)
            // Resolve + verify DNS/IP binding, then run the rule authority chain BEFORE the service starts.
            val binding = ControlledEndpointResolver(config, GuardDogVpnRuntime.resolver).verifyBinding()
            val ipv4 = when (binding) {
                is BindingResult.Match -> binding.ipv4
                is BindingResult.Mismatch -> { state.transition(VpnLifecycleState.Failed("DNS/IP mismatch")); throw CodedException("ERR_DNS_BINDING", "resolved ${binding.resolved} != ${binding.expected}", null) }
                is BindingResult.ResolutionFailed -> { state.transition(VpnLifecycleState.Failed("resolution failed")); throw CodedException("ERR_DNS_BINDING", "host did not resolve", null) }
            }
            when (val auth = engine.authorizeControlledTarget(config.controlledHost, ipv4)) {
                is BlockAuthorization.NotAuthorized -> throw CodedException("ERR_RULE_AUTHORITY", auth.reason, null)
                is BlockAuthorization.Authorized -> Unit
            }
            context.startForegroundService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_START))
            promise.resolve(GuardDogExpoAdapters.toRecord(state.current()))
        }

        AsyncFunction("stopProtection") { promise: Promise ->
            context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
            engine.clearAuthorization()
            promise.resolve(GuardDogExpoAdapters.toRecord(state.current()))
        }

        Function("getEnforcementStats") {
            GuardDogVpnRuntime.dropReporter?.stats()?.let {
                mapOf("observedMatching" to it.observedMatching, "droppedMatching" to it.droppedMatching, "reportedBlocks" to it.reportedBlocks,
                    "dedupedRetries" to it.dedupedRetries, "unexpectedPackets" to it.unexpectedPackets)
            }
        }

        // Recovery proof (AC-06): real runtime + OS-level snapshot; the HTTPS re-check is done by the caller.
        Function("getRecoveryStatus") {
            val r = RecoveryInspector.inspect(context, state)
            mapOf("lifecycle" to r.lifecycle, "tunOpen" to r.tunOpen, "selectiveRouteActive" to r.selectiveRouteActive,
                "vpnTransportPresent" to r.vpnTransportPresent, "routeCidr" to r.routeCidr, "dropReporterAttached" to r.dropReporterAttached,
                "recovered" to r.recovered)
        }

        // Build provenance for the device proof: SHA-256 of the installed base APK (compared against the CI artifact hash),
        // package/version and debuggable flag. Hashing runs off the main thread (APK is tens of MB).
        AsyncFunction("getBuildProvenance") { promise: Promise ->
            Thread {
                try {
                    val info = context.packageManager.getPackageInfo(context.packageName, 0)
                    val apk = java.io.File(context.applicationInfo.sourceDir)
                    val digest = java.security.MessageDigest.getInstance("SHA-256")
                    apk.inputStream().use { input ->
                        val buf = ByteArray(1 shl 16)
                        while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n) }
                    }
                    val debuggable = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
                    promise.resolve(mapOf(
                        "apkSha256" to digest.digest().joinToString("") { "%02x".format(it) },
                        "apkSizeBytes" to apk.length(),
                        "splitApks" to (context.applicationInfo.splitSourceDirs?.size ?: 0),
                        "packageName" to context.packageName,
                        "versionName" to info.versionName,
                        "versionCode" to info.longVersionCode,
                        "debuggable" to debuggable,
                    ))
                } catch (e: Exception) {
                    promise.reject(CodedException("E_PROVENANCE", e.message, e))
                }
            }.start()
        }
    }

    companion object {
        const val EVENT_SECURITY = "onSecurityEvent"
        const val EVENT_STATE = "onProtectionStateChanged"
        private const val VPN_CONSENT_REQUEST = 0x6D31
    }
}

private fun expo.modules.kotlin.records.Record.toBundle(): android.os.Bundle {
    val bundle = android.os.Bundle()
    for (field in this::class.java.declaredFields) {
        field.isAccessible = true
        when (val v = field.get(this)) {
            null -> Unit
            is String -> bundle.putString(field.name, v)
            is Boolean -> bundle.putBoolean(field.name, v)
            is Double -> bundle.putDouble(field.name, v)
            is Long -> bundle.putLong(field.name, v)
            is Int -> bundle.putInt(field.name, v)
        }
    }
    return bundle
}
