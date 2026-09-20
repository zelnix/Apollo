package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.VpnService
import com.guarddog.core.BlockAuthorization
import com.guarddog.core.GuardDogSDKEngine
import com.guarddog.core.clock.SystemClock
import com.guarddog.core.events.BlockedThreatEvidence
import com.guarddog.core.events.SecurityEvent
import com.guarddog.core.protection.ProtectionEnforcementReporter
import com.guarddog.core.protection.ProtectionState
import com.guarddog.core.rules.AcceptedBundle
import com.guarddog.core.rules.BundleVersionStore
import com.guarddog.core.rules.InMemoryBundleVersionStore
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import com.guarddog.core.rules.VerificationResult
import com.guarddog.vpn.BindingResult
import com.guarddog.vpn.ControlledEndpointResolver
import com.guarddog.vpn.FreshConnectionProbe
import com.guarddog.vpn.GuardDogVpnRuntime
import com.guarddog.vpn.GuardDogVpnService
import com.guarddog.vpn.RecoveryInspector
import com.guarddog.vpn.VpnConfig
import com.guarddog.vpn.VpnStateRepository
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

private class ApolloBundleVersionStore(context: Context) : BundleVersionStore {
  private val prefs = context.getSharedPreferences("apollo_guarddog_bundle_versions", Context.MODE_PRIVATE)
  override fun highestAccepted(rulesetId: String): AcceptedBundle? =
    if (prefs.contains(rulesetId)) AcceptedBundle(prefs.getLong(rulesetId, 0), prefs.getString("$rulesetId.envelopeHash", null)) else null
  override fun recordAccepted(rulesetId: String, bundleVersion: Long, envelopeHash: String?) {
    val merged = InMemoryBundleVersionStore.merge(highestAccepted(rulesetId), AcceptedBundle(bundleVersion, envelopeHash))
    val edit = prefs.edit().putLong(rulesetId, merged.bundleVersion)
    if (merged.envelopeHash == null) edit.remove("$rulesetId.envelopeHash") else edit.putString("$rulesetId.envelopeHash", merged.envelopeHash)
    check(edit.commit()) { "Could not persist GuardDog rollback state" }
  }
}

internal object ApolloGuardDogEvidenceCorrelator {
  fun correlate(event: SecurityEvent, original: BlockedThreatEvidence, osVersion: String): Map<String, Any?>? {
    if (!event.isGenuineBlock || event.enforcementEvidenceId != original.enforcementEvidenceId) return null
    if (event.destinationIp != original.destinationIpv4 || event.host.isNullOrBlank() || event.ruleId.isNullOrBlank()) return null
    val protocol = when (original.ipProtocol) { 6 -> "tcp"; 17 -> "udp"; 1 -> "icmp"; else -> "iana-${original.ipProtocol}" }
    return mapOf(
      "evidenceId" to original.enforcementEvidenceId, "eventId" to null, "deviceId" to null,
      "platform" to "android", "osVersion" to osVersion, "sdkVersion" to null,
      "observedAt" to Instant.ofEpochMilli(original.observedAtEpochMillis).toString(),
      "mechanism" to "packet_filter", "direction" to "outbound", "protocol" to protocol,
      "destination" to mapOf("ip" to original.destinationIpv4, "domain" to event.host, "port" to original.destinationPort),
      "attribution" to mapOf("appId" to null, "processName" to null, "confidence" to "unavailable"),
      "matchedRuleId" to event.ruleId, "threatId" to null, "requestedAction" to "block", "enforcedAction" to "blocked",
      "result" to "verified", "ruleSource" to "signed_guarddog_bundle", "confidence" to "high", "correlationId" to event.id,
      "sourceMetadata" to mapOf("ipProtocolNumber" to original.ipProtocol, "sourcePort" to original.sourcePort,
        "packetLength" to original.packetLength, "flowKey" to original.flowKey, "enforcementLayer" to original.enforcementLayer,
        "rulesetId" to event.rulesetId, "bundleVersion" to event.bundleVersion),
    )
  }
}

/** Acceptance-only single owner for frozen GuardDog core/VPN. Production trust is deliberately absent. */
internal class ApolloGuardDogCandidateRuntime(private val context: Context) {
  private val state = VpnStateRepository.shared
  private val prefs = context.getSharedPreferences("apollo_guarddog_candidate", Context.MODE_PRIVATE)
  private val engine = GuardDogSDKEngine(
    RuleBundleVerifier(TrustedKeyRegistry(mapOf(ACCEPTANCE_KEY_ID to ACCEPTANCE_PUBLIC_KEY_B64)), ApolloBundleVersionStore(context), SystemClock), state, SystemClock,
  )
  private val pending = ConcurrentHashMap<String, BlockedThreatEvidence>()
  private var config: VpnConfig? = null
  private val reporter = ProtectionEnforcementReporter { evidence ->
    pending[evidence.enforcementEvidenceId] = evidence
    try { engine.reportBlockedPacket(evidence) } finally { pending.remove(evidence.enforcementEvidenceId) }
  }

  init {
    state.osConsentCheck = { VpnService.prepare(context) == null }
    engine.addEventListener { event ->
      val id = event.enforcementEvidenceId ?: return@addEventListener
      val original = pending[id] ?: return@addEventListener
      ApolloGuardDogEvidenceCorrelator.correlate(event, original, "Android ${android.os.Build.VERSION.RELEASE}")
        ?.let { persistEvidence(JSONObject(it)) }
    }
  }

  fun configure(raw: String): String {
    requireAcceptanceEnabled()
    val body = JSONObject(raw)
    check(body.optString("profile") == PROFILE) { "GuardDog candidate profile is test-only" }
    val next = VpnConfig(
      controlledHost = body.getString("controlledHost"), controlledIpv4 = body.getString("controlledIpv4"),
      controlledUrl = body.getString("controlledUrl"), rulesetId = body.getString("rulesetId"),
      dedupeWindowMillis = body.optLong("dedupeWindowMs", 2_000L),
    )
    config = next
    GuardDogVpnRuntime.config = next
    GuardDogVpnRuntime.reporter = reporter
    GuardDogVpnRuntime.websiteGateEngine = null
    GuardDogVpnRuntime.websiteGateRouteConfig = null
    return JSONObject().put("configured", true).put("profile", PROFILE).toString()
  }

  fun acceptBundle(raw: String): String {
    requireAcceptanceEnabled()
    return when (val result = engine.acceptRuleBundle(raw)) {
    is VerificationResult.Accepted -> JSONObject().put("accepted", true).put("rulesetId", result.bundle.rulesetId)
      .put("bundleVersion", result.bundle.bundleVersion).put("expiresAt", result.bundle.expiresAt).toString()
    is VerificationResult.Rejected -> JSONObject().put("accepted", false).put("reason", result.reason.name)
      .put("detail", result.detail ?: JSONObject.NULL).toString()
    }
  }

  fun start(): String {
    requireAcceptanceEnabled()
    val activeConfig = checkNotNull(config) { "GuardDog candidate is not configured" }
    check(VpnService.prepare(context) == null) { "VPN consent is not granted" }
    check(engine.acceptedBundle() != null) { "No accepted signed acceptance bundle" }
    val resolved = when (val binding = ControlledEndpointResolver(activeConfig, GuardDogVpnRuntime.resolver).verifyBinding()) {
      is BindingResult.Match -> binding.ipv4
      is BindingResult.Mismatch -> error("DNS/IP mismatch: expected ${binding.expected}, resolved ${binding.resolved}")
      is BindingResult.ResolutionFailed -> error("Controlled host did not resolve: ${binding.host}")
    }
    when (val authority = engine.authorizeControlledTarget(activeConfig.controlledHost, resolved)) {
      is BlockAuthorization.NotAuthorized -> error("Rule authority rejected target: ${authority.reason}")
      is BlockAuthorization.Authorized -> Unit
    }
    prefs.edit().putBoolean("requested", true).putString("since", Instant.now().toString()).commit()
    context.startForegroundService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_START))
    var waited = 0
    while (state.current().state == ProtectionState.STARTING && waited < 5_000) { Thread.sleep(100); waited += 100 }
    return status()
  }

  fun stop(): String {
    context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
    engine.clearAuthorization()
    prefs.edit().putBoolean("requested", false).remove("since").commit()
    var waited = 0
    while (state.current().state == ProtectionState.ACTIVE && waited < 3_000) { Thread.sleep(100); waited += 100 }
    return status()
  }

  fun status(): String {
    val snapshot = state.current(); val operational = snapshot.state == ProtectionState.ACTIVE
    val requested = prefs.getBoolean("requested", false)
    return JSONObject().put("running", operational).put("requested", requested).put("operational", operational)
      .put("enforcementMethod", "packet_filter")
      .put("coverage", "Acceptance-only selective /32 packet filtering for the verified controlled endpoint.")
      .put("coverageScope", JSONArray().put("ip:controlled-/32"))
      .put("lastVerified", if (operational) Instant.ofEpochMilli(snapshot.updatedAtEpochMillis).toString() else JSONObject.NULL)
      .put("degradedReason", if (requested && !operational) (snapshot.reason ?: snapshot.state.name) else JSONObject.NULL)
      .put("visibility", if (operational) "full" else "none").put("since", prefs.getString("since", null) ?: JSONObject.NULL)
      .put("adapterLabel", LABEL).put("checkedAt", Instant.now().toString()).put("candidateTestOnly", true).toString()
  }

  fun capabilities(): String = JSONArray()
    .put(JSONObject().put("id", "site_guard").put("title", "GuardDog Candidate").put("status",
      if (state.current().state == ProtectionState.ACTIVE) "active" else if (VpnService.prepare(context) == null) "inactive" else "permission_required")
      .put("detail", "Test-only selective packet enforcement for the controlled acceptance endpoint."))
    .toString()

  fun analyzeUrl(url: String): String {
    requireAcceptanceEnabled()
    val result = engine.analyzeUrl(url)
    return if (result == null) JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("URL was not accepted by the native sanitizer.")).toString()
      else JSONObject().put("supported", true).put("verdict", result.verdict).put("reasons", JSONArray())
        .put("sanitizedUrl", result.sanitizedUrl).put("host", result.host).put("ruleId", result.ruleId ?: JSONObject.NULL).toString()
  }

  @Synchronized fun evidence(): String = JSONArray(prefs.getString(KEY_EVIDENCE, "[]")).toString()
  @Synchronized fun acknowledgeEvidence(rawIds: String): String {
    val ids = JSONArray(rawIds); val remove = mutableSetOf<String>()
    for (i in 0 until ids.length()) remove.add(ids.getString(i))
    val current = JSONArray(prefs.getString(KEY_EVIDENCE, "[]")); val kept = JSONArray()
    for (i in 0 until current.length()) if (current.getJSONObject(i).optString("evidenceId") !in remove) kept.put(current.getJSONObject(i))
    check(prefs.edit().putString(KEY_EVIDENCE, kept.toString()).commit()) { "Could not acknowledge native evidence" }
    return JSONObject().put("acknowledged", current.length() - kept.length()).toString()
  }

  fun recovery(): String {
    val r = RecoveryInspector.inspect(context, state)
    return JSONObject().put("lifecycle", r.lifecycle).put("tunOpen", r.tunOpen)
      .put("selectiveRouteActive", r.selectiveRouteActive).put("vpnTransportPresent", r.vpnTransportPresent)
      .put("routeCidr", r.routeCidr ?: JSONObject.NULL).put("dropReporterAttached", r.dropReporterAttached).put("recovered", r.recovered).toString()
  }

  fun freshProbe(timeoutMs: Int): String {
    val activeConfig = checkNotNull(config) { "GuardDog candidate is not configured" }
    return JSONObject(FreshConnectionProbe.run(activeConfig.controlledUrl, activeConfig.controlledIpv4, timeoutMs, GuardDogVpnRuntime.resolver).toMap()).toString()
  }

  fun provenance(): String {
    val info = context.packageManager.getPackageInfo(context.packageName, 0); val apk = File(context.applicationInfo.sourceDir)
    val digest = MessageDigest.getInstance("SHA-256")
    apk.inputStream().use { input -> val buf = ByteArray(1 shl 16); while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n) } }
    return JSONObject().put("apkSha256", digest.digest().joinToString("") { "%02x".format(it) }).put("apkSizeBytes", apk.length())
      .put("splitApks", context.applicationInfo.splitSourceDirs?.size ?: 0).put("packageName", context.packageName)
      .put("versionName", info.versionName).put("versionCode", info.longVersionCode)
      .put("debuggable", context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
      .put("activeNativeStackId", STACK_ID).put("candidateTestOnly", true).toString()
  }

  fun runConsolidatedAcceptance(timeoutMs: Int): String {
    requireAcceptanceEnabled()
    val startedAt = Instant.now().toString()
    val build = JSONObject(provenance())
    val baseline = JSONObject(freshProbe(timeoutMs))
    check(baseline.optString("outcome") == "ok") { "Baseline controlled endpoint did not respond successfully" }
    lateinit var active: JSONObject
    lateinit var blocked: JSONObject
    lateinit var captured: JSONArray
    try {
      active = JSONObject(start())
      check(active.optBoolean("operational")) { "GuardDog runtime did not become ACTIVE" }
      blocked = JSONObject(freshProbe(timeoutMs))
      check(blocked.optBoolean("synDropShape")) { "Fresh controlled connection did not show verified SYN-drop shape" }
      captured = JSONArray(evidence())
      check(captured.length() > 0) { "No correlated native packet evidence was persisted" }
    } finally {
      stop()
    }
    val recovery = JSONObject(recovery())
    check(recovery.optBoolean("recovered")) { "VPN route/TUN recovery was not observed" }
    val after = JSONObject(freshProbe(timeoutMs))
    check(after.optString("outcome") == "ok") { "Controlled endpoint did not recover after stop" }
    return JSONObject().put("candidateTestOnly", true).put("startedAt", startedAt).put("completedAt", Instant.now().toString())
      .put("build", build).put("baseline", baseline).put("active", active).put("blocked", blocked)
      .put("evidence", captured).put("recovery", recovery).put("afterStop", after).put("passed", true).toString()
  }

  @Synchronized private fun persistEvidence(record: JSONObject) {
    val current = JSONArray(prefs.getString(KEY_EVIDENCE, "[]"))
    for (i in 0 until current.length()) if (current.getJSONObject(i).optString("evidenceId") == record.getString("evidenceId")) return
    current.put(record)
    check(prefs.edit().putString(KEY_EVIDENCE, current.toString()).commit()) { "Could not persist native enforcement evidence" }
  }

  private fun requireAcceptanceEnabled() {
    val info = context.packageManager.getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
    check(info.metaData?.getBoolean(ACCEPTANCE_METADATA_KEY, false) == true) {
      "GuardDog acceptance trust is disabled in this build"
    }
  }

  companion object {
    const val PROFILE = "guarddog-stage1d-acceptance"
    const val LABEL = "GuardDog acceptance runtime (test-only)"
    const val STACK_ID = "apollo-owned-guarddog-core-vpn"
    const val ACCEPTANCE_KEY_ID = "apollo-stage1d-acceptance-ed25519-001"
    const val ACCEPTANCE_PUBLIC_KEY_B64 = "bZeQ3t9aAOC9/eg7sCrKB5hNLBRKk/SZlDmYBhxNQrk="
    const val ACCEPTANCE_METADATA_KEY = "app.apollo.guarddog.acceptanceEnabled"
    private const val KEY_EVIDENCE = "pending_evidence"
  }
}