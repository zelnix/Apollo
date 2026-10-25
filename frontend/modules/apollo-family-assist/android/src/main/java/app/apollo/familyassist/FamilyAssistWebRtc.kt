package app.apollo.familyassist

import android.content.Context
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory

/**
 * The one WebRTC initialisation path for Family Help. PeerConnectionFactory.initialize runs once per process,
 * before the first factory is built; every factory is built here and is owned — and disposed — by exactly
 * one [FamilyAssistRtcPeer]. Nothing else in this module may call initialize or createPeerConnectionFactory.
 */
internal object FamilyAssistWebRtc {
  private var initialized = false

  /** Shared EGL context for the screen capturer, the encoder/decoder and the on-screen renderer. */
  val egl: EglBase by lazy { EglBase.create() }

  @Synchronized
  fun createFactory(context: Context): PeerConnectionFactory {
    if (!initialized) {
      PeerConnectionFactory.initialize(
        PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
          .setEnableInternalTracer(false)
          .createInitializationOptions(),
      )
      initialized = true
    }
    return PeerConnectionFactory.builder()
      .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
      .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
      .createPeerConnectionFactory()
  }
}
