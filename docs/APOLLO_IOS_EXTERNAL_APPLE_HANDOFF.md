# Apollo iOS External Apple Build Handoff

## Build entry

- Project root: `frontend/`
- Configuration source: `frontend/app.config.js` + `frontend/app.json`
- Canonical iOS identifier: `app.apollo.hwg`
- Minimum iOS/iPadOS: 16.4
- Device families: iPhone and iPad
- Generate source: `npx expo prebuild --platform ios --clean`
- Open/build generated workspace after CocoaPods resolution using the owner-selected iOS profile from `frontend/eas.json`.

## Expected products

| Target / scheme | Bundle identifier | Capability / entitlement |
|---|---|---|
| Apollo | `app.apollo.hwg` | App Group, Wi-Fi info, notifications as authorised |
| ApolloFamilyAssistBroadcast | `app.apollo.hwg.familyassistbroadcast` | App Group; ReplayKit Broadcast Upload; JitsiWebRTC |
| ApolloShareExtension | `app.apollo.hwg.shareextension` | App Group; Share Services |
| ApolloContentBlocker | `app.apollo.hwg.contentblocker` | App Group; Safari Content Blocker |
| ApolloCallDirectory | `app.apollo.hwg.calldirectory` | App Group; Call Directory |
| ApolloMessageFilter | `app.apollo.hwg.messagefilter` | App Group; IdentityLookup Message Filter |

Containing application for all five extensions: Apollo. Shared App Group: `group.app.apollo.hwg.apollo`.

## Secure external inputs required by name

- Apple Developer Team identifier
- Distribution/development certificate selected by the build owner
- Host and extension provisioning profiles
- Apple capability authorisation for App Groups, Call Directory, Message Filter, Safari Content Blocker, notifications and Wi-Fi information as applicable
- Owner-selected App Store Connect/TestFlight credentials if distribution is requested

Do not commit secret values or signing material.

## Required macOS/Xcode checks

All are currently **`not_run_external_toolchain`**:

1. Install locked JavaScript dependencies with the repository's Yarn workflow.
2. Run clean iOS prebuild and CocoaPods resolution.
3. Confirm Apollo and all four extension schemes exist once.
4. Confirm each extension is a dependency of and embedded in Apollo.
5. Confirm bundle identifiers, App Group and deployment target 16.4 in Xcode.
6. Compile every scheme for a supported iPhone and iPad destination.
7. Confirm Swift/Objective-C compilation and Expo module autolinking.
8. Confirm provisioning profiles authorise each requested entitlement.
9. Validate archive and extension embedding.
10. If in owner scope, export/install and observe Share, Safari, Call Directory and Message Filter enablement paths on real devices.

## Source-generation evidence already completed

- Clean prebuild and second prebuild each generated exactly one host plus four extensions.
- Host project contains four target dependencies and four extension embed phases.
- Generated plists, privacy manifest and entitlements parse structurally.
- Host and all extensions use the same single App Group.
- All deployment targets resolve to 16.4.
- `apollo-security` resolves in Apple autolinking; frozen `guarddog-expo-module` is excluded.
- Frozen GuardDog hash manifest passes 91/91.
- Native singleton dependency guard passes.

## Known platform limits

- Safari blocking is Safari-scoped; Safari does not provide per-request match evidence to Apollo.
- Call Directory is list-based and does not provide invented live-call observations.
- Message Filter requires supported OS behavior and explicit user enablement.
- Share intake includes only items the user explicitly submits and retains protected handoffs for at most 24 hours.
- Network, app, file and device visibility is limited to Apple-supported APIs and explicit user selection.

## Artifact record

`artifactId: null`

No signed archive, IPA, TestFlight or physical-device result is claimed by Emergent.