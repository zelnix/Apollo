import Foundation
import GuardDogCore

/// iOS feasibility probe. M1 position is fixed and honest: analysis + warning only.
/// No NEPacketTunnelProvider / content filter is claimed or used in this milestone.
public struct NetworkFeasibilityCapabilityProvider: CapabilityProvider {
    public init() {}
    public func currentCapabilities() -> ProtectionCapabilities { .iosM1 }
}
