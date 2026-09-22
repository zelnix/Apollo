//! Apollo desktop host — typed, allowlisted commands for the shared web bundle (frontend/src/security/DesktopSecurityAdapter.ts).
//!
//! Every command returns REAL operating-system facts or an explicit `not_implemented` reason. Nothing here simulates
//! protection, and web content can never reach a shell or arbitrary IPC: only the commands registered in `generate_handler!`
//! exist, each with a fixed argument shape. Filtering (Windows Filtering Platform / macOS Network Extension) is a separate
//! privileged service that is NOT implemented yet; the host reports that honestly instead of claiming Site Gate coverage.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::PathBuf;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;
use std::sync::Mutex;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilterStatus {
    enabled: bool,
    blocked_domains: Vec<String>,
    method: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilterChange {
    verified: bool,
    host: String,
    enabled: bool,
    changed_at: String,
}

/// Apollo's own request history (separate from the OS state), kept for the process lifetime and persisted by the web layer.
#[derive(Default)]
struct RequestHistory(Mutex<HashMap<String, String>>);
#[derive(Default)]
struct FilterLock(Mutex<()>);

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

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn output(program: &str, args: &[&str]) -> Option<String> {
    let value = Command::new(program).args(args).output().ok()?;
    if !value.status.success() { return None; }
    let text = String::from_utf8_lossy(&value.stdout).trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

#[cfg(target_os = "windows")]
fn machine_identity() -> (Option<String>, Option<String>, &'static str) {
    let manufacturer = output("powershell", &["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).Manufacturer"]);
    let model = output("powershell", &["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).Model"]);
    let chassis = output("powershell", &["-NoProfile", "-Command", "(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ','"]).unwrap_or_default();
    let form = if ["8", "9", "10", "14", "30", "31", "32"].iter().any(|code| chassis.split(',').any(|v| v.trim() == *code)) { "laptop" } else { "desktop" };
    (manufacturer, model, form)
}

#[cfg(target_os = "macos")]
fn machine_identity() -> (Option<String>, Option<String>, &'static str) {
    let model = output("sysctl", &["-n", "hw.model"]);
    let form = if model.as_deref().unwrap_or_default().to_lowercase().contains("macbook") { "laptop" } else { "desktop" };
    (Some("Apple Inc.".to_string()), model, form)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn machine_identity() -> (Option<String>, Option<String>, &'static str) { (None, None, "unknown") }

const FILTER_START: &str = "# APOLLO SITE FILTER START";
const FILTER_END: &str = "# APOLLO SITE FILTER END";

fn hosts_path() -> PathBuf {
    if cfg!(target_os = "windows") { PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts") } else { PathBuf::from("/etc/hosts") }
}

fn parse_filter(content: &str) -> (BTreeSet<String>, bool) {
    let mut domains = BTreeSet::new();
    let mut inside = false; let mut enabled = false;
    for line in content.lines() {
        if line.trim() == FILTER_START { inside = true; enabled = true; continue; }
        if line.trim() == FILTER_END { inside = false; continue; }
        if inside {
            if let Some(domain) = line.split_whitespace().nth(1) { domains.insert(domain.to_lowercase()); }
        }
    }
    (domains, enabled)
}

fn current_filter() -> Result<(String, BTreeSet<String>, bool), String> {
    let content = fs::read_to_string(hosts_path()).map_err(|e| format!("cannot read system hosts file: {e}"))?;
    let (domains, enabled) = parse_filter(&content);
    Ok((content, domains, enabled))
}

fn valid_domain(value: &str) -> Result<String, String> {
    let host = value.trim().trim_end_matches('.').to_lowercase();
    if host.len() > 253 || !host.contains('.') || host.split('.').any(|p| p.is_empty() || p.len() > 63 || p.starts_with('-') || p.ends_with('-') || !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        return Err("invalid domain".into());
    }
    Ok(host)
}

#[cfg(test)]
fn without_managed_filter(existing: &str) -> String {
    let mut output_lines = Vec::new(); let mut inside = false;
    for line in existing.lines() {
        if line.trim() == FILTER_START { inside = true; continue; }
        if line.trim() == FILTER_END { inside = false; continue; }
        if !inside { output_lines.push(line.to_string()); }
    }
    output_lines.join("\n") + "\n"
}

#[cfg(test)]
fn render_hosts(existing: &str, domains: &BTreeSet<String>) -> String {
    let mut output_lines: Vec<String> = without_managed_filter(existing).lines().map(str::to_string).collect();
    output_lines.push(FILTER_START.to_string());
    for host in domains { output_lines.push(format!("0.0.0.0 {}", host)); }
    output_lines.push(FILTER_END.to_string());
    output_lines.join("\n") + "\n"
}

#[cfg(target_os = "windows")]
fn base64_utf16le(value: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = ((chunk[0] as u32) << 16) | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8) | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char); out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(any(target_os = "windows", test))]
fn windows_filter_script(action: &str, host: Option<&str>) -> String {
    let host = host.unwrap_or("");
    format!(r#"$ErrorActionPreference='Stop'
$path="$env:SystemRoot\System32\drivers\etc\hosts"; $start='{start}'; $end='{end}'; $action='{action}'; $apolloTargetHost='{host}'
$lines=[IO.File]::ReadAllLines($path); $base=New-Object 'System.Collections.Generic.List[string]'; $set=New-Object 'System.Collections.Generic.HashSet[string]'; $inside=$false
foreach($line in $lines){{ if($line.Trim() -eq $start){{$inside=$true;continue}}; if($line.Trim() -eq $end){{$inside=$false;continue}}; if($inside){{$p=$line -split '\s+';if($p.Length -gt 1){{$null=$set.Add($p[1].ToLowerInvariant())}}}}else{{$base.Add($line)}} }}
if($action -eq 'block'){{$null=$set.Add($apolloTargetHost)}} elseif($action -eq 'unblock'){{$null=$set.Remove($apolloTargetHost)}}
$output=New-Object 'System.Collections.Generic.List[string]';$output.AddRange($base);if($action -ne 'disable'){{$output.Add($start);foreach($d in ($set|Sort-Object)){{$output.Add("0.0.0.0 $d")}};$output.Add($end)}}
$tmp=Join-Path (Split-Path $path) ('.apollo-hosts-'+[guid]::NewGuid().ToString('N'));[IO.File]::WriteAllLines($tmp,$output,(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $tmp -Destination $path -Force
ipconfig /flushdns | Out-Null;$verify=[IO.File]::ReadAllLines($path);$managed=$false;$found=$false;foreach($line in $verify){{if($line.Trim() -eq $start){{$managed=$true;continue}};if($line.Trim() -eq $end){{$managed=$false;continue}};if($managed -and (($line -split '\s+')[1] -eq $apolloTargetHost)){{$found=$true}}}}
if(($action -eq 'block' -and -not $found) -or ($action -eq 'unblock' -and $found)){{throw 'filter verification failed'}}"#,
        start=FILTER_START,end=FILTER_END,action=action,host=host)
}

#[cfg(target_os = "windows")]
fn privileged_filter_update(action: &str, host: Option<&str>) -> Result<(), String> {
    let script = windows_filter_script(action, host);
    let encoded = base64_utf16le(&script);
    let elevate = format!("$p=Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-EncodedCommand','{}';exit $p.ExitCode", encoded);
    let status = Command::new("powershell").args(["-NoProfile", "-Command", &elevate]).status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Windows hosts update failed or administrator approval was declined".into()) }
}

#[cfg(target_os = "macos")]
fn privileged_filter_update(action: &str, host: Option<&str>) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::os::unix::fs::OpenOptionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};
    let host = host.unwrap_or("");
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let path = std::env::temp_dir().join(format!("apollo-filter-{}-{nonce}.sh", std::process::id()));
    let script = format!(r#"#!/bin/sh
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin; hosts=/etc/hosts; start='{start}'; end='{end}'; action='{action}'; host='{host}'
[ -r "$hosts" ]; umask 077; base=/etc/.apollo-hosts-base.$$; domains=/etc/.apollo-hosts-domains.$$; next=/etc/.apollo-hosts-next.$$
trap 'rm -f "$base" "$domains" "$next"' EXIT HUP INT TERM
awk -v s="$start" -v e="$end" '$0==s{{inside=1;next}} $0==e{{inside=0;next}} !inside{{print}}' "$hosts" > "$base"
awk -v s="$start" -v e="$end" '$0==s{{inside=1;next}} $0==e{{inside=0;next}} inside&&NF>1{{print $2}}' "$hosts" | sort -u > "$domains"
case "$action" in block) printf '%s\n' "$host" >> "$domains";; unblock) grep -Fvx "$host" "$domains" > "$domains.new" || true; mv "$domains.new" "$domains";; esac
cat "$base" > "$next"; if [ "$action" != disable ]; then printf '%s\n' "$start" >> "$next"; sort -u "$domains" | while IFS= read -r d; do [ -n "$d" ] && printf '0.0.0.0 %s\n' "$d"; done >> "$next"; printf '%s\n' "$end" >> "$next"; fi
chmod 644 "$next"; chown root:wheel "$next"; mv -f "$next" "$hosts"; dscacheutil -flushcache; killall -HUP mDNSResponder >/dev/null 2>&1 || true
found=$(awk -v s="$start" -v e="$end" -v h="$host" '$0==s{{inside=1;next}} $0==e{{inside=0;next}} inside&&$2==h{{n++}} END{{print n+0}}' "$hosts")
[ "$action" != block ] || [ "$found" -gt 0 ]; [ "$action" != unblock ] || [ "$found" -eq 0 ]
"#,start=FILTER_START,end=FILTER_END,action=action,host=host);
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o700).open(&path).map_err(|e| e.to_string())?;
    use std::io::Write; file.write_all(script.as_bytes()).map_err(|e| e.to_string())?; drop(file);
    let command = format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
    let apple = format!("do shell script \"{}\" with administrator privileges", command.replace('\\', "\\\\").replace('"', "\\\""));
    let status = Command::new("osascript").args(["-e", &apple]).status().map_err(|e| e.to_string())?;
    let _ = fs::remove_file(path);
    if status.success() { Ok(()) } else { Err("macOS hosts update failed or administrator approval was declined".into()) }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn privileged_filter_update(_action: &str, _host: Option<&str>) -> Result<(), String> { Err("desktop filter is supported on Windows and macOS only".into()) }

#[tauri::command]
fn host_info() -> HostInfo {
    let info = os_info::get();
    let platform = if cfg!(target_os = "windows") { "windows" } else { "macos" };
    let (manufacturer, model, form_factor) = machine_identity();
    HostInfo {
        platform,
        os_version: format!("{} {}", info.os_type(), info.version()),
        manufacturer,
        model,
        form_factor,
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
fn permissions(history: State<RequestHistory>) -> Result<Vec<HostPermission>, String> {
    let h = history.0.lock().unwrap();
    let hist = |id: &str| (Some(h.contains_key(id)), h.get(id).cloned());
    let (nr, nt) = hist("notifications");
    let (fr, ft) = hist("network_filter");
    let (_, _, filter_enabled) = current_filter()?;
    Ok(vec![
        // Notification permission state is exposed by tauri-plugin-notification on the web side; here we record request history only.
        HostPermission { id: "notifications", state: "undetermined", enabled: None, requested: nr, last_requested_at: nt, unavailable_reason: None },
        HostPermission { id: "network_filter", state: if filter_enabled { "granted" } else { "undetermined" }, enabled: Some(filter_enabled), requested: fr, last_requested_at: ft, unavailable_reason: None },
        HostPermission { id: "vpn_config", state: "not_applicable", enabled: None, requested: None, last_requested_at: None, unavailable_reason: Some("not_implemented") },
        HostPermission { id: "accessibility", state: "not_applicable", enabled: None, requested: None, last_requested_at: None, unavailable_reason: Some("os_restricted") },
    ])
}

#[tauri::command]
fn request_permission(args: RequestPermissionArgs, history: State<RequestHistory>, filter_lock: State<FilterLock>) -> Result<(), String> {
    let allowed = ["notifications", "network_filter", "vpn_config", "accessibility"];
    if !allowed.contains(&args.id.as_str()) {
        return Err("unknown permission id".into());
    }
    if args.id == "network_filter" {
        let _guard = filter_lock.0.lock().map_err(|_| "filter lock poisoned")?;
        privileged_filter_update("enable", None)?;
    } else if args.id != "notifications" {
        return Err("this permission must be completed in the operating-system Settings page".into());
    }
    history.0.lock().unwrap().insert(args.id, now_iso());
    Ok(())
}

#[tauri::command]
fn filter_status() -> Result<FilterStatus, String> {
    let (_, domains, enabled) = current_filter()?;
    Ok(FilterStatus { enabled, blocked_domains: domains.into_iter().collect(), method: "hosts_dns_filter" })
}

#[tauri::command]
fn block_destination(host: String, filter_lock: State<FilterLock>) -> Result<FilterChange, String> {
    let host = valid_domain(&host)?; let _guard = filter_lock.0.lock().map_err(|_| "filter lock poisoned")?;
    privileged_filter_update("block", Some(&host))?;
    let (_, domains, enabled) = current_filter()?;
    if !enabled || !domains.contains(&host) { return Err("installed hosts rule could not be verified".into()); }
    Ok(FilterChange { verified: true, host, enabled, changed_at: now_iso() })
}

#[tauri::command]
fn unblock_destination(host: String, filter_lock: State<FilterLock>) -> Result<FilterChange, String> {
    let host = valid_domain(&host)?; let _guard = filter_lock.0.lock().map_err(|_| "filter lock poisoned")?;
    privileged_filter_update("unblock", Some(&host))?;
    let (_, domains, enabled) = current_filter()?;
    if domains.contains(&host) { return Err("removed hosts rule is still present".into()); }
    Ok(FilterChange { verified: true, host, enabled, changed_at: now_iso() })
}

#[tauri::command]
fn disable_filter(filter_lock: State<FilterLock>) -> Result<(), String> {
    let _guard = filter_lock.0.lock().map_err(|_| "filter lock poisoned")?;
    privileged_filter_update("disable", None)?;
    let (_, _, enabled) = current_filter()?;
    if enabled { Err("hosts filter disable could not be verified".into()) } else { Ok(()) }
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
        .manage(FilterLock::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![host_info, network_status, permissions, request_permission, filter_status, block_destination, unblock_destination, disable_filter, open_settings_target])
        .run(tauri::generate_context!())
        .expect("error while running Apollo desktop host");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_validation_rejects_commands_and_accepts_exact_hosts() {
        assert_eq!(valid_domain(" Example.COM. ").unwrap(), "example.com");
        assert!(valid_domain("example.com; rm -rf /").is_err());
        assert!(valid_domain("localhost").is_err());
    }

    #[test]
    fn managed_filter_preserves_unrelated_hosts_content() {
        let existing = "127.0.0.1 localhost\n10.0.0.2 intranet\n";
        let domains = BTreeSet::from(["bad.example".to_string()]);
        let rendered = render_hosts(existing, &domains);
        assert!(rendered.contains("10.0.0.2 intranet"));
        assert!(rendered.contains("0.0.0.0 bad.example"));
        assert!(!rendered.contains("www.bad.example"));
        assert_eq!(without_managed_filter(&rendered), existing);
    }

    #[test]
    fn aliases_remain_separate_explicit_rules() {
        let content = format!("{FILTER_START}\n0.0.0.0 example.test\n0.0.0.0 www.example.test\n{FILTER_END}\n");
        let (domains, enabled) = parse_filter(&content);
        assert!(enabled);
        assert_eq!(domains, BTreeSet::from(["example.test".to_string(), "www.example.test".to_string()]));
    }

    #[test]
    fn windows_filter_script_does_not_overwrite_powershell_host_variable() {
        let script = windows_filter_script("block", Some("blocked.example"));
        assert!(script.contains("$apolloTargetHost='blocked.example'"));
        assert!(script.contains("$set.Add($apolloTargetHost)"));
        assert!(script.contains("-eq $apolloTargetHost"));
        assert!(!script.contains("$host="));
        assert!(!script.contains("$set.Add($host)"));
        assert!(!script.contains("-eq $host"));
    }
}
