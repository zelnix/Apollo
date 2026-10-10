package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.net.VpnService
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.guarddog.core.BlockAuthorization
import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.protection.ProtectionEnforcementReporter
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.RuleBundleValidator
import com.guarddog.core.rules.RuleBundle
import com.guarddog.core.rules.ValidationResult
import com.guarddog.vpn.BindingResult
import com.guarddog.vpn.ControlledEndpointResolver
import com.guarddog.vpn.DnsThreatObservedListener
import com.guarddog.vpn.GuardDogVpnRuntime
import com.guarddog.vpn.GuardDogVpnService
import com.guarddog.vpn.MutableWebsiteGateOverrideStore
import com.guarddog.vpn.RecoveryInspector
import com.guarddog.vpn.VpnConfig
import com.guarddog.vpn.VpnStateRepository
import com.guarddog.vpn.WebsiteGateAddressing
import android.net.ConnectivityManager
import android.net.LinkProperties
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

private data class ProductionRuntimeConfig(
  val ruleBundleUrl: String, val controlledHost: String, val controlledIpv4: String,
  val controlledUrl: String, val rulesetId: String, val dedupeWindowMs: Long,
) {
  fun vpn() = VpnConfig(controlledHost, controlledIpv4, controlledUrl, rulesetId, dedupeWindowMs)
  fun json() = JSONObject().put("ruleBundleUrl", ruleBundleUrl).put("controlledHost", controlledHost)
    .put("controlledIpv4", controlledIpv4).put("controlledUrl", controlledUrl).put("rulesetId", rulesetId).put("dedupeWindowMs", dedupeWindowMs)
  companion object {
    fun parse(raw: String): ProductionRuntimeConfig {
      val body = JSONObject(raw); val allowed = setOf("ruleBundleUrl", "controlledHost", "controlledIpv4", "controlledUrl", "rulesetId", "dedupeWindowMs")
      check(body.keys().asSequence().toSet() == allowed) { "production runtime configuration schema mismatch" }
      val rules = URI(body.getString("ruleBundleUrl")); val controlled = URI(body.getString("controlledUrl"))
      check(rules.scheme == "https" && controlled.scheme == "https") { "production GuardDog URLs must use HTTPS" }
      val host = body.getString("controlledHost").trim().lowercase(); check(host == controlled.host?.lowercase()) { "controlled URL host mismatch" }
      val ipv4 = body.getString("controlledIpv4"); check(ipv4.split('.').size == 4 && ipv4.split('.').all { it.toIntOrNull() in 0..255 })
      val ruleset = body.getString("rulesetId"); check(ruleset.matches(Regex("^[a-z0-9-]{3,80}$")))
      return ProductionRuntimeConfig(rules.toString(), host, ipv4, controlled.toString(), ruleset, body.getLong("dedupeWindowMs"))
    }
  }
}

private data class ProductionPendingEvidence(val evidence: BlockedThreatEvidence)

/**
 * Apollo-owned production authority over the frozen GuardDog core/VPN.
 * Rules are authenticated via HTTPS (TLS + baked-in backend URL). No Ed25519 signing keys.
 */
internal class ApolloGuardDogProductionRuntime(private val context: Context) {
  private val transitions = ApolloEnforcementTransitions.coordinator
  private val state = VpnStateRepository.shared
  private val prefs = context.getSharedPreferences("apollo_guarddog_production", Context.MODE_PRIVATE)
  private val inbox = BoundedEvidenceInbox(256, SharedPreferencesEvidencePersistence(prefs)) {
    runCatching { JSONObject(it).optString("evidenceId").takeIf(String::isNotBlank) }.getOrNull()
  }
  private val dnsThreatInbox = ApolloDnsThreatInbox(context.getSharedPreferences("apollo_dns_threat_observations", Context.MODE_PRIVATE))
  private val pending = ConcurrentHashMap<String, ProductionPendingEvidence>()
  private var config: ProductionRuntimeConfig? = prefs.getString("config", null)?.let { runCatching { ProductionRuntimeConfig.parse(it) }.getOrNull() }
  private var engine: GuardDogSDKEngine? = null
  private var acceptedBundleExpiresAt: Instant? = null
  private val websiteGateOverrides = MutableWebsiteGateOverrideStore()
  @Volatile private var observedUpstreamDns: String? = null
  private val networkObserver = ApolloGuardDogNetworkObserver(context) { upstream -> onNetworkDnsChanged(upstream) }
  private val reporter = ProtectionEnforcementReporter { evidence ->
    if (!ruleBundleCurrent()) { inbox.reportFailure("Production rule bundle expired; evidence was withheld"); scheduleExpiry(Instant.now()); return@ProtectionEnforcementReporter }
    pending[evidence.enforcementEvidenceId] = ProductionPendingEvidence(evidence)
    try { checkNotNull(engine).reportBlockedPacket(evidence) }
    catch (_: Throwable) { inbox.reportFailure("Production engine event reporting failed") }
    finally { pending.remove(evidence.enforcementEvidenceId) }
  }

  init {
    state.osConsentCheck = { VpnService.prepare(context) == null }
    runCatching { rebuildFromPersisted() }.onFailure { inbox.reportFailure("Persisted production rules could not be restored") }
    networkObserver.start()
  }

  fun configure(raw: String): String = transitions.serialized {
    requireProductionEnabled(); val next = ProductionRuntimeConfig.parse(raw)
    check(prefs.edit().putString("config", next.json().toString()).commit()) { "Could not persist production configuration" }
    config = next
    scheduleRefresh()
    JSONObject().put("configured", true).toString()
  }

  /** Fetch the latest rules from the authenticated HTTPS backend and validate them. */
  fun refreshRules(): String {
    val active = checkNotNull(config) { "Production GuardDog is not configured" }
    val rawBundle = fetch(active.ruleBundleUrl)
    return transitions.serialized { acceptBundleLocked(rawBundle) }
  }

  fun acceptBundle(raw: String): String = transitions.serialized { acceptBundleLocked(raw) }
  private fun acceptBundleLocked(raw: String): String {
    val activeConfig = checkNotNull(config)
    // Validate bundle via HTTPS-authenticated schema/version/expiry checks — no Ed25519 signing.
    val validator = RuleBundleValidator(ApolloBundleVersionStore(context, "production:v2"), SystemClock)
    val staged = validator.validate(raw)
    if (staged is ValidationResult.Rejected) return JSONObject().put("accepted", false).put("reason", staged.reason.name).toString()
    val bundle = (staged as ValidationResult.Accepted).bundle
    check(bundle.rulesetId == activeConfig.rulesetId) { "Rule bundle targets a different ruleset" }
    val bundleExpiry = Instant.parse(bundle.expiresAt)
    val activeEngine = engine ?: rebuildEngine()
    val previous = persistedBundleVersion()
    if (previous != null) {
      check(bundle.bundleVersion >= previous) { "Rule bundle rollback" }
    }
    val changed = persistedBundle() == null || persistedBundleVersion() != bundle.bundleVersion
    val resume = changed && ownsEnforcement()
    if (resume) { stopLocked(); check(transitions.await(2_000) { pending.isEmpty() }) { "GuardDog evidence reporting did not drain before rule transition" } }
    if (changed) { activeEngine.clearAuthorization(); activeEngine.clearWebsiteGateBindings() }
    return when (val result = activeEngine.acceptRuleBundle(raw)) {
      is ValidationResult.Accepted -> {
        check(activeEngine.acceptWebsiteGateRuleBundle(raw) is ValidationResult.Accepted) { "Website Gate rejected the accepted production rule bundle" }
        persistBundle(raw, bundle.bundleVersion)
        acceptedBundleExpiresAt = bundleExpiry; scheduleExpiry(bundleExpiry)
        if (resume) startLocked()
        JSONObject().put("accepted", true).put("rulesetId", result.bundle.rulesetId).put("bundleVersion", result.bundle.bundleVersion)
          .put("expiresAt", result.bundle.expiresAt).toString()
      }
      is ValidationResult.Rejected -> JSONObject().put("accepted", false).put("reason", result.reason.name).toString()
    }
  }

  private fun rebuildEngine(): GuardDogSDKEngine {
    val validator = RuleBundleValidator(ApolloBundleVersionStore(context, "production:v2"), SystemClock)
    val rebuilt = GuardDogSDKEngine(validator, state, SystemClock)
    rebuilt.addEventListener { event ->
      try {
        val item = pending[event.enforcementEvidenceId ?: return@addEventListener] ?: return@addEventListener
        val record = ApolloGuardDogEvidenceCorrelator.correlate(event, item.evidence, "Android ${android.os.Build.VERSION.RELEASE}") ?: return@addEventListener
        if (ApolloGuardDogEvidenceCorrelator.contractValid(record)) inbox.append(JSONObject(record).toString()) else inbox.reportFailure("Production evidence contract failed")
      } catch (_: Throwable) { inbox.reportFailure("Production evidence correlation failed") }
    }
    engine = rebuilt
    return rebuilt
  }

  private fun rebuildFromPersisted() {
    val raw = persistedBundle() ?: return
    val rebuilt = rebuildEngine()
    runCatching {
      val expires = Instant.parse(RuleBundle.fromJson(raw).expiresAt)
      check(expires.isAfter(Instant.now()))
      check(rebuilt.acceptRuleBundle(raw) is ValidationResult.Accepted); check(rebuilt.acceptWebsiteGateRuleBundle(raw) is ValidationResult.Accepted)
      acceptedBundleExpiresAt = expires; scheduleExpiry(expires)
    }.onFailure { engine = null; inbox.reportFailure("Persisted production rule bundle could not be restored") }
  }

  // ── Offline persistence for rule bundles ──────────────────────────────────
  private fun persistedBundle(): String? = prefs.getString("rule_bundle_raw", null)
  private fun persistedBundleVersion(): Long? = prefs.getLong("rule_bundle_version", -1).takeIf { it >= 0 }
  private fun persistBundle(raw: String, version: Long) { prefs.edit().putString("rule_bundle_raw", raw).putLong("rule_bundle_version", version).apply() }

  fun start(): String = transitions.serialized { startLocked() }
  private fun startLocked(): String {
    requireProductionEnabled(); val activeConfig = checkNotNull(config); check(ruleBundleCurrent()) { "Production rule bundle is unavailable or expired" }
    check(VpnService.prepare(context) == null) { "VPN consent is not granted" }
    val activeEngine = checkNotNull(engine); val resolved = when (val binding = ControlledEndpointResolver(activeConfig.vpn(), GuardDogVpnRuntime.resolver).verifyBinding()) {
      is BindingResult.Match -> binding.ipv4; is BindingResult.Mismatch -> error("DNS/IP binding mismatch"); is BindingResult.ResolutionFailed -> error("Controlled host did not resolve")
    }
    check(activeEngine.authorizeControlledTarget(activeConfig.controlledHost, resolved) is BlockAuthorization.Authorized) { "Rules did not authorize the controlled target" }
    val upstream = checkNotNull(networkObserver.currentIpv4Dns()) { "No physical-network IPv4 DNS resolver is currently available" }
    observedUpstreamDns = upstream
    GuardDogVpnRuntime.config = activeConfig.vpn(); GuardDogVpnRuntime.reporter = reporter
    GuardDogVpnRuntime.websiteGateEngine = activeEngine; GuardDogVpnRuntime.websiteGateRouteConfig = WebsiteGateAddressing.defaultRouteConfig()
    GuardDogVpnRuntime.upstreamDnsResolverIpv4 = upstream; GuardDogVpnRuntime.websiteGateBindingLifetimeMillis = 30_000L
    GuardDogVpnRuntime.websiteGateOverrideStore = websiteGateOverrides
    GuardDogVpnRuntime.dnsThreatObservedListener = DnsThreatObservedListener { observation ->
      try { dnsThreatInbox.append(observation) } catch (_: Throwable) { dnsThreatInbox.reportFailure("DNS threat observation persistence failed") }
    }
    check(prefs.edit().putBoolean("requested", true).putString("since", prefs.getString("since", null) ?: Instant.now().toString()).commit())
    context.startForegroundService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_START))
    if (!transitions.await(8_000) { actualOperational() }) { context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP)); error("Production GuardDog start timed out") }
    return statusLocked()
  }

  fun stop(): String = transitions.serialized { stopLocked() }
  private fun stopLocked(clearIntent: Boolean = true): String {
    context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
    if (clearIntent) prefs.edit().putBoolean("requested", false).remove("since").commit()
    if (!transitions.await(8_000) { RecoveryInspector.inspect(context, state).recovered }) error("Production GuardDog stop timed out")
    engine?.clearAuthorization(); engine?.clearWebsiteGateBindings(); detachRuntime(); return statusLocked(false)
  }

  fun enforceExpiry(): String = transitions.serialized {
    if (!ruleBundleCurrent() && ownsEnforcement()) stopLocked() else statusLocked()
  }
  fun ownsEnforcement(): Boolean = prefs.getBoolean("requested", false) || state.current().state in setOf(ProtectionState.STARTING, ProtectionState.ACTIVE)
  private fun ruleBundleCurrent(now: Instant = Instant.now()): Boolean {
    val bundleExpiry = acceptedBundleExpiresAt ?: return false
    return now.isBefore(bundleExpiry) && engine?.acceptedBundle() != null
  }
  private fun actualOperational(): Boolean { val runtime = RecoveryInspector.inspect(context, state); return ruleBundleCurrent() && state.current().state == ProtectionState.ACTIVE && runtime.tunOpen && runtime.selectiveRouteActive && runtime.dropReporterAttached && GuardDogVpnRuntime.websiteGateActive }

  fun status(): String = transitions.serialized { if (!ruleBundleCurrent() && ownsEnforcement()) stopLocked() else statusLocked() }
  private fun statusLocked(recheckAuthority: Boolean = true): String {
    val runtime = RecoveryInspector.inspect(context, state); val operational = actualOperational(); val requested = prefs.getBoolean("requested", false); val inboxState = inbox.status()
    val bundleVersion = engine?.acceptedBundle()?.bundleVersion
    val reason = when {
      acceptedBundleExpiresAt == null -> "No accepted production rule bundle"; recheckAuthority && !ruleBundleCurrent() -> "Production rule bundle expired"
      requested && !GuardDogVpnRuntime.websiteGateActive -> "Website Gate DNS/sinkhole runtime is inactive"; requested && !operational -> "TUN/route/reporter observations are incomplete"; else -> null }
    return JSONObject().put("running", operational).put("requested", requested).put("operational", operational).put("enforcementMethod", "packet_filter")
      .put("coverage", "GuardDog production Website Gate: plaintext IPv4 DNS is inspected; exact-host blocks use short-lived sinkhole /32 routes. Private DNS, DoH, DoT, QUIC and IPv6 are outside this source claim.")
      .put("coverageScope", JSONArray().put("dns:ipv4-udp-53").put("ip:controlled-/32").put("ip:website-gate-sinkhole-/32"))
      .put("lastVerified", if (operational) Instant.now().toString() else JSONObject.NULL).put("degradedReason", reason ?: JSONObject.NULL)
      .put("visibility", if (operational) "full" else "none").put("since", prefs.getString("since", null) ?: JSONObject.NULL)
      .put("adapterLabel", LABEL).put("checkedAt", Instant.now().toString()).put("productionAuthority", true)
      .put("bundleVersion", bundleVersion ?: JSONObject.NULL).put("ruleExpiresAt", acceptedBundleExpiresAt?.toString() ?: JSONObject.NULL)
      .put("nativeLifecycle", runtime.lifecycle)
      .put("tunOpen", runtime.tunOpen).put("selectiveRouteActive", runtime.selectiveRouteActive).put("dropReporterAttached", runtime.dropReporterAttached)
      .put("websiteGateConfigured", GuardDogVpnRuntime.websiteGateRouteConfig != null).put("dnsGatewayActive", GuardDogVpnRuntime.websiteGateActive)
      .put("upstreamDnsResolverIpv4", GuardDogVpnRuntime.upstreamDnsResolverIpv4 ?: JSONObject.NULL)
      .put("evidencePending", inboxState.pending).put("evidenceCapacity", inboxState.capacity).put("evidenceOverflow", inboxState.overflow)
      .put("evidencePersistenceError", inboxState.error ?: JSONObject.NULL)
      .put("dnsThreatObservations", dnsThreatInbox.status().let { JSONObject().put("pending", it.pending).put("capacity", it.capacity).put("error", it.error ?: JSONObject.NULL) })
      .put("privateDns", privateDnsStatus())
      .toString()
  }

  fun capabilities(): String = JSONArray().put(JSONObject().put("id", "site_guard").put("title", "GuardDog production Website Gate")
    .put("status", if (actualOperational()) "active" else if (VpnService.prepare(context) == null) "inactive" else "permission_required")
    .put("detail", "Rollback-protected exact-host decisions with DNS sinkhole routing and packet-drop evidence.")).toString()
  fun analyzeUrl(url: String): String = transitions.serialized { val result = engine?.analyzeUrl(url)
    if (result == null) JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("Production rules are unavailable for this URL.")).toString()
    else JSONObject().put("supported", true).put("verdict", result.verdict).put("reasons", JSONArray()).put("sanitizedUrl", result.sanitizedUrl).put("host", result.host).put("ruleId", result.ruleId ?: JSONObject.NULL).toString() }
  fun evidence(): String = "[${inbox.records().filter { runCatching { ApolloGuardDogEvidenceCorrelator.contractValid(jsonObject(JSONObject(it))) }.getOrDefault(false) }.joinToString(",")}]"
  fun acknowledgeEvidence(raw: String): String { val ids = JSONArray(raw); val count = inbox.acknowledge((0 until ids.length()).map { ids.getString(it) }.toSet()); return JSONObject().put("acknowledged", count).put("pending", inbox.status().pending).toString() }

  // ── DNS Threat Observations (separate from enforcement evidence) ──────────
  fun dnsThreatObservations(): String = dnsThreatInbox.records()
  fun acknowledgeDnsThreatObservations(raw: String): String {
    val ids = JSONArray(raw); val count = dnsThreatInbox.acknowledge((0 until ids.length()).map { ids.getString(it) }.toSet())
    return JSONObject().put("acknowledged", count).put("pending", dnsThreatInbox.status().pending).toString()
  }

  // ── Private DNS / DoH Gap Detection ──────────────────────────────────────
  fun privateDnsStatus(): JSONObject {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val activeNetwork = cm?.activeNetwork
    val linkProps: LinkProperties? = if (activeNetwork != null) cm.getLinkProperties(activeNetwork) else null
    val privateDnsActive = linkProps?.isPrivateDnsActive ?: false
    val privateDnsServer = linkProps?.privateDnsServerName
    // Distinguish confirmed bypass from possible bypass:
    // - privateDnsActive == true && server != null → confirmed bypass (user-configured DoT provider)
    // - privateDnsActive == true && server == null → confirmed bypass (Android "Automatic" mode)
    // - privateDnsActive == false → Private DNS off; Apollo's DNS gateway is active
    // Chrome's internal DoH is unobservable (no API) — report as "possible"
    val bypassLevel = when {
      privateDnsActive && privateDnsServer != null -> "confirmed"
      privateDnsActive -> "confirmed"
      else -> "none"
    }
    return JSONObject()
      .put("privateDnsActive", privateDnsActive)
      .put("privateDnsServer", privateDnsServer ?: JSONObject.NULL)
      .put("bypassLevel", bypassLevel)
      .put("chromeDoH", "unobservable")
      .put("explanation", when (bypassLevel) {
        "confirmed" -> "Your device's Private DNS setting sends all DNS queries through an encrypted channel that Apollo cannot inspect. Website protection is reduced to rule-bundle filtering only."
        else -> "Apollo's DNS gateway is active and inspecting plaintext DNS queries."
      })
  }

  // ── Urgent rule refresh ──────────────────────────────────────────────────
  fun triggerUrgentRefresh(): String {
    val work = OneTimeWorkRequestBuilder<ApolloGuardDogRefreshWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniqueWork("apollo-guarddog-urgent-refresh", ExistingWorkPolicy.REPLACE, work)
    return JSONObject().put("triggered", true).put("type", "urgent").toString()
  }

  fun recovery(): String { val result = RecoveryInspector.inspect(context, state); return JSONObject().put("lifecycle", result.lifecycle).put("tunOpen", result.tunOpen).put("selectiveRouteActive", result.selectiveRouteActive).put("vpnTransportPresent", result.vpnTransportPresent).put("routeCidr", result.routeCidr ?: JSONObject.NULL).put("dropReporterAttached", result.dropReporterAttached).put("recovered", result.recovered).toString() }

  private fun fetch(rawUrl: String): String { val connection = URL(rawUrl).openConnection() as HttpURLConnection; connection.connectTimeout = 15_000; connection.readTimeout = 20_000; connection.instanceFollowRedirects = false
    try { check(connection.responseCode == 200) { "rule update service returned ${connection.responseCode}" }; check((connection.contentLengthLong.takeIf { it >= 0 } ?: 0) <= 2_000_000)
      val bytes = connection.inputStream.use { input -> val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) { val count = input.read(buffer); if (count < 0) break; check(output.size() + count <= 2_000_000) { "rule update exceeded size limit" }; output.write(buffer, 0, count) }; output.toByteArray() }
      return bytes.toString(Charsets.UTF_8)
    } finally { connection.disconnect() } }
  private fun scheduleExpiry(at: Instant) { val delay = Duration.between(Instant.now(), at).toMillis().coerceAtLeast(0); val work = OneTimeWorkRequestBuilder<ApolloGuardDogExpiryWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).build(); WorkManager.getInstance(context).enqueueUniqueWork("apollo-guarddog-production-expiry", ExistingWorkPolicy.REPLACE, work) }
  private fun scheduleRefresh() { val work = PeriodicWorkRequestBuilder<ApolloGuardDogRefreshWorker>(2, TimeUnit.HOURS)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork("apollo-guarddog-production-refresh", ExistingPeriodicWorkPolicy.UPDATE, work) }
  private fun requireProductionEnabled() { check(ApolloGuardDogProductionOwner.isEligible(context)) { "Production GuardDog authority is disabled in this build" } }
  private fun detachRuntime() { GuardDogVpnRuntime.reporter = null; GuardDogVpnRuntime.config = null; GuardDogVpnRuntime.websiteGateEngine = null
    GuardDogVpnRuntime.websiteGateRouteConfig = null; GuardDogVpnRuntime.upstreamDnsResolverIpv4 = null; GuardDogVpnRuntime.dnsThreatObservedListener = null }
  private fun onNetworkDnsChanged(upstream: String?) {
    if (upstream == observedUpstreamDns) return
    observedUpstreamDns = upstream
    if (!ownsEnforcement()) return
    runCatching { transitions.serialized { stopLocked(clearIntent = false); if (upstream != null && ruleBundleCurrent()) startLocked() } }
      .onFailure { inbox.reportFailure("Production Website Gate stopped after a physical-network DNS change") }
  }
  fun resumeRequested(): String = transitions.serialized { if (prefs.getBoolean("requested", false)) startLocked() else statusLocked() }
  private fun jsonObject(body: JSONObject): Map<String, Any?> = body.keys().asSequence().associateWith { key -> jsonValue(body.get(key)) }
  private fun jsonValue(value: Any?): Any? = when (value) { is JSONObject -> jsonObject(value); is JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }; JSONObject.NULL -> null; else -> value }
  companion object { const val LABEL = "GuardDog production Website Gate" }
}

class ApolloGuardDogExpiryWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result = runCatching {
    if (ApolloGuardDogProductionOwner.isEligible(applicationContext)) ApolloGuardDogProductionOwner.get(applicationContext).enforceExpiry()
    else applicationContext.startService(Intent(applicationContext, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
    Result.success()
  }.getOrElse { Result.failure() }
}

class ApolloGuardDogRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result = runCatching {
    if (!ApolloGuardDogProductionOwner.isEligible(applicationContext)) return Result.success()
    val result = JSONObject(ApolloGuardDogProductionOwner.get(applicationContext).refreshRules())
    if (result.optBoolean("accepted")) Result.success() else Result.failure()
  }.getOrElse { Result.retry() }
}
