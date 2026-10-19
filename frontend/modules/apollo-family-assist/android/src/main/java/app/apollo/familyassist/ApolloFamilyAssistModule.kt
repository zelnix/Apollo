package app.apollo.familyassist

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

internal object FamilyAssistRuntime {
  val state = ConcurrentHashMap<String, Any?>().apply {
    put("sessionId", null); put("generation", null); put("captureState", "idle"); put("helperConnected", false)
    put("captureScope", null); put("microphoneEnabled", false); put("startedAt", null); put("lastTransitionAt", isoNow()); put("failureCode", null); put("endReason", null)
  }
  var viewer: FamilyAssistRtcPeer? = null
  var event: ((String) -> Unit)? = null
  fun update(captureState: String, eventName: String? = null, failure: String? = null, reason: String? = null) {
    state["captureState"] = captureState; state["lastTransitionAt"] = isoNow(); state["failureCode"] = failure; state["endReason"] = reason
    if (eventName != null) event?.invoke(eventName)
  }
  fun isoNow() = java.time.Instant.now().toString()
}

private fun isoNow() = FamilyAssistRuntime.isoNow()

class ApolloFamilyAssistModule : Module() {
  private var pending: HashMap<String, String>? = null
  private val requestCode = 7410

  override fun definition() = ModuleDefinition {
    Name("ApolloFamilyAssist")
    Events("onFamilyAssistEvent")
    OnCreate { FamilyAssistRuntime.event = { type -> sendEvent("onFamilyAssistEvent", HashMap(FamilyAssistRuntime.state).apply { put("type", type); put("observedAt", isoNow()) }) } }
    OnDestroy { FamilyAssistRuntime.event = null; FamilyAssistRuntime.viewer?.close(); FamilyAssistRuntime.viewer = null }

    AsyncFunction("getCapabilities") {
      val scopes = if (Build.VERSION.SDK_INT >= 34) listOf("apollo_app", "selected_app", "full_display") else listOf("full_display")
      mapOf("platform" to "android", "screenShare" to "permission_required", "supportedScopes" to scopes,
        "helperViewing" to "available", "liveMicrophone" to "unavailable", "systemAudio" to "not_supported",
        "remoteControl" to "not_supported", "unavailableReason" to null, "observedAt" to isoNow())
    }
    AsyncFunction("getState") { HashMap(FamilyAssistRuntime.state) }
    AsyncFunction("startCapture") { input: Map<String, Any?> ->
      require(input["microphoneEnabled"] == false) { "microphone_not_supported" }
      require(FamilyAssistRuntime.state["captureState"] in listOf("idle", "stopped", "failed")) { "capture_already_owned" }
      val activity = appContext.currentActivity ?: error("visible_activity_required")
      val values = requiredInput(input)
      pending = values
      FamilyAssistRuntime.state.putAll(mapOf("sessionId" to values["sessionId"], "generation" to values["generation"], "captureScope" to values["captureScope"], "microphoneEnabled" to false))
      FamilyAssistRuntime.update("requesting_consent", "consent_shown")
      val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(manager.createScreenCaptureIntent(), requestCode)
    }
    OnActivityResult { _, payload ->
      if (payload.requestCode != requestCode) return@OnActivityResult
      val values = pending.also { pending = null }
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null || values == null) {
        FamilyAssistRuntime.update("stopped", "consent_denied"); return@OnActivityResult
      }
      val context = appContext.reactContext ?: return@OnActivityResult FamilyAssistRuntime.update("failed", "capture_failed", "context_unavailable")
      val intent = Intent(context, FamilyAssistProjectionService::class.java).apply {
        action = FamilyAssistProjectionService.ACTION_START
        putExtra(FamilyAssistProjectionService.EXTRA_RESULT_CODE, payload.resultCode)
        putExtra(FamilyAssistProjectionService.EXTRA_RESULT_DATA, payload.data)
        values.forEach { (key, value) -> putExtra(key, value) }
      }
      androidx.core.content.ContextCompat.startForegroundService(context, intent)
      FamilyAssistRuntime.update("starting", "capture_starting")
    }
    AsyncFunction("pauseCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_PAUSE) }
    AsyncFunction("resumeCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_RESUME) }
    AsyncFunction("stopCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_STOP) }
    AsyncFunction("startViewer") { input: Map<String, Any?> ->
      val values = requiredViewerInput(input)
      val context = appContext.reactContext?.applicationContext ?: error("context_unavailable")
      FamilyAssistRuntime.viewer?.close()
      FamilyAssistRuntime.state.putAll(mapOf("sessionId" to values["sessionId"], "generation" to values["generation"], "captureState" to "starting"))
      FamilyAssistRuntime.viewer = FamilyAssistRtcPeer(context, values, false, null).also { it.connect() }
    }
    AsyncFunction("stopViewer") { sessionId: String, generation: String ->
      requireCurrent(sessionId, generation); FamilyAssistRuntime.viewer?.close(); FamilyAssistRuntime.viewer = null
      FamilyAssistRuntime.update("stopped", "capture_stopped")
    }
    View(FamilyAssistViewerView::class) {}
  }

  private fun command(sessionId: String, generation: String, action: String) {
    requireCurrent(sessionId, generation)
    val context = appContext.reactContext ?: error("context_unavailable")
    context.startService(Intent(context, FamilyAssistProjectionService::class.java).setAction(action).putExtra("sessionId", sessionId).putExtra("generation", generation))
  }
  private fun requireCurrent(sessionId: String, generation: String) {
    require(FamilyAssistRuntime.state["sessionId"] == sessionId && FamilyAssistRuntime.state["generation"] == generation) { "stale_generation" }
  }
  private fun requiredInput(input: Map<String, Any?>) = hashMapOf(
    "sessionId" to required(input, "sessionId"), "generation" to required(input, "generation"), "captureScope" to required(input, "captureScope"),
    "ephemeralSignalingTicket" to required(input, "ephemeralSignalingTicket"), "signalingBaseUrl" to required(input, "signalingBaseUrl"),
    "helperDisplayName" to required(input, "helperDisplayName"), "expiresAt" to required(input, "expiresAt"))
  private fun requiredViewerInput(input: Map<String, Any?>) = hashMapOf(
    "sessionId" to required(input, "sessionId"), "generation" to required(input, "generation"),
    "ephemeralSignalingTicket" to required(input, "ephemeralSignalingTicket"), "signalingBaseUrl" to required(input, "signalingBaseUrl"))
  private fun required(input: Map<String, Any?>, key: String) = (input[key] as? String)?.takeIf { it.isNotBlank() } ?: error("missing_$key")
}