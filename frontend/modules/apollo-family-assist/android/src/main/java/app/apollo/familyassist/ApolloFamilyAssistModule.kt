package app.apollo.familyassist

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Process-wide Family Help state, shared by the module, the projection service and the viewer peer.
 * All state lives in [FamilyAssistStateStore] (no map that rejects nulls); every change names its session and
 * generation, and an event is sent only when the change was accepted for the current session.
 */
internal object FamilyAssistRuntime {
  val store = FamilyAssistStateStore()
  @Volatile var viewer: FamilyAssistRtcPeer? = null
  @Volatile var event: ((type: String, state: FamilyAssistState) -> Unit)? = null

  fun begin(sessionId: String, generation: String, captureState: String, eventName: String, captureScope: String? = null) {
    emit(eventName, store.begin(sessionId, generation, captureState, captureScope))
  }

  fun update(
    sessionId: String?, generation: String?, captureState: String, eventName: String,
    failure: String? = null, reason: String? = null, helperConnected: Boolean? = null, markStarted: Boolean = false,
  ) {
    if (store.transition(sessionId, generation, captureState, failure, reason, helperConnected, markStarted)) emit(eventName, store.snapshot())
  }

  /** The viewer peer ended by itself (helper stopped, signaling or transport failed). Only the current viewer counts. */
  fun viewerEnded(peer: FamilyAssistRtcPeer, sessionId: String, generation: String, reason: String) {
    synchronized(this) {
      if (viewer !== peer) return
      viewer = null
    }
    peer.close()
    if (reason in FamilyAssistRtcPeer.FAILURE_REASONS) update(sessionId, generation, "failed", "capture_failed", failure = reason)
    else update(sessionId, generation, "stopped", "capture_stopped", reason = reason)
  }

  fun closeViewer() {
    val current = synchronized(this) { viewer.also { viewer = null } }
    current?.close()
  }

  private fun emit(eventName: String, state: FamilyAssistState) { event?.invoke(eventName, state) }
}

class ApolloFamilyAssistModule : Module() {
  private var pending: HashMap<String, String>? = null
  private val requestCode = 7410

  override fun definition() = ModuleDefinition {
    Name("ApolloFamilyAssist")
    Events("onFamilyAssistEvent")
    OnCreate {
      FamilyAssistRuntime.event = { type, state ->
        sendEvent("onFamilyAssistEvent", state.toMap().apply { put("type", type); put("observedAt", java.time.Instant.now().toString()) })
      }
    }
    OnDestroy { FamilyAssistRuntime.event = null; FamilyAssistRuntime.closeViewer() }

    AsyncFunction("getCapabilities") {
      val scopes = if (Build.VERSION.SDK_INT >= 34) listOf("apollo_app", "selected_app", "full_display") else listOf("full_display")
      mapOf("platform" to "android", "screenShare" to "permission_required", "supportedScopes" to scopes,
        "helperViewing" to "available", "liveMicrophone" to "unavailable", "systemAudio" to "not_supported",
        "remoteControl" to "not_supported", "unavailableReason" to null, "observedAt" to java.time.Instant.now().toString())
    }
    AsyncFunction("getState") { FamilyAssistRuntime.store.snapshot().toMap() }
    AsyncFunction("startCapture") { input: Map<String, Any?> ->
      require(input["microphoneEnabled"] == false) { "microphone_not_supported" }
      require(FamilyAssistRuntime.store.canTakeOver()) { "capture_already_owned" }
      val activity = appContext.currentActivity ?: error("visible_activity_required")
      val values = requiredInput(input)
      pending = values
      FamilyAssistRuntime.begin(values.getValue("sessionId"), values.getValue("generation"), "requesting_consent", "consent_shown", values["captureScope"])
      val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(manager.createScreenCaptureIntent(), requestCode)
    }
    OnActivityResult { _, payload ->
      if (payload.requestCode != requestCode) return@OnActivityResult
      val values = pending.also { pending = null } ?: return@OnActivityResult
      val sessionId = values.getValue("sessionId"); val generation = values.getValue("generation")
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        FamilyAssistRuntime.update(sessionId, generation, "stopped", "consent_denied", reason = "consent_denied"); return@OnActivityResult
      }
      val context = appContext.reactContext
      if (context == null) {
        FamilyAssistRuntime.update(sessionId, generation, "failed", "capture_failed", failure = "context_unavailable"); return@OnActivityResult
      }
      val intent = Intent(context, FamilyAssistProjectionService::class.java).apply {
        action = FamilyAssistProjectionService.ACTION_START
        putExtra(FamilyAssistProjectionService.EXTRA_RESULT_CODE, payload.resultCode)
        putExtra(FamilyAssistProjectionService.EXTRA_RESULT_DATA, payload.data)
        values.forEach { (key, value) -> putExtra(key, value) }
      }
      FamilyAssistRuntime.update(sessionId, generation, "starting", "capture_starting")
      androidx.core.content.ContextCompat.startForegroundService(context, intent)
    }
    AsyncFunction("pauseCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_PAUSE) }
    AsyncFunction("resumeCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_RESUME) }
    AsyncFunction("stopCapture") { sessionId: String, generation: String -> command(sessionId, generation, FamilyAssistProjectionService.ACTION_STOP) }
    AsyncFunction("startViewer") { input: Map<String, Any?> ->
      val values = requiredViewerInput(input)
      val sessionId = values.getValue("sessionId"); val generation = values.getValue("generation")
      val context = appContext.reactContext?.applicationContext ?: error("context_unavailable")
      FamilyAssistRuntime.closeViewer()
      FamilyAssistRenderer.reset()
      FamilyAssistRuntime.begin(sessionId, generation, "starting", "capture_starting")
      lateinit var created: FamilyAssistRtcPeer
      created = FamilyAssistRtcPeer(context, values, false) { reason -> FamilyAssistRuntime.viewerEnded(created, sessionId, generation, reason) }
      FamilyAssistRuntime.viewer = created
      created.connect()
    }
    AsyncFunction("stopViewer") { sessionId: String, generation: String ->
      requireCurrent(sessionId, generation)
      FamilyAssistRuntime.closeViewer()
      FamilyAssistRuntime.update(sessionId, generation, "stopped", "capture_stopped", reason = "helper_left")
    }
    View(FamilyAssistViewerView::class) {}
  }

  private fun command(sessionId: String, generation: String, action: String) {
    requireCurrent(sessionId, generation)
    val context = appContext.reactContext ?: error("context_unavailable")
    context.startService(Intent(context, FamilyAssistProjectionService::class.java).setAction(action).putExtra("sessionId", sessionId).putExtra("generation", generation))
  }
  private fun requireCurrent(sessionId: String, generation: String) {
    require(FamilyAssistRuntime.store.snapshot().owns(sessionId, generation)) { "stale_generation" }
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
