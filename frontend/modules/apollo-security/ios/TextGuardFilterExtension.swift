import Foundation
#if canImport(IdentityLookup)
import IdentityLookup
#endif

/// Text Guard — iOS Message Filter Extension SCAFFOLD.
///
/// IMPORTANT — this class is NOT wired into an active build target today. A working
/// `ILMessageFilterExtension` requires its own Xcode App Extension target (a separate executable,
/// distinct from the ApolloSecurity Expo Module in this folder) plus the
/// `com.apple.developer.message-filter` entitlement, which Apple grants per-app on request. Neither
/// exists in this project yet — creating that target is native Xcode project surgery beyond what an
/// Expo config plugin can do unattended, and is flagged to the user as follow-up work for a future
/// native build, not claimed as working here.
///
/// What it WOULD do once wired up: iOS calls this for SMS/MMS from senders NOT already in Contacts
/// (Apple never shares iMessage or known-sender content with any filter extension, by design). Apollo
/// could classify locally with the SAME on-device engine already used for pasted messages
/// (`messageAnalysis.ts` logic ported to Swift, or a lightweight local heuristic) and return one of
/// Apple's own categories — it can never fully delete or silently block a message, only file it under
/// Junk. Today, `ApolloSecurityModule.getMessagingCapabilities()` honestly reports `smsFiltering:
/// "unsupported"` on iOS; the working path on iOS is pasting a message into Text Guard, or sharing it
/// to Apollo from the Messages app.
#if canImport(IdentityLookup)
@available(iOS 14.0, *)
final class TextGuardFilterExtension: ILMessageFilterExtension {
  // Left intentionally unimplemented — see header. Do not enable without first adding a real
  // Message Filter Extension target + entitlement and re-verifying this file compiles inside it.
}
#endif
