package app.apollo.familyassist

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

internal object FamilyAssistRenderer {
  val egl: EglBase = EglBase.create()
  var view: SurfaceViewRenderer? = null
}

class FamilyAssistViewerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val renderer = SurfaceViewRenderer(context).apply {
    init(FamilyAssistRenderer.egl.eglBaseContext, null)
    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
    setEnableHardwareScaler(true)
    setMirror(false)
  }
  init { addView(renderer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)); FamilyAssistRenderer.view = renderer }
  override fun onDetachedFromWindow() {
    FamilyAssistRenderer.view = null; renderer.release(); super.onDetachedFromWindow()
  }
}