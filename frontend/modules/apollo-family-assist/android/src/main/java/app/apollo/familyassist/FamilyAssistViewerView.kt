package app.apollo.familyassist

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink

/**
 * The single sink the helper's incoming video is attached to. The on-screen renderer attaches and detaches on
 * the main thread as the view comes and goes; frames that arrive while no renderer is attached are dropped
 * instead of being handed to a missing or released view. All view changes (visibility for "paused") are
 * posted to the main thread, never made from WebRTC or signaling threads.
 */
internal object FamilyAssistRenderer : VideoSink {
  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()
  private var target: SurfaceViewRenderer? = null
  private var paused = false // main thread only

  fun attach(view: SurfaceViewRenderer) {
    synchronized(lock) { target = view }
    view.visibility = if (paused) View.INVISIBLE else View.VISIBLE
  }

  fun detach(view: SurfaceViewRenderer) {
    synchronized(lock) { if (target === view) target = null }
  }

  override fun onFrame(frame: VideoFrame) {
    synchronized(lock) { target?.onFrame(frame) }
  }

  fun setPaused(value: Boolean) {
    main.post {
      paused = value
      synchronized(lock) { target }?.visibility = if (value) View.INVISIBLE else View.VISIBLE
    }
  }

  /** A new viewer session starts unpaused. */
  fun reset() = setPaused(false)
}

class FamilyAssistViewerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val renderer = SurfaceViewRenderer(context)
  private var initialized = false

  init {
    addView(renderer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  // React Native may detach and re-attach a view; the renderer is initialised on every attach and released on
  // every detach, so a re-attached view never draws with a released renderer.
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!initialized) {
      renderer.init(FamilyAssistWebRtc.egl.eglBaseContext, null)
      renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
      renderer.setEnableHardwareScaler(true)
      renderer.setMirror(false)
      initialized = true
    }
    FamilyAssistRenderer.attach(renderer)
  }

  override fun onDetachedFromWindow() {
    FamilyAssistRenderer.detach(renderer)
    if (initialized) {
      renderer.release()
      initialized = false
    }
    super.onDetachedFromWindow()
  }
}
