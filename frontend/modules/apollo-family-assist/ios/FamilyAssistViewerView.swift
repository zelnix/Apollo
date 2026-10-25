import ExpoModulesCore
import UIKit
import WebRTC

/// The single sink the helper's incoming video is attached to (same role as Android's FamilyAssistRenderer).
/// The on-screen view attaches and detaches on the main thread as it enters and leaves a window; frames that arrive
/// while no view is attached are dropped instead of being handed to a missing view. "Paused" hides the view, always on
/// the main thread, never from WebRTC or signaling threads.
final class FamilyAssistRenderer: NSObject, RTCVideoRenderer {
  static let shared = FamilyAssistRenderer()
  private let lock = NSLock()
  private var target: RTCMTLVideoView?
  private var paused = false // main thread only

  /// Main thread.
  func attach(_ view: RTCMTLVideoView) {
    lock.lock(); target = view; lock.unlock()
    view.isHidden = paused
  }

  /// Main thread.
  func detach(_ view: RTCMTLVideoView) {
    lock.lock(); if target === view { target = nil }; lock.unlock()
  }

  func setSize(_ size: CGSize) { current()?.setSize(size) }
  func renderFrame(_ frame: RTCVideoFrame?) { current()?.renderFrame(frame) }

  func setPaused(_ value: Bool) {
    DispatchQueue.main.async {
      self.paused = value
      self.current()?.isHidden = value
    }
  }

  /// A new viewer session starts unpaused.
  func reset() { setPaused(false) }

  private func current() -> RTCMTLVideoView? {
    lock.lock(); defer { lock.unlock() }
    return target
  }
}

public final class FamilyAssistViewerView: ExpoView {
  private let video = RTCMTLVideoView(frame: .zero)

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    video.videoContentMode = .scaleAspectFit
    addSubview(video)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    video.frame = bounds
  }

  // React may take a view out of its window and put it back; frames reach the view only while it is in a window.
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { FamilyAssistRenderer.shared.detach(video) } else { FamilyAssistRenderer.shared.attach(video) }
  }
}
