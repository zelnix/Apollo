package app.apollo.familyassist

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

class FamilyAssistProjectionService : Service() {
  companion object {
    const val ACTION_START = "app.apollo.familyassist.START"; const val ACTION_PAUSE = "app.apollo.familyassist.PAUSE"
    const val ACTION_RESUME = "app.apollo.familyassist.RESUME"; const val ACTION_STOP = "app.apollo.familyassist.STOP"
    const val EXTRA_RESULT_CODE = "projectionResultCode"; const val EXTRA_RESULT_DATA = "projectionResultData"
    private const val CHANNEL = "family-help-sharing"; private const val NOTIFICATION = 7411
  }
  private var capturer: ScreenCapturerAndroid? = null; private var source: VideoSource? = null; private var track: VideoTrack? = null
  private var peer: FamilyAssistRtcPeer? = null; private var helper = "your family member"; private var paused = false
  private var sessionId: String? = null; private var generation: String? = null

  override fun onCreate() { super.onCreate(); createChannel() }
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_PAUSE -> if (owns(intent)) setPaused(true)
      ACTION_RESUME -> if (owns(intent)) setPaused(false)
      ACTION_STOP -> if (owns(intent)) stopOwned("owner_stopped")
    }
    return START_NOT_STICKY
  }
  private fun start(intent: Intent) {
    if (capturer != null) return
    sessionId = intent.getStringExtra("sessionId"); generation = intent.getStringExtra("generation"); helper = intent.getStringExtra("helperDisplayName") ?: helper
    startVisibleNotification()
    @Suppress("DEPRECATION") val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java) else intent.getParcelableExtra(EXTRA_RESULT_DATA)
    if (data == null) return stopOwned("capture_failed")
    val values = listOf("sessionId", "generation", "captureScope", "ephemeralSignalingTicket", "signalingBaseUrl").associateWith { intent.getStringExtra(it) ?: "" }
    val factory = org.webrtc.PeerConnectionFactory.builder().createPeerConnectionFactory()
    source = factory.createVideoSource(true); track = factory.createVideoTrack("apollo-screen", source)
    capturer = ScreenCapturerAndroid(data, object : MediaProjection.Callback() { override fun onStop() { stopOwned("capture_revoked") } }).also {
      val helper = SurfaceTextureHelper.create("ApolloFamilyAssistCapture", FamilyAssistRenderer.egl.eglBaseContext)
      it.initialize(helper, applicationContext, source!!.capturerObserver); it.startCapture(1280, 720, 15)
    }
    peer = FamilyAssistRtcPeer(applicationContext, values, true, track) { reason -> stopOwned(reason) }.also { it.connect() }
    FamilyAssistRuntime.state["startedAt"] = FamilyAssistRuntime.isoNow(); FamilyAssistRuntime.update("starting", "capture_starting")
  }
  private fun setPaused(value: Boolean) {
    if (capturer == null || paused == value) return
    paused = value; track?.setEnabled(!value); peer?.sendPause(value)
    FamilyAssistRuntime.update(if (value) "paused" else "active", if (value) "capture_paused" else "capture_started")
    startVisibleNotification()
  }
  @Synchronized private fun stopOwned(reason: String) {
    track?.setEnabled(false); try { capturer?.stopCapture() } catch (_: InterruptedException) {}; capturer?.dispose(); capturer = null
    peer?.terminate(reason); peer = null; source?.dispose(); source = null; track?.dispose(); track = null
    getSharedPreferences("apollo-family-assist-fence", MODE_PRIVATE).edit().putString("sessionId", sessionId).putString("generation", generation).putBoolean("stopped", true).apply()
    if (reason == "capture_failed" || reason == "transport_failed") FamilyAssistRuntime.update("failed", "capture_failed", reason)
    else FamilyAssistRuntime.update("stopped", "capture_stopped", reason = reason)
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
  }
  private fun owns(intent: Intent) = intent.getStringExtra("sessionId") == sessionId && intent.getStringExtra("generation") == generation
  private fun action(name: String, label: String): NotificationCompat.Action {
    val intent = Intent(this, javaClass).setAction(name).putExtra("sessionId", sessionId).putExtra("generation", generation)
    val pending = PendingIntent.getService(this, name.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Action.Builder(0, label, pending).build()
  }
  private fun startVisibleNotification() {
    val notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setOngoing(true)
      .setContentTitle("Your screen is being shared with $helper").setContentText(if (paused) "Sharing is paused" else "Tap Stop before opening private information")
      .addAction(action(if (paused) ACTION_RESUME else ACTION_PAUSE, if (paused) "Continue sharing" else "Pause"))
      .addAction(action(ACTION_STOP, "Stop sharing")).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(NOTIFICATION, notification)
  }
  private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) (getSystemService(NotificationManager::class.java)).createNotificationChannel(NotificationChannel(CHANNEL, "Family Help screen sharing", NotificationManager.IMPORTANCE_LOW)) }
  override fun onDestroy() { if (capturer != null) stopOwned("app_terminated"); super.onDestroy() }
}