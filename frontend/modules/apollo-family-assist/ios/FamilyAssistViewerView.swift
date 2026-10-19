import ExpoModulesCore
import WebRTC

final class FamilyAssistViewerRegistry {
  static let shared = FamilyAssistViewerRegistry()
  weak var renderer: RTCVideoRenderer? { didSet { FamilyAssistCoordinator.shared.viewer?.attach(renderer) } }
}

public final class FamilyAssistViewerView: ExpoView {
  private let video = RTCMTLVideoView(frame: .zero)
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext); video.videoContentMode = .scaleAspectFit; addSubview(video); FamilyAssistViewerRegistry.shared.renderer = video
  }
  public override func layoutSubviews() { super.layoutSubviews(); video.frame = bounds }
  deinit { if FamilyAssistViewerRegistry.shared.renderer === video { FamilyAssistViewerRegistry.shared.renderer = nil } }
}