package app.apollo.familyassist

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class FamilyAssistRtcPeer(
  private val values: Map<String, String>, private val sharer: Boolean, private val localTrack: VideoTrack?,
) : WebSocketListener(), PeerConnection.Observer {
  private val executor = Executors.newSingleThreadExecutor()
  private val client = OkHttpClient.Builder().pingInterval(java.time.Duration.ofSeconds(20)).build()
  private var socket: WebSocket? = null
  private var factory: PeerConnectionFactory? = null
  private var peer: PeerConnection? = null
  private var sequence = 0

  fun connect() {
    val base = values.getValue("signalingBaseUrl").replace("https://", "wss://").replace("http://", "ws://").trimEnd('/')
    val ticket = URLEncoder.encode(values.getValue("ephemeralSignalingTicket"), StandardCharsets.UTF_8.toString())
    val url = "$base/family/assist/sessions/${values.getValue("sessionId")}/signal?ticket=$ticket"
    socket = client.newWebSocket(Request.Builder().url(url).build(), this)
  }

  override fun onMessage(webSocket: WebSocket, text: String) { executor.execute { handle(JSONObject(text)) } }
  private fun handle(message: JSONObject) {
    when (message.optString("type")) {
      "ready" -> createPeer(message.getJSONObject("relay"))
      "offer" -> if (!sharer) setRemote(message.getString("sdp"), SessionDescription.Type.OFFER, answer = true)
      "answer" -> if (sharer) setRemote(message.getString("sdp"), SessionDescription.Type.ANSWER, answer = false)
      "ice_candidate" -> peer?.addIceCandidate(IceCandidate("0", 0, message.getString("candidate")))
      "pause_state" -> FamilyAssistRenderer.view?.visibility = if (message.optBoolean("paused")) android.view.View.INVISIBLE else android.view.View.VISIBLE
      "terminate" -> close()
    }
  }
  private fun createPeer(relay: JSONObject) {
    val context = FamilyAssistApp.context ?: return
    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).setEnableInternalTracer(false).createInitializationOptions())
    factory = PeerConnectionFactory.builder()
      .setVideoEncoderFactory(DefaultVideoEncoderFactory(FamilyAssistRenderer.egl.eglBaseContext, true, true))
      .setVideoDecoderFactory(DefaultVideoDecoderFactory(FamilyAssistRenderer.egl.eglBaseContext)).createPeerConnectionFactory()
    val urls = relay.getJSONArray("uris").strings()
    val ice = PeerConnection.IceServer.builder(urls).setUsername(relay.getString("username")).setPassword(relay.getString("credential")).createIceServer()
    val config = PeerConnection.RTCConfiguration(listOf(ice)).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN; continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY }
    peer = factory?.createPeerConnection(config, this)
    if (sharer && localTrack != null) { peer?.addTrack(localTrack, listOf("apollo-family-assist")); createOffer() }
  }
  private fun createOffer() { peer?.createOffer(SdpCallback { description -> peer?.setLocalDescription(VoidSdpCallback { sendSdp("offer", description.description) }, description) }, MediaConstraints()) }
  private fun createAnswer() { peer?.createAnswer(SdpCallback { description -> peer?.setLocalDescription(VoidSdpCallback { sendSdp("answer", description.description) }, description) }, MediaConstraints()) }
  private fun setRemote(sdp: String, type: SessionDescription.Type, answer: Boolean) { peer?.setRemoteDescription(VoidSdpCallback { if (answer) createAnswer() }, SessionDescription(type, sdp)) }
  private fun sendSdp(type: String, sdp: String) = send(JSONObject().put("type", type).put("sequence", sequence++).put("generation", values.getValue("generation")).put("sdp", sdp))
  fun sendPause(paused: Boolean) = send(JSONObject().put("type", "pause_state").put("sequence", sequence++).put("generation", values.getValue("generation")).put("paused", paused))
  private fun send(body: JSONObject) { socket?.send(body.toString()) }
  fun close() { executor.execute { localTrack?.setEnabled(false); peer?.close(); peer = null; factory?.dispose(); factory = null; socket?.close(1000, "ended"); socket = null; client.dispatcher.executorService.shutdown() } }
  override fun onIceCandidate(candidate: IceCandidate) { send(JSONObject().put("type", "ice_candidate").put("sequence", sequence++).put("generation", values.getValue("generation")).put("candidate", candidate.sdp)) }
  override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
    if (state == PeerConnection.PeerConnectionState.CONNECTED) FamilyAssistRuntime.update("active", if (sharer) "helper_connected" else "capture_started")
    if (state == PeerConnection.PeerConnectionState.FAILED) FamilyAssistRuntime.update("failed", "capture_failed", "transport_failed")
  }
  override fun onTrack(transceiver: RtpTransceiver) { (transceiver.receiver.track() as? VideoTrack)?.addSink(FamilyAssistRenderer.view) }
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
  override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) { (receiver.track() as? VideoTrack)?.addSink(FamilyAssistRenderer.view) }
  override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) {}
  override fun onRemoveTrack(receiver: RtpReceiver) {}

  private class SdpCallback(private val success: (SessionDescription) -> Unit) : SdpObserver {
    override fun onCreateSuccess(v: SessionDescription) = success(v); override fun onSetSuccess() {}
    override fun onCreateFailure(v: String) { FamilyAssistRuntime.update("failed", "capture_failed", "sdp_failed") }; override fun onSetFailure(v: String) { FamilyAssistRuntime.update("failed", "capture_failed", "sdp_failed") }
  }
  private class VoidSdpCallback(private val success: (() -> Unit)? = null) : SdpObserver {
    override fun onCreateSuccess(v: SessionDescription) {}; override fun onSetSuccess() { success?.invoke() }
    override fun onCreateFailure(v: String) {}; override fun onSetFailure(v: String) {}
  }
}

private fun JSONArray.strings() = (0 until length()).map { getString(it) }

internal object FamilyAssistApp { var context: Context? = null }