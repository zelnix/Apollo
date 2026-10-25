package app.apollo.familyassist

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * One Family Help WebRTC session (sharer or viewer).
 *
 * Ownership: this peer builds its own PeerConnectionFactory through [FamilyAssistWebRtc] and disposes it — with
 * the peer connection, the local track and the video source — when it closes. A sharer's screen track is made
 * by this same factory ([createScreenSource]), never by a second one.
 *
 * Threads: signaling messages and teardown run on one private executor. Nothing here touches a view.
 * After [close] every callback is ignored, and every state change is fenced by session and generation.
 *
 * Ending: the peer never tears itself down. When the far side terminates, signaling fails or the transport
 * fails, it reports [onEnded] once; the owner stops its capture first and then calls [close], so a capturer is
 * never left feeding a disposed video source.
 */
class FamilyAssistRtcPeer(
  context: Context,
  private val values: Map<String, String>,
  private val sharer: Boolean,
  private val onEnded: (reason: String) -> Unit,
) : WebSocketListener(), PeerConnection.Observer {
  private val sessionId = values.getValue("sessionId")
  private val generation = values.getValue("generation")
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val client = OkHttpClient.Builder().pingInterval(java.time.Duration.ofSeconds(20)).build()
  private val factory: PeerConnectionFactory = FamilyAssistWebRtc.createFactory(context)
  private val closed = AtomicBoolean(false)
  // Set the moment the owner closes or terminates, before teardown runs: from then on no callback may change state.
  private val closing = AtomicBoolean(false)
  private val ended = AtomicBoolean(false)
  private val sequence = AtomicInteger(0)
  private val sendLock = Any()
  private var socket: WebSocket? = null
  private var peer: PeerConnection? = null
  private var source: VideoSource? = null
  private var localTrack: VideoTrack? = null
  private var refreshFuture: ScheduledFuture<*>? = null
  // The route WebRTC picked for the picture, and whether the connection is up; both written on the WebRTC thread.
  @Volatile private var selectedPath: String? = null
  @Volatile private var connected = false

  /** Sharer only, once, before [connect]: the source the screen capturer feeds, from this session's factory. */
  fun createScreenSource(): VideoSource {
    check(sharer && source == null) { "screen_source_already_created" }
    val created = factory.createVideoSource(true)
    source = created
    localTrack = factory.createVideoTrack("apollo-screen", created)
    return created
  }

  fun connect() {
    if (closed.get()) return
    val base = values.getValue("signalingBaseUrl").replace("https://", "wss://").replace("http://", "ws://").trimEnd('/')
    val ticket = URLEncoder.encode(values.getValue("ephemeralSignalingTicket"), StandardCharsets.UTF_8.toString())
    val url = "$base/family/assist/sessions/$sessionId/signal?ticket=$ticket"
    socket = client.newWebSocket(Request.Builder().url(url).build(), this)
  }

  // ── Signaling ──
  override fun onMessage(webSocket: WebSocket, text: String) {
    post {
      try {
        handle(JSONObject(text))
      } catch (error: Exception) {
        end("signaling_invalid")
      }
    }
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { end("signaling_failed") }
  override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null); end("signaling_closed") }
  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { end("signaling_closed") }

  private fun handle(message: JSONObject) {
    // A message that names another generation belongs to an older session: ignore it.
    val messageGeneration = message.optString("generation", "")
    if (messageGeneration.isNotEmpty() && messageGeneration != generation) return
    when (message.optString("type")) {
      "ready" -> if (peer == null) createPeer(message.getJSONObject("relay")) else applyRelay(message.getJSONObject("relay"))
      "relay_credentials" -> applyRelay(message.getJSONObject("relay"))
      "offer" -> if (!sharer) setRemote(message.getString("sdp"), SessionDescription.Type.OFFER, answer = true)
      "answer" -> if (sharer) setRemote(message.getString("sdp"), SessionDescription.Type.ANSWER, answer = false)
      "ice_candidate" -> peer?.addIceCandidate(IceCandidate("0", 0, message.getString("candidate")))
      "pause_state" -> if (!sharer) FamilyAssistRenderer.setPaused(message.optBoolean("paused"))
      "terminate" -> end(message.optString("reason", "helper_left").ifEmpty { "helper_left" })
    }
  }

  private fun createPeer(relay: JSONObject) {
    val created = factory.createPeerConnection(configuration(relay), this) ?: return end("transport_failed")
    peer = created
    reportPath("connecting")
    scheduleRelayRefresh(relay)
    val track = localTrack
    if (sharer && track != null) {
      created.addTrack(track, listOf("apollo-family-assist"))
      createOffer()
    }
  }

  private fun configuration(relay: JSONObject): PeerConnection.RTCConfiguration {
    require(relay.getString("provider") == "cloudflare") { "unexpected_relay_provider" }
    val rows = relay.getJSONArray("iceServers")
    val servers = (0 until rows.length()).map { index ->
      val row = rows.getJSONObject(index)
      val builder = PeerConnection.IceServer.builder(row.getJSONArray("urls").strings())
      if (row.has("username")) builder.setUsername(row.getString("username")).setPassword(row.getString("credential"))
      builder.createIceServer()
    }
    return PeerConnection.RTCConfiguration(servers).apply {
      sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
      continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
    }
  }

  private fun applyRelay(relay: JSONObject) {
    val current = peer ?: return
    if (!current.setConfiguration(configuration(relay))) return end("relay_refresh_rejected")
    scheduleRelayRefresh(relay)
    if (sharer) {
      current.restartIce()
      createOffer()
    }
  }

  private fun scheduleRelayRefresh(relay: JSONObject) {
    refreshFuture?.cancel(false)
    // The server sends Python isoformat ("…T10:00:00.123456+00:00"). Instant.parse rejects "+00:00" before Android 14
    // (older java.time), which ended every session at "ready"; OffsetDateTime.parse reads both "+00:00" and "Z".
    val expiry = java.time.OffsetDateTime.parse(relay.getString("expiresAt")).toInstant().toEpochMilli()
    val lead = if (sharer) 300_000L else 360_000L
    val delay = maxOf(30_000L, expiry - System.currentTimeMillis() - lead)
    refreshFuture = try {
      executor.schedule({ if (!closed.get()) send(envelope("relay_refresh")) }, delay, TimeUnit.MILLISECONDS)
    } catch (_: RejectedExecutionException) { null }
  }

  private fun createOffer() {
    peer?.createOffer(SdpCallback({ description -> setLocal(description, "offer") }, ::end), MediaConstraints())
  }

  private fun createAnswer() {
    peer?.createAnswer(SdpCallback({ description -> setLocal(description, "answer") }, ::end), MediaConstraints())
  }

  private fun setLocal(description: SessionDescription, type: String) {
    if (closed.get()) return
    peer?.setLocalDescription(VoidSdpCallback({ send(envelope(type).put("sdp", description.description)) }, ::end), description)
  }

  private fun setRemote(sdp: String, type: SessionDescription.Type, answer: Boolean) {
    peer?.setRemoteDescription(VoidSdpCallback({ if (answer) post { createAnswer() } }, ::end), SessionDescription(type, sdp))
  }

  private fun envelope(type: String) = JSONObject().put("type", type).put("generation", generation)

  /**
   * Numbers and sends under one lock, so messages leave in sequence order. Sends come from the WebRTC signaling
   * thread and from this peer's executor; the server drops the connection on any out-of-order sequence.
   */
  private fun send(body: JSONObject) {
    synchronized(sendLock) {
      if (closed.get()) return
      socket?.send(body.put("sequence", sequence.getAndIncrement()).toString())
    }
  }

  // ── Owner commands ──
  /** Sharer: pause or resume the outgoing picture and tell the helper. */
  fun setPaused(paused: Boolean) = post {
    localTrack?.setEnabled(!paused)
    send(envelope("pause_state").put("paused", paused))
  }

  /** Tell the far side the session is over, then close shortly after so the message can leave. */
  fun terminate(reason: String) {
    closing.set(true)
    post {
      send(envelope("terminate").put("reason", if (reason in WIRE_REASONS) reason else "transport_failed"))
      localTrack?.setEnabled(false)
      try { executor.schedule({ closeNow() }, 750, TimeUnit.MILLISECONDS) } catch (_: RejectedExecutionException) { closeNow() }
    }
  }

  /** Close now. Idempotent; every later callback is ignored. */
  fun close() {
    closing.set(true)
    if (!post { closeNow() }) closeNow()
  }

  private fun closeNow() {
    if (!closed.compareAndSet(false, true)) return
    refreshFuture?.cancel(false); refreshFuture = null
    socket?.close(1000, "ended"); socket = null
    // Order: the connection first (it releases its senders), then the track and source it used, then the factory.
    peer?.dispose(); peer = null
    localTrack?.dispose(); localTrack = null
    source?.dispose(); source = null
    factory.dispose()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
    executor.shutdown()
  }

  /** Runs [block] on the peer's executor unless the peer is closed. Returns false if it could not be queued. */
  private fun post(block: () -> Unit): Boolean {
    if (closed.get()) return true
    return try {
      executor.execute { if (!closed.get()) block() }
      true
    } catch (_: RejectedExecutionException) { false }
  }

  private fun end(reason: String) {
    if (closing.get() || closed.get() || !ended.compareAndSet(false, true)) return
    onEnded(reason)
  }

  /** Tells JS how the picture travels: connecting, direct, relayed or reconnecting. */
  private fun reportPath(path: String) {
    if (closing.get() || closed.get()) return
    FamilyAssistRuntime.updatePath(sessionId, generation, path)
  }

  private fun update(captureState: String, eventName: String, helperConnected: Boolean? = null) {
    if (closing.get() || closed.get()) return
    FamilyAssistRuntime.update(sessionId, generation, captureState, eventName, helperConnected = helperConnected)
  }

  // ── PeerConnection.Observer (WebRTC signaling thread) ──
  override fun onIceCandidate(candidate: IceCandidate) { send(envelope("ice_candidate").put("candidate", candidate.sdp)) }
  override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
    when (state) {
      PeerConnection.PeerConnectionState.CONNECTED -> {
        connected = true
        if (sharer) update("active", "helper_connected", helperConnected = true) else update("active", "capture_started")
        selectedPath?.let(::reportPath)
      }
      PeerConnection.PeerConnectionState.DISCONNECTED -> {
        connected = false
        update("starting", "transport_degraded")
        reportPath("reconnecting")
      }
      PeerConnection.PeerConnectionState.FAILED -> end("transport_failed")
      else -> Unit
    }
  }
  override fun onTrack(transceiver: RtpTransceiver) {
    if (closing.get() || closed.get() || sharer) return
    (transceiver.receiver.track() as? VideoTrack)?.addSink(FamilyAssistRenderer)
  }
  override fun onSignalingChange(v: PeerConnection.SignalingState) {}
  override fun onIceConnectionChange(v: PeerConnection.IceConnectionState) {}
  override fun onStandardizedIceConnectionChange(v: PeerConnection.IceConnectionState) {}
  override fun onIceConnectionReceivingChange(v: Boolean) {}
  override fun onIceGatheringChange(v: PeerConnection.IceGatheringState) {}
  override fun onIceCandidatesRemoved(v: Array<out IceCandidate>) {}
  override fun onAddStream(v: MediaStream) {}
  override fun onRemoveStream(v: MediaStream) {}
  override fun onDataChannel(v: DataChannel) { v.close() }
  override fun onRenegotiationNeeded() {}
  override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
  override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) {
    val path = pathOf(event.local, event.remote)
    selectedPath = path
    if (connected) reportPath(path)
  }
  override fun onRemoveTrack(receiver: RtpReceiver) {}

  private class SdpCallback(private val success: (SessionDescription) -> Unit, private val fail: (String) -> Unit) : SdpObserver {
    override fun onCreateSuccess(v: SessionDescription) = success(v)
    override fun onSetSuccess() {}
    override fun onCreateFailure(v: String) = fail("sdp_failed")
    override fun onSetFailure(v: String) = fail("sdp_failed")
  }

  private class VoidSdpCallback(private val success: () -> Unit, private val fail: (String) -> Unit) : SdpObserver {
    override fun onCreateSuccess(v: SessionDescription) {}
    override fun onSetSuccess() = success()
    override fun onCreateFailure(v: String) = fail("sdp_failed")
    override fun onSetFailure(v: String) = fail("sdp_failed")
  }

  companion object {
    /** Termination reasons the signaling server accepts (backend services/family_assist/signaling.py). */
    val WIRE_REASONS = setOf("owner_stopped", "helper_left", "capture_revoked", "relationship_revoked", "timeout", "transport_failed", "os_terminated", "app_terminated")
    /** Endings that are failures, not a person's choice. */
    val FAILURE_REASONS = setOf("capture_failed", "transport_failed", "signaling_failed", "signaling_invalid", "signaling_closed", "sdp_failed", "relay_refresh_rejected")
  }
}

private fun JSONArray.strings() = (0 until length()).map { getString(it) }

/** "relayed" when either end of the selected pair is a relay (TURN) candidate, otherwise "direct". */
internal fun pathOf(local: IceCandidate?, remote: IceCandidate?): String =
  if (listOf(local, remote).any { it?.sdp?.let(::isRelayCandidate) == true }) "relayed" else "direct"

/** An ICE candidate line names its type after "typ": host, srflx, prflx or relay. */
internal fun isRelayCandidate(sdp: String): Boolean = Regex("""\btyp relay\b""").containsMatchIn(sdp)
