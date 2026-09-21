# Apollo desktop host (Windows / macOS)

**Toolchain decision (spec §7 / §1A):** Tauri v2 shell hosting the shared Expo web export (`frontend` → `dist/`), with
native operations implemented as typed, allowlisted Rust commands (`src-tauri/src/lib.rs`) and consumed by
`frontend/src/security/DesktopSecurityAdapter.ts` (selected automatically by `hostAdapter.web.ts` when the Tauri bridge is present).
Rationale: reuses 100% of the shared React/domain/investigation code, produces signed installers (MSI/NSIS, DMG/.app),
keeps privileges behind a fixed command surface (no shell, no arbitrary fs, page content can never become IPC), and leaves
room for a separate privileged filtering service (Windows Filtering Platform driver/service; macOS Network Extension) that
is **not implemented yet** and is reported as `not_implemented` by the host — never as an OS limitation.

## Build
```
cd desktop && yarn install
yarn build:windows   # on Windows: MSI + NSIS installers in src-tauri/target/release/bundle
yarn build:macos     # on macOS:  .app + .dmg (signing identity/notarization via env APPLE_* when available)
```
Prerequisites: Rust stable, Tauri v2 CLI, WebView2 (Windows, auto-bootstrapped), Xcode CLT (macOS). The sandbox that
produced this scaffold has no Windows/macOS runner, so no desktop artifact has been produced yet (see
`docs/APOLLO_PLATFORM_DELIVERY_MATRIX.md`).

## Implemented commands
`host_info` (OS type/version, locale; manufacturer/model/form factor still `null`/`unknown` — real WMI/IOKit reads pending),
`network_status` (real interface enumeration; VPN positive-match only; SSID/security not yet), `permissions`
(request history + explicit `not_implemented`/`os_restricted` reasons), `request_permission`, `open_settings_target`
(fixed `ms-settings:` / `x-apple.systempreferences:` destinations only).
