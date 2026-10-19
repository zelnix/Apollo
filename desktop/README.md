# Apollo desktop host (Windows / macOS)

**Toolchain decision (spec §7 / §1A):** Tauri v2 shell hosting the shared Expo web export (`frontend` → `dist/`), with
native operations implemented as typed, allowlisted Rust commands (`src-tauri/src/lib.rs`) and consumed by
`frontend/src/security/DesktopSecurityAdapter.ts` (selected automatically by `hostAdapter.web.ts` when the Tauri bridge is present).
Rationale: reuses 100% of the shared React/domain/investigation code, produces signed installers (MSI/NSIS, DMG/.app),
keeps privileges behind a fixed command surface (no shell, no arbitrary fs, page content can never become IPC). Package 6
adds source for an Apollo-owned Windows Filtering Platform service and a macOS Network Extension system extension. The host
observes their actual installed/active state; source presence is never represented as live protection.

## Build
```
cd desktop && yarn install
yarn build:windows   # Windows only: builds WFP service and NSIS package
yarn build:macos     # macOS only: prepares Network/System Extension source, then builds the unsigned .app source candidate
```
Prerequisites: Rust stable, Tauri v2 CLI, WebView2 and CMake/MSVC (Windows); Xcode, XcodeGen and the granted Network
Extension/System Extension entitlements (macOS). This Linux sandbox has no Windows/macOS runner, so no desktop artifact has been produced (see
`docs/APOLLO_PLATFORM_DELIVERY_MATRIX.md`).

## Implemented commands
`host_info` (OS type/version, locale and WMI/sysctl identity), `network_status` (real interface enumeration; VPN positive-match only),
`native_filter_status` (real service/system-extension discovery), `permissions` (request history plus explicit reasons),
`request_permission`, hosts-filter fallback commands, and `open_settings_target`
(fixed `ms-settings:` / `x-apple.systempreferences:` destinations only).

## Packaging boundary

- Windows NSIS hooks install/start and remove `ApolloProtectionService`. MSI service custom actions remain a build-owner packaging task; the source command intentionally emits NSIS only.
- macOS preparation builds the system extension and activation helper into `src-tauri/macos-embedded`. The build owner must embed them at the manifest destination, sign the nested extension/helper first, then sign/notarize the containing app. Apollo reports `configuration_missing` until the signed extension is actually embedded and installed.
- Neither source path authorises a “Threat stopped” outcome by itself. Only observed enforcement evidence may do that.
