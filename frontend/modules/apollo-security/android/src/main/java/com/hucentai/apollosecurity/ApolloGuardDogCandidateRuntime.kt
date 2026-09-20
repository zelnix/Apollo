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
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

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

internal data class AcceptanceProbeContext(
  val runId: String, val probeId: String, val sessionId: String, val destinationHost: String, val destinationIp: String,
  val destinationPort: Int, val sourcePort: Int, val startedAtEpochMillis: Long, val deadlineEpochMillis: Long,
) {
  fun matches(evidence: BlockedThreatEvidence, currentSessionId: String?): Boolean =
    currentSessionId == sessionId && evidence.destinationIpv4 == destinationIp && evidence.destinationPort == destinationPort &&
      evidence.sourcePort == sourcePort && evidence.ipProtocol == 6 &&
      evidence.observedAtEpochMillis in startedAtEpochMillis..deadlineEpochMillis
}

internal data class AcceptanceEvidenceRef(
  val evidenceId: String, val runId: String?, val probeId: String?, val sessionId: String?,
  val destinationHost: String?, val destinationIp: String?, val destinationPort: Int?, val observedAtEpochMillis: Long?,
)

internal object ApolloAcceptanceEvidenceGate {
  fun matches(record: AcceptanceEvidenceRef, run: AcceptanceProbeContext, historicalIds: Set<String>): Boolean =
    record.evidenceId !in historicalIds && record.runId == run.runId && record.probeId == run.probeId &&
      record.sessionId == run.sessionId && record.destinationIp == run.destinationIp && record.destinationPort == run.destinationPort &&
      record.destinationHost == run.destinationHost &&
      record.observedAtEpochMillis != null && record.observedAtEpochMillis in run.startedAtEpochMillis..run.deadlineEpochMillis
}

internal object ApolloGuardDogEvidenceCorrelator {
  fun correlate(event: SecurityEvent, original: BlockedThreatEvidence, osVersion: String): Map<String, Any?>? {
    if (!event.isGenuineBlock || event.enforcementEvidenceId != original.enforcementEvidenceId) return null
    if (event.destinationIp != original.destinationIpv4 || event.host.isNullOrBlank() || event.ruleId.isNullOrBlank()) return null
    val protocol = when (original.ipProtocol) { 6 -> "tcp"; 17 -> "udp"; else -> "unknown" }
    val contractVerified = protocol != "unknown" && original.destinationPort != null
    return mapOf(
      "evidenceId" to original.enforcementEvidenceId, "eventId" to null, "deviceId" to null,
      "platform" to "android", "osVersion" to osVersion, "sdkVersion" to null,
      "observedAt" to Instant.ofEpochMilli(original.observedAtEpochMillis).toString(),
      "mechanism" to "packet_filter", "direction" to "outbound", "protocol" to protocol,
      "destination" to mapOf("ip" to original.destinationIpv4, "domain" to event.host, "port" to original.destinationPort),
      "attribution" to mapOf("appId" to null, "processName" to null, "confidence" to "unavailable"),
      "matchedRuleId" to event.ruleId, "threatId" to null, "requestedAction" to "block", "enforcedAction" to "blocked",
      "result" to if (contractVerified) "verified" else "unverified", "ruleSource" to "local_blocklist",
      "confidence" to "high", "correlationId" to event.id,
      "sourceMetadata" to mapOf("ipProtocolNumber" to original.ipProtocol, "sourcePort" to original.sourcePort,
        "packetLength" to original.packetLength, "flowKey" to original.flowKey, "enforcementLayer" to original.enforcementLayer,
        "rawRuleSource" to "signed_guarddog_bundle", "rulesetId" to event.rulesetId, "bundleVersion" to event.bundleVersion),
    )
  }

  fun contractValid(record: Map<String, Any?>): Boolean {
    val protocol = record["protocol"] as? String ?: return false
    val result = record["result"] as? String ?: return false
    val ruleSource = record["ruleSource"] as? String ?: return false
    val requestedAction = record["requestedAction"] as? String ?: return false
    val enforcedAction = record["enforcedAction"] as? String ?: return false
    val confidence = record["confidence"] as? String ?: return false
    val destination = record["destination"] as? Map<*, *> ?: return false
    val attribution = record["attribution"] as? Map<*, *> ?: return false
    val port = destination["port"]
    val observed = record["observedAt"] as? String ?: return false
    return (record["evidenceId"] as? String)?.isNotBlank() == true && record["platform"] == "android" && record["mechanism"] == "packet_filter" &&
      record["direction"] == "outbound" && protocol in setOf("tcp", "udp", "dns", "http", "https", "unknown") &&
      result in setOf("verified", "unverified", "failed") && ruleSource in
      setOf("local_blocklist", "cloud_intel", "heuristic", "user_override", "unknown") &&
      (destination["ip"] as? String)?.isNotBlank() == true && (destination["domain"] as? String)?.isNotBlank() == true &&
      (port == null || port is Int && port in 1..65535) && attribution["confidence"] in setOf("high", "medium", "low", "unavailable") &&
      requestedAction in setOf("block", "allow", "monitor") && enforcedAction in setOf("blocked", "allowed", "monitored", "none") &&
      confidence in setOf("high", "medium", "low") && record["sourceMetadata"] is Map<*, *> &&
      runCatching { Instant.parse(observed) }.isSuccess && (result != "verified" || protocol != "unknown" && port != null && enforcedAction == "blocked")
  }
}

private data class PendingEvidence(val evidence: BlockedThreatEvidence, val probe: AcceptanceProbeContext?)

/** Process-owned, acceptance-only runtime over frozen GuardDog core/VPN. */
internal class ApolloGuardDogCandidateRuntime(private val context: Context) {
  private val transitions = ApolloEnforcementTransitions.coordinator
  private val state = VpnStateRepository.shared
  private val prefs = context.getSharedPreferences("apollo_guarddog_candidate", Context.MODE_PRIVATE)
  private val inbox = BoundedEvidenceInbox(EVIDENCE_CAPACITY, SharedPreferencesEvidencePersistence(prefs)) {
    runCatching { JSONObject(it).optString("evidenceId").takeIf(String::isNotBlank) }.getOrNull()
  }
  private val engine = GuardDogSDKEngine(
    RuleBundleVerifier(TrustedKeyRegistry(mapOf(ACCEPTANCE_KEY_ID to ACCEPTANCE_PUBLIC_KEY_B64)), ApolloBundleVersionStore(context), SystemClock), state, SystemClock,
  )
  private val pending = ConcurrentHashMap<String, PendingEvidence>()
  private val activeProbe = AtomicReference<AcceptanceProbeContext?>(null)
  private var config: VpnConfig? = null
  private val reporter = ProtectionEnforcementReporter { evidence ->
    val probe = activeProbe.get()?.takeIf { it.matches(evidence, state.current().activeSessionId) }
    pending[evidence.enforcementEvidenceId] = PendingEvidence(evidence, probe)
    try { engine.reportBlockedPacket(evidence) }
    catch (_: Throwable) { inbox.reportFailure("GuardDog engine event reporting failed") }
    finally { pending.remove(evidence.enforcementEvidenceId) }
  }

  init {
    migrateLegacyEvidence()
    state.osConsentCheck = { VpnService.prepare(context) == null }
    engine.addEventListener { event ->
      try {
        val item = pending[event.enforcementEvidenceId ?: return@addEventListener] ?: return@addEventListener
        val record = ApolloGuardDogEvidenceCorrelator.correlate(event, item.evidence, "Android ${android.os.Build.VERSION.RELEASE}") ?: return@addEventListener
        if (!ApolloGuardDogEvidenceCorrelator.contractValid(record)) { inbox.reportFailure("Native evidence violated the public bridge contract"); return@addEventListener }
        val mutable = record.toMutableMap()
        item.probe?.let { probe ->
          val source = (record["sourceMetadata"] as Map<*, *>).entries.associate { it.key.toString() to it.value }.toMutableMap()
          source["acceptanceRunId"] = probe.runId; source["acceptanceProbeId"] = probe.probeId; source["protectionSessionId"] = probe.sessionId
          mutable["sourceMetadata"] = source
        }
        inbox.append(JSONObject(mutable).toString())
      } catch (_: Throwable) { inbox.reportFailure("Native evidence correlation or persistence failed") }
    }
  }

  fun configure(raw: String): String = transitions.serialized {
    requireAcceptanceEnabled()
    val body = JSONObject(raw); check(body.optString("profile") == PROFILE) { "GuardDog candidate profile is test-only" }
    val next = VpnConfig(body.getString("controlledHost"), body.getString("controlledIpv4"), body.getString("controlledUrl"),
      body.getString("rulesetId"), body.optLong("dedupeWindowMs", 2_000L))
    config = next; GuardDogVpnRuntime.config = next; GuardDogVpnRuntime.reporter = reporter
    GuardDogVpnRuntime.websiteGateEngine = null; GuardDogVpnRuntime.websiteGateRouteConfig = null
    JSONObject().put("configured", true).put("profile", PROFILE).toString()
  }

  fun acceptBundle(raw: String): String = transitions.serialized {
    requireAcceptanceEnabled()
    when (val result = engine.acceptRuleBundle(raw)) {
      is VerificationResult.Accepted -> JSONObject().put("accepted", true).put("rulesetId", result.bundle.rulesetId)
        .put("bundleVersion", result.bundle.bundleVersion).put("expiresAt", result.bundle.expiresAt).toString()
      is VerificationResult.Rejected -> JSONObject().put("accepted", false).put("reason", result.reason.name)
        .put("detail", result.detail ?: JSONObject.NULL).toString()
    }
  }

  fun start(): String = transitions.serialized { startLocked() }
  fun stop(): String = transitions.serialized { stopLocked() }
  fun ownsEnforcement(): Boolean = prefs.getBoolean("requested", false) || state.current().state in setOf(ProtectionState.STARTING, ProtectionState.ACTIVE)

  private fun startLocked(): String {
    requireAcceptanceEnabled(); ensureLegacyStopped()
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
    check(prefs.edit().putBoolean("requested", true).putString("since", Instant.now().toString()).commit()) { "Could not persist candidate request state" }
    context.startForegroundService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_START))
    if (!transitions.await(START_TIMEOUT_MS) { actualOperational() }) {
      context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
      error("GuardDog start transition timed out before ACTIVE TUN/route/session/reporter observations")
    }
    return statusLocked()
  }

  private fun stopLocked(): String {
    context.startService(Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP))
    check(prefs.edit().putBoolean("requested", false).remove("since").commit()) { "Could not persist candidate stop request" }
    if (!transitions.await(STOP_TIMEOUT_MS) { actualRecovered() }) error("GuardDog stop transition timed out before TUN/route/reporter recovery")
    engine.clearAuthorization()
    return statusLocked()
  }

  private fun ensureLegacyStopped() {
    if (!ApolloDnsVpnService.isRunning) return
    context.startService(Intent(context, ApolloDnsVpnService::class.java).setAction(ApolloDnsVpnService.ACTION_STOP))
    if (!transitions.await(LEGACY_STOP_TIMEOUT_MS) { !ApolloDnsVpnService.isRunning }) error("Legacy Site Guard did not stop before GuardDog start")
  }

  private fun actualOperational(): Boolean {
    val snapshot = state.current(); val runtime = RecoveryInspector.inspect(context, state)
    return snapshot.state == ProtectionState.ACTIVE && !snapshot.activeSessionId.isNullOrBlank() && runtime.lifecycle == "ACTIVE" &&
      runtime.tunOpen && runtime.selectiveRouteActive && runtime.dropReporterAttached
  }

  private fun actualRecovered(): Boolean = state.current().state != ProtectionState.ACTIVE && RecoveryInspector.inspect(context, state).recovered

  fun status(): String = transitions.serialized { statusLocked() }
  private fun statusLocked(): String {
    val snapshot = state.current(); val runtime = RecoveryInspector.inspect(context, state); val operational = actualOperational()
    val requested = prefs.getBoolean("requested", false); val inboxStatus = inbox.status(); val checked = Instant.now().toString()
    return JSONObject().put("running", operational).put("requested", requested).put("operational", operational)
      .put("enforcementMethod", "packet_filter").put("coverage", "Acceptance-only selective /32 packet filtering for the verified controlled endpoint.")
      .put("coverageScope", JSONArray().put("ip:controlled-/32")).put("lastVerified", if (operational) checked else JSONObject.NULL)
      .put("degradedReason", if (requested && !operational) (snapshot.reason ?: "TUN/route/session/reporter observation incomplete") else JSONObject.NULL)
      .put("visibility", if (operational) "full" else "none").put("since", prefs.getString("since", null) ?: JSONObject.NULL)
      .put("adapterLabel", LABEL).put("checkedAt", checked).put("candidateTestOnly", true)
      .put("nativeLifecycle", runtime.lifecycle).put("activeSessionId", snapshot.activeSessionId ?: JSONObject.NULL)
      .put("tunOpen", runtime.tunOpen).put("selectiveRouteActive", runtime.selectiveRouteActive).put("dropReporterAttached", runtime.dropReporterAttached)
      .put("evidencePending", inboxStatus.pending).put("evidenceCapacity", inboxStatus.capacity).put("evidenceOverflow", inboxStatus.overflow)
      .put("evidencePersistenceError", inboxStatus.error ?: JSONObject.NULL).toString()
  }

  fun capabilities(): String = JSONArray().put(JSONObject().put("id", "site_guard").put("title", "GuardDog Candidate")
    .put("status", if (actualOperational()) "active" else if (VpnService.prepare(context) == null) "inactive" else "permission_required")
    .put("detail", "Test-only selective packet enforcement for the controlled acceptance endpoint.")).toString()

  fun analyzeUrl(url: String): String = transitions.serialized {
    requireAcceptanceEnabled(); val result = engine.analyzeUrl(url)
    if (result == null) JSONObject().put("supported", false).put("verdict", "unknown").put("reasons", JSONArray().put("URL was not accepted by the native sanitizer.")).toString()
    else JSONObject().put("supported", true).put("verdict", result.verdict).put("reasons", JSONArray())
      .put("sanitizedUrl", result.sanitizedUrl).put("host", result.host).put("ruleId", result.ruleId ?: JSONObject.NULL).toString()
  }

  fun evidence(): String {
    val valid = inbox.records().filter { raw -> runCatching { contractValidJson(JSONObject(raw)) }.getOrDefault(false) }
    if (valid.size != inbox.status().pending) inbox.reportFailure("Invalid persisted native evidence was withheld at the bridge")
    return "[${valid.joinToString(",")}]"
  }
  fun acknowledgeEvidence(rawIds: String): String {
    val ids = JSONArray(rawIds); val remove = (0 until ids.length()).map { ids.getString(it) }.toSet()
    val acknowledged = inbox.acknowledge(remove); val state = inbox.status()
    return JSONObject().put("acknowledged", acknowledged).put("pending", state.pending)
      .put("persistenceError", state.error ?: JSONObject.NULL).toString()
  }

  fun recovery(): String { val r = RecoveryInspector.inspect(context, state); return JSONObject().put("lifecycle", r.lifecycle).put("tunOpen", r.tunOpen)
    .put("selectiveRouteActive", r.selectiveRouteActive).put("vpnTransportPresent", r.vpnTransportPresent)
    .put("routeCidr", r.routeCidr ?: JSONObject.NULL).put("dropReporterAttached", r.dropReporterAttached).put("recovered", r.recovered).toString() }

  fun freshProbe(timeoutMs: Int): String { val activeConfig = checkNotNull(config) { "GuardDog candidate is not configured" }
    return JSONObject(FreshConnectionProbe.run(activeConfig.controlledUrl, activeConfig.controlledIpv4, timeoutMs, GuardDogVpnRuntime.resolver).toMap()).toString() }

  fun provenance(): String {
    val info = context.packageManager.getPackageInfo(context.packageName, 0); val apk = File(context.applicationInfo.sourceDir); val digest = MessageDigest.getInstance("SHA-256")
    apk.inputStream().use { input -> val buf = ByteArray(1 shl 16); while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n) } }
    return JSONObject().put("apkSha256", digest.digest().joinToString("") { "%02x".format(it) }).put("apkSizeBytes", apk.length())
      .put("splitApks", context.applicationInfo.splitSourceDirs?.size ?: 0).put("packageName", context.packageName)
      .put("versionName", info.versionName).put("versionCode", info.longVersionCode)
      .put("debuggable", context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
      .put("activeNativeStackId", STACK_ID).put("candidateTestOnly", true).toString()
  }

  fun runConsolidatedAcceptance(timeoutMs: Int): String = transitions.serialized {
    requireAcceptanceEnabled(); val activeConfig = checkNotNull(config); val runId = UUID.randomUUID().toString(); val historical = evidenceIds()
    val startedAt = Instant.now().toString(); val build = JSONObject(provenance()); val baseline = JSONObject(freshProbe(timeoutMs))
    check(baseline.optString("outcome") == "ok") { "Baseline controlled endpoint did not respond successfully" }
    lateinit var active: JSONObject; lateinit var blocked: JSONObject; lateinit var captured: JSONArray; lateinit var runProbe: AcceptanceProbeContext
    try {
      active = JSONObject(startLocked()); val sessionId = active.getString("activeSessionId")
      val probeResult = runIntentionalDropProbe(runId, sessionId, activeConfig, timeoutMs); blocked = probeResult.first; runProbe = probeResult.second
      check(blocked.optBoolean("synDropShape")) { "Run-scoped controlled SYN did not show intentional drop shape" }
      captured = matchingRunEvidence(runProbe, historical)
      check(captured.length() > 0) { "No newly observed packet matched this run/probe/session/destination" }
    } finally { stopLocked() }
    val recovered = JSONObject(recovery()); check(recovered.optBoolean("recovered")) { "VPN route/TUN recovery was not observed" }
    val after = JSONObject(freshProbe(timeoutMs)); check(after.optString("outcome") == "ok") { "Controlled endpoint did not recover after stop" }
    JSONObject().put("candidateTestOnly", true).put("runId", runId).put("probeId", runProbe.probeId).put("sessionId", runProbe.sessionId)
      .put("startedAt", startedAt).put("completedAt", Instant.now().toString()).put("build", build).put("baseline", baseline)
      .put("active", active).put("blocked", blocked).put("evidence", captured).put("recovery", recovered).put("afterStop", after).put("passed", true).toString()
  }

  private fun runIntentionalDropProbe(runId: String, sessionId: String, activeConfig: VpnConfig, timeoutMs: Int): Pair<JSONObject, AcceptanceProbeContext> {
    val uri = URI(activeConfig.controlledUrl); val port = if (uri.port > 0) uri.port else 443
    val probeId = UUID.randomUUID().toString(); val socket = Socket(); socket.bind(InetSocketAddress(0)); val started = System.currentTimeMillis()
    val probe = AcceptanceProbeContext(runId, probeId, sessionId, activeConfig.controlledHost, activeConfig.controlledIpv4,
      port, socket.localPort, started, started + timeoutMs + 1_000)
    check(activeProbe.compareAndSet(null, probe)) { "Another acceptance probe is active" }
    var timedOut = false; var connected = false; var error: String? = null
    try { socket.connect(InetSocketAddress(activeConfig.controlledIpv4, port), timeoutMs); connected = socket.isConnected }
    catch (_: SocketTimeoutException) { timedOut = true }
    catch (failure: Throwable) { error = failure.javaClass.simpleName }
    if (timedOut) transitions.await(1_000, 25) { hasTaggedEvidence(probe) }
    activeProbe.compareAndSet(probe, null); runCatching { socket.close() }
    val elapsed = System.currentTimeMillis() - started; val dropShape = timedOut && !connected && elapsed >= (timeoutMs * 8L / 10L)
    return JSONObject().put("runId", runId).put("probeId", probeId).put("sessionId", sessionId).put("sourcePort", probe.sourcePort)
      .put("destinationIp", probe.destinationIp).put("destinationPort", port).put("timedOut", timedOut).put("connected", connected)
      .put("elapsedMs", elapsed).put("error", error ?: JSONObject.NULL).put("synDropShape", dropShape) to probe
  }

  private fun matchingRunEvidence(probe: AcceptanceProbeContext, historicalIds: Set<String>): JSONArray {
    val matches = JSONArray()
    inbox.records().forEach { raw ->
      val record = JSONObject(raw); val source = record.optJSONObject("sourceMetadata") ?: JSONObject(); val destination = record.optJSONObject("destination") ?: JSONObject()
      val ref = AcceptanceEvidenceRef(record.optString("evidenceId"), source.optString("acceptanceRunId").takeIf { it.isNotBlank() },
        source.optString("acceptanceProbeId").takeIf { it.isNotBlank() }, source.optString("protectionSessionId").takeIf { it.isNotBlank() },
        destination.optString("domain").takeIf { it.isNotBlank() }, destination.optString("ip").takeIf { it.isNotBlank() },
        destination.optInt("port").takeIf { destination.has("port") && !destination.isNull("port") },
        runCatching { Instant.parse(record.getString("observedAt")).toEpochMilli() }.getOrNull())
      if (ApolloAcceptanceEvidenceGate.matches(ref, probe, historicalIds)) matches.put(record)
    }
    return matches
  }

  private fun evidenceIds(): Set<String> = inbox.records().mapNotNull { runCatching { JSONObject(it).optString("evidenceId") }.getOrNull() }.toSet()
  private fun hasTaggedEvidence(probe: AcceptanceProbeContext): Boolean = inbox.records().any { raw ->
    runCatching {
      val source = JSONObject(raw).getJSONObject("sourceMetadata")
      source.optString("acceptanceRunId") == probe.runId && source.optString("acceptanceProbeId") == probe.probeId &&
        source.optString("protectionSessionId") == probe.sessionId
    }.getOrDefault(false)
  }

  private fun migrateLegacyEvidence() {
    val legacyKey = "pending_evidence"
    if (!prefs.contains(legacyKey)) return
    try {
      val legacy = JSONArray(prefs.getString(legacyKey, "[]"))
      for (index in 0 until legacy.length()) {
        val record = legacy.getJSONObject(index)
        if (contractValidJson(record)) inbox.append(record.toString()) else inbox.reportFailure("Invalid legacy native evidence was not migrated")
      }
      if (!prefs.edit().remove(legacyKey).commit()) inbox.reportFailure("Legacy native evidence storage could not be retired")
    } catch (_: Throwable) { inbox.reportFailure("Legacy native evidence storage could not be bounded") }
  }

  private fun contractValidJson(record: JSONObject): Boolean {
    val destination = record.optJSONObject("destination") ?: return false
    val attribution = record.optJSONObject("attribution") ?: return false
    val protocol = record.optString("protocol")
    val result = record.optString("result")
    val portValid = destination.isNull("port") || destination.optInt("port") in 1..65535
    return record.optString("evidenceId").isNotBlank() && record.optString("platform") == "android" &&
      record.optString("mechanism") == "packet_filter" && record.optString("direction") == "outbound" &&
      protocol in setOf("tcp", "udp", "dns", "http", "https", "unknown") && result in setOf("verified", "unverified", "failed") &&
      record.optString("ruleSource") in setOf("local_blocklist", "cloud_intel", "heuristic", "user_override", "unknown") &&
      destination.optString("ip").isNotBlank() && destination.optString("domain").isNotBlank() && portValid &&
      attribution.optString("confidence") in setOf("high", "medium", "low", "unavailable") &&
      record.optString("requestedAction") in setOf("block", "allow", "monitor") &&
      record.optString("enforcedAction") in setOf("blocked", "allowed", "monitored", "none") &&
      record.optString("confidence") in setOf("high", "medium", "low") && record.optJSONObject("sourceMetadata") != null &&
      runCatching { Instant.parse(record.getString("observedAt")) }.isSuccess &&
      (result != "verified" || protocol != "unknown" && !destination.isNull("port") && record.optString("enforcedAction") == "blocked")
  }

  private fun requireAcceptanceEnabled() { check(ApolloGuardDogProcessOwner.isEligible(context)) { "GuardDog acceptance trust is disabled in this build" } }

  companion object {
    const val PROFILE = "guarddog-stage1d-acceptance"; const val LABEL = "GuardDog acceptance runtime (test-only)"
    const val STACK_ID = "apollo-owned-guarddog-core-vpn"; const val ACCEPTANCE_KEY_ID = "apollo-stage1d-acceptance-ed25519-001"
    const val ACCEPTANCE_PUBLIC_KEY_B64 = "bZeQ3t9aAOC9/eg7sCrKB5hNLBRKk/SZlDmYBhxNQrk="
    const val ACCEPTANCE_METADATA_KEY = "app.apollo.guarddog.acceptanceEnabled"
    const val EVIDENCE_CAPACITY = 256
    private const val START_TIMEOUT_MS = 10_000L; private const val STOP_TIMEOUT_MS = 8_000L; private const val LEGACY_STOP_TIMEOUT_MS = 4_000L
  }
}