//! Apollo desktop host — typed, allowlisted commands for the shared web bundle (frontend/src/security/DesktopSecurityAdapter.ts).
//!
//! Every command returns REAL operating-system facts or an explicit `not_implemented` reason. Nothing here simulates
//! protection, and web content can never reach a shell or arbitrary IPC: only the commands registered in `generate_handler!`
//! exist, each with a fixed argument shape. Filtering (Windows Filtering Platform / macOS Network Extension) is a separate
//! privileged service that is NOT implemented yet; the host reports that honestly instead of claiming Site Gate coverage.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
    platform: &'static str,
    os_version: String,
    manufacturer: Option<String>,
    model: Option<String>,
    form_factor: &'static str,
    locale: String,
    host_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostNetwork {
    connected: bool,
    #[serde(rename = "type")]
    kind: &'static str,
    vpn_active: Option<bool>,
    ssid: Option<String>,
    wifi_security: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostPermission {
    id: &'static str,
    state: &'static str,
    enabled: Option<bool>,
    requested: Option<bool>,
    last_requested_at: Option<String>,
    unavailable_reason: Option<&'static str>,
}

#[derive(Deserialize)]
struct RequestPermissionArgs {
    id: String,
}

/// Apollo's own request history (separate from the OS state), kept for the process lifetime and persisted by the web layer.
#[derive(Default)]
struct RequestHistory(Mutex<HashMap<String, String>>);

fn now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // RFC3339 without a chrono dependency (UTC seconds precision is sufficient for request history).
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, (secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[tauri::command]
fn host_info() -> HostInfo {
    let info = os_info::get();
    let platform = if cfg!(target_os = "windows") { "windows" } else { "macos" };
    // Form factor: desktop hosts report "desktop"/"laptop" only when the OS exposes a chassis type; otherwise "unknown".
    // Reading chassis/battery presence is platform-specific and not implemented yet → "unknown" is the honest value.
    HostInfo {
        platform,
        os_version: format!("{} {}", info.os_type(), info.version()),
        manufacturer: None, // TODO(real): WMI Win32_ComputerSystem.Manufacturer / IOKit IOPlatformExpertDevice manufacturer
        model: None,        // TODO(real): WMI Win32_ComputerSystem.Model / sysctl hw.model
        form_factor: "unknown",
        locale: sys_locale::get_locale().unwrap_or_else(|| "en-AU".to_string()),
        host_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn network_status() -> HostNetwork {
    // Real interface enumeration: connected when any non-loopback interface has an address. VPN detection uses the
    // interface name heuristics the OS exposes (utun*/tun*/tap*/wg*/ppp*) — reported as Some(true) only on a positive match.
    let ifaces = if_addrs::get_if_addrs().unwrap_or_default();
    let up: Vec<_> = ifaces.iter().filter(|i| !i.is_loopback()).collect();
    let vpn = up.iter().any(|i| {
        let n = i.name.to_lowercase();
        n.starts_with("utun") || n.starts_with("tun") || n.starts_with("tap") || n.starts_with("wg") || n.starts_with("ppp") || n.contains("vpn")
    });
    let wifi = up.iter().any(|i| { let n = i.name.to_lowercase(); n.starts_with("wlan") || n.starts_with("wi-fi") || n == "en0" });
    HostNetwork {
        connected: !up.is_empty(),
        kind: if vpn { "vpn" } else if wifi { "wifi" } else if up.is_empty() { "none" } else { "ethernet" },
        vpn_active: if vpn { Some(true) } else { None }, // absence of a tunnel interface is not proof of "no VPN"
        ssid: None,            // requires location/Wi-Fi APIs (CoreWLAN / WlanQueryInterface) — not implemented yet
        wifi_security: "unknown",
    }
}

#[tauri::command]
fn permissions(history: State<RequestHistory>) -> Vec<HostPermission> {
    let h = history.0.lock().unwrap();
    let hist = |id: &str| (Some(h.contains_key(id)), h.get(id).cloned());
    let (nr, nt) = hist("notifications");
    let (fr, ft) = hist("network_filter");
    vec![
        // Notification permission state is exposed by tauri-plugin-notification on the web side; here we record request history only.
        HostPermission { id: "notifications", state: "undetermined", enabled: None, requested: nr, last_requested_at: nt, unavailable_reason: None },
        HostPermission { id: "network_filter", state: "unavailable", enabled: None, requested: fr, last_requested_at: ft, unavailable_reason: Some("not_implemented") },
        HostPermission { id: "vpn_config", state: "not_applicable", enabled: None, requested: None, last_requested_at: None, unavailable_reason: Some("not_implemented") },
        HostPermission { id: "accessibility", state: "not_applicable", enabled: None, requested: None, last_requested_at: None, unavailable_reason: Some("os_restricted") },
    ]
}

#[tauri::command]
fn request_permission(args: RequestPermissionArgs, history: State<RequestHistory>) -> Result<(), String> {
    let allowed = ["notifications", "network_filter", "vpn_config", "accessibility"];
    if !allowed.contains(&args.id.as_str()) {
        return Err("unknown permission id".into());
    }
    history.0.lock().unwrap().insert(args.id, now_iso());
    Ok(())
}

/// Opens a fixed OS Settings destination. Only the listed targets exist; the page cannot supply arbitrary URIs.
#[tauri::command]
fn open_settings_target(target: String) -> Result<(), String> {
    let uri = match (cfg!(target_os = "windows"), target.as_str()) {
        (true, "notifications") => "ms-settings:notifications",
        (true, "network") => "ms-settings:network-status",
        (true, "vpn") => "ms-settings:network-vpn",
        (true, "apps") => "ms-settings:appsfeatures",
        (true, "security") => "windowsdefender:",
        (true, "privacy") => "ms-settings:privacy",
        (false, "notifications") => "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
        (false, "network") => "x-apple.systempreferences:com.apple.Network-Settings.extension",
        (false, "vpn") => "x-apple.systempreferences:com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension",
        (false, "security") => "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
        (false, "privacy") => "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
        (false, "apps") => "x-apple.systempreferences:com.apple.preferences.appstore",
        _ => return Err("unsupported settings target".into()),
    };
    tauri_plugin_opener::open_url(uri, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RequestHistory::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![host_info, network_status, permissions, request_permission, open_settings_target])
        .run(tauri::generate_context!())
        .expect("error while running Apollo desktop host");
}
