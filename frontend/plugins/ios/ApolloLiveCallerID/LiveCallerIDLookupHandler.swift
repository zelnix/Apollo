import Foundation
#if canImport(IdentityLookup)
import IdentityLookup
#endif

/// Call Guard — Apple "Live Caller ID Lookup" SCAFFOLD (iOS 18+, `IdentityLookup` framework).
///
/// IMPORTANT — this class is NOT wired into an active build target today, and there is no server
/// behind it. Apple's Live Caller ID Lookup is fundamentally different from the CXCallDirectoryExtension
/// this app DOES ship (ApolloCallDirectory): instead of a static synced number list, iOS calls a
/// `LiveCallerIDLookupProtocol` extension in real time for an incoming call and relays the request to
/// `serviceURL` through a PRIVATE INFORMATION RETRIEVAL (PIR) protocol — Apple's own relay strips
/// identifying metadata so neither Apple nor the network can tell WHICH number is being looked up, and
/// Apollo's server itself must implement Apple's PIR response format (a specific encrypted-shard
/// protocol, not a normal REST endpoint — Apple ships a reference `pir-service-example` server).
///
/// None of that PIR server exists in this build; only the app-facing lookup shape is sketched below so
/// a future session has real, correctly-named APIs to start from — not a guess. Building this for real
/// needs, at minimum: (1) a dedicated Xcode extension target implementing `LiveCallerIDLookupProtocol`,
/// (2) the CallKit "Live Caller ID Lookup" entitlement (Apple-granted, separate from the
/// `com.apple.developer.callkit` capability used by ApolloCallDirectory), and (3) a standalone backend
/// PIR service — a multi-week build on its own, well beyond "wire up an extension".
///
/// Today, `ApolloSecurityModule.getCallProtectionCapabilities()` reports iOS Call Guard coverage
/// entirely through ApolloCallDirectory's static list + the backend's on-demand
/// POST /api/call/risk-check — both real and shipped.
#if canImport(IdentityLookup)
@available(iOS 18.0, *)
final class LiveCallerIDLookupHandler: NSObject, LiveCallerIDLookupProtocol {
  // Left intentionally unimplemented — see header. Do not enable without first building the PIR
  // server component and a real extension target, then re-verifying this file compiles inside it.
}
#endif
