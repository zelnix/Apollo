// swift-tools-version:5.9
import PackageDescription

// GuardDogCore has NO dependency on GuardDogNetworkFeasibility. The feasibility package
// depends on core and provides a CapabilityProvider implementation (injected at runtime).
let package = Package(
    name: "GuardDogCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "GuardDogCore", targets: ["GuardDogCore"])],
    targets: [
        .target(name: "GuardDogCore", path: "Sources/GuardDogCore"),
        .testTarget(
            name: "GuardDogCoreTests",
            dependencies: ["GuardDogCore"],
            path: "Tests/GuardDogCoreTests"
        ),
    ]
)
