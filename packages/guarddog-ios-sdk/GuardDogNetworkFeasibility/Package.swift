// swift-tools-version:5.9
import PackageDescription

// Depends on GuardDogCore (one-way). Provides the CapabilityProvider implementation that
// core consumes through injection. Core never imports this package.
let package = Package(
    name: "GuardDogNetworkFeasibility",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "GuardDogNetworkFeasibility", targets: ["GuardDogNetworkFeasibility"])],
    dependencies: [.package(path: "../GuardDogCore")],
    targets: [
        .target(name: "GuardDogNetworkFeasibility", dependencies: ["GuardDogCore"], path: "Sources/GuardDogNetworkFeasibility"),
    ]
)
