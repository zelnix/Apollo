package app.apollo.familyassist

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper

/**
 * The sharer side: the visible foreground service that owns the screen capture for one session.
 * It owns, in order of teardown: the capturer, its texture helper, then the [FamilyAssistRtcPeer] (which owns
 * the factory, track and source). All teardown runs on the main thread, exactly once.
 */
class FamilyAssistProjectionService : Service() {
  companion object {
    const val ACTION_START = "app.apollo.familyassist.START"; const val ACTION_PAUSE = "app.apollo.familyassist.PAUSE"
    const val ACTION_RESUME = "app.apollo.familyassist.RESUME"; const val ACTION_STOP = "app.apollo.familyassist.STOP"
    const val EXTRA_RESULT_CODE = "projectionResultCode"; const val EXTRA_RESULT_DATA = "projectionResultData"
    private const val CHANNEL = "family-help-sharing"; private const val NOTIFICATION = 7411
  }

  private val main = Handler(Looper.getMainLooper())
  private var capturer: ScreenCapturerAndroid? = null
  private var textureHelper: SurfaceTextureHelper? = null
  private var peer: FamilyAssistRtcPeer? = null
  private var helper = "your family member"
  private var paused = false
  private var stopped = false
  private var sessionId: String? = null
  private var generation: String? = null

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
    if (capturer != null || peer != null) return
    sessionId = intent.getStringExtra("sessionId"); generation = intent.getStringExtra("generation")
    helper = intent.getStringExtra("helperDisplayName") ?: helper
    startVisibleNotification()
    @Suppress("DEPRECATION") val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java) else intent.getParcelableExtra(EXTRA_RESULT_DATA)
    if (data == null) return stopOwned("capture_failed")
    val values = listOf("sessionId", "generation", "captureScope", "ephemeralSignalingTicket", "signalingBaseUrl").associateWith { intent.getStringExtra(it) ?: "" }
    try {
      // The peer's onEnded arrives on its executor; teardown always runs here on the main thread.
      val created = FamilyAssistRtcPeer(applicationContext, values, true) { reason -> main.post { stopOwned(reason) } }
      peer = created
      val source = created.createScreenSource()
      val helperThread = SurfaceTextureHelper.create("ApolloFamilyAssistCapture", FamilyAssistWebRtc.egl.eglBaseContext)
      textureHelper = helperThread
      capturer = ScreenCapturerAndroid(data, object : MediaProjection.Callback() {
        override fun onStop() { main.post { stopOwned("capture_revoked") } }
      }).also {
        it.initialize(helperThread, applicationContext, source.capturerObserver)
        it.startCapture(1280, 720, 15)
      }
      created.connect()
      FamilyAssistRuntime.update(sessionId, generation, "starting", "capture_starting", markStarted = true)
    } catch (error: Exception) {
      stopOwned("capture_failed")
    }
  }

  private fun setPaused(value: Boolean) {
    if (stopped || capturer == null || paused == value) return
    paused = value
    peer?.setPaused(value)
    FamilyAssistRuntime.update(sessionId, generation, if (value) "paused" else "active", if (value) "capture_paused" else "capture_started")
    startVisibleNotification()
  }

  private fun stopOwned(reason: String) {
    if (stopped) return
    stopped = true
    // Stop the picture at its source first, so nothing feeds the video source once the peer disposes it.
    try { capturer?.stopCapture() } catch (_: InterruptedException) {} catch (_: RuntimeException) {}
    capturer?.dispose(); capturer = null
    textureHelper?.dispose(); textureHelper = null
    peer?.terminate(reason); peer = null
    getSharedPreferences("apollo-family-assist-fence", MODE_PRIVATE).edit()
      .putString("sessionId", sessionId).putString("generation", generation).putBoolean("stopped", true).apply()
    if (reason in FamilyAssistRtcPeer.FAILURE_REASONS) FamilyAssistRuntime.update(sessionId, generation, "failed", "capture_failed", failure = reason)
    else FamilyAssistRuntime.update(sessionId, generation, "stopped", "capture_stopped", reason = reason)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun owns(intent: Intent) = sessionId != null && intent.getStringExtra("sessionId") == sessionId && intent.getStringExtra("generation") == generation

  private fun action(name: String, label: String): NotificationCompat.Action {
    val intent = Intent(this, javaClass).setAction(name).putExtra("sessionId", sessionId).putExtra("generation", generation)
    val pending = PendingIntent.getService(this, name.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Action.Builder(0, label, pending).build()
  }

  private fun startVisibleNotification() {
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setOngoing(true)
      .setContentTitle("Your screen is being shared with $helper").setContentText(if (paused) "Sharing is paused" else "Tap Stop before opening private information")
      .addAction(action(if (paused) ACTION_RESUME else ACTION_PAUSE, if (paused) "Continue sharing" else "Pause"))
      .addAction(action(ACTION_STOP, "Stop sharing")).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(NOTIFICATION, notification)
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL, "Family Help screen sharing", NotificationManager.IMPORTANCE_LOW))
  }

  override fun onDestroy() {
    if (!stopped && (capturer != null || peer != null)) stopOwned("app_terminated")
    super.onDestroy()
  }
}
