#!/usr/bin/env python3
"""Gate Guard — packaged RELEASE manifest audit (final M1 gate). Reads the manifest of the artifact that would ship — never a
source or merged intermediate — and applies one fixed rule set to both container formats:

  * APK : `aapt2 dump xmltree --file AndroidManifest.xml app-release.apk` (binary manifest, authoritative for the APK)
  * AAB : `bundletool dump manifest --bundle app-release.aab`             (bundle-derived manifest XML)

Usage:
  gate_guard_audit.py apk  <xmltree.txt> <badging.txt> <evidence-out.txt> <permissions-out.txt>
  gate_guard_audit.py aab  <manifest.xml>               <evidence-out.txt> <permissions-out.txt>
  gate_guard_audit.py --selftest

Exit 0 only when every REQUIRED check passes. The complete final <uses-permission> set is written to the permissions file so
"expected normal permissions only" is auditable line by line, not a judgement call.
"""
import re
import sys
import xml.etree.ElementTree as ET

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
VPN_SERVICE = "com.guarddog.vpn.GuardDogVpnService"
FGS_SYSTEM_EXEMPTED = 0x400  # ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED

# Every permission the shipping artifact is allowed to request, with its origin (the known merged set minus the debug-only
# SYSTEM_ALERT_WINDOW). Anything else — including any new transitive dependency permission — is an audit FAIL until reviewed here.
ALLOWED_PERMISSIONS = {
    "android.permission.INTERNET": "core (rules distribution + controlled endpoint)",
    "android.permission.ACCESS_NETWORK_STATE": "core (VPN transport / recovery snapshot)",
    "android.permission.FOREGROUND_SERVICE": "GuardDogVpnService foreground service",
    "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED": "GuardDogVpnService systemExempted FGS type",
    "android.permission.POST_NOTIFICATIONS": "foreground-service notification (declared in app.json)",
    "android.permission.VIBRATE": "expo-haptics (framework)",
    "android.permission.USE_BIOMETRIC": "expo-secure-store (framework)",
    "android.permission.USE_FINGERPRINT": "expo-secure-store (framework, legacy alias)",
    "android.permission.ACCESS_WIFI_STATE": "expo-network (framework; Phase 6 harness reads network type -- wifi vs cellular -- for the acceptance report's device/environment section)",
}
# androidx declares this app-private signature permission under the app's own package name (<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION).
APP_SCOPED_ALLOWED = {"DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION": "androidx runtime receiver hardening (app-private signature permission)"}


def permission_origin(name, package):
    if name in ALLOWED_PERMISSIONS:
        return ALLOWED_PERMISSIONS[name]
    if package and name.startswith(package + "."):
        return APP_SCOPED_ALLOWED.get(name[len(package) + 1:])
    return None

# Established deny-list: any of these in the shipping artifact fails the audit outright.
DENY_LIST = [
    "android.permission.SYSTEM_ALERT_WINDOW",  # react-native DEBUG-only dev overlay; must not survive into release
    "android.permission.QUERY_ALL_PACKAGES", "android.permission.PACKAGE_USAGE_STATS", "android.permission.READ_SMS",
    "android.permission.RECEIVE_SMS", "android.permission.SEND_SMS", "android.permission.READ_CALL_LOG", "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS", "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_AUDIO", "android.permission.BIND_ACCESSIBILITY_SERVICE",
    "android.permission.BIND_DEVICE_ADMIN", "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA", "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.READ_PHONE_STATE", "android.permission.READ_PHONE_NUMBERS",
    "android.permission.CALL_PHONE", "android.permission.PROCESS_OUTGOING_CALLS", "android.permission.BODY_SENSORS",
    "android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.REQUEST_DELETE_PACKAGES", "android.permission.WRITE_SETTINGS",
    "android.permission.WRITE_SECURE_SETTINGS", "android.permission.GET_ACCOUNTS", "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR", "android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN",
    "android.permission.NEARBY_WIFI_DEVICES", "android.permission.CHANGE_WIFI_STATE",
    "android.permission.CHANGE_NETWORK_STATE", "android.permission.CONTROL_VPN", "android.permission.DUMP", "android.permission.READ_LOGS",
]


class Node:
    def __init__(self, tag, attrs=None):
        self.tag, self.attrs, self.children = tag, dict(attrs or {}), []

    def iter(self):
        yield self
        for c in self.children:
            yield from c.iter()

    def find_all(self, tag):
        return [n for n in self.iter() if n.tag == tag]


# ---------------------------------------------------------------- parsers
def parse_xmltree(text):
    """`aapt2 dump xmltree` → Node tree. Attribute keys are the bare android:<name>; values as printed (strings unquoted)."""
    root, stack = Node("__root__"), []
    for raw in text.splitlines():
        line = raw.rstrip()
        m = re.match(r"^(\s*)E: ([\w.\-]+)", line)
        if m:
            depth = len(m.group(1))
            node = Node(m.group(2))
            while stack and stack[-1][0] >= depth:
                stack.pop()
            (stack[-1][1] if stack else root).children.append(node)
            stack.append((depth, node))
            continue
        m = re.match(r"^\s*A: (?:(?:http://schemas\.android\.com/apk/res/android|android):)?([\w]+)(?:\(0x[0-9a-fA-F]+\))?=(?:\(type 0x[0-9a-fA-F]+\))?\s*(.*)$", line)
        if m and stack:
            key, val = m.group(1), m.group(2).strip()
            q = re.match(r'^"(.*)"(?:\s+\(Raw: ".*"\))?$', val)
            stack[-1][1].attrs[key] = q.group(1) if q else val
    return root


def parse_xml(text):
    """bundletool `dump manifest` XML → Node tree with the android: namespace stripped from attribute names."""
    def convert(el):
        attrs = {(k[len(ANDROID_NS):] if k.startswith(ANDROID_NS) else k): v for k, v in el.attrib.items()}
        n = Node(el.tag, attrs)
        n.children = [convert(c) for c in el]
        return n
    root = Node("__root__")
    root.children.append(convert(ET.fromstring(text)))
    return root


def as_int(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == "systemExempted":
        return FGS_SYSTEM_EXEMPTED
    try:
        return int(v, 0)
    except ValueError:
        return None


def as_bool(v):
    return None if v is None else str(v).strip().lower() in ("true", "1", "0xffffffff", "-1")


# ---------------------------------------------------------------- facts + rules
def extract_facts(root, badging=""):
    manifest = next(iter(root.find_all("manifest")), None)
    perms = {p.attrs.get("name") for p in root.find_all("uses-permission")} | {p.attrs.get("name") for p in root.find_all("uses-permission-sdk-23")}
    perms |= set(re.findall(r"uses-permission(?:-sdk-23)?: name='([^']+)'", badging))
    perms.discard(None)
    sdk = next(iter(root.find_all("uses-sdk")), None)
    app = next(iter(root.find_all("application")), None)
    svc = next((s for s in root.find_all("service") if s.attrs.get("name") == VPN_SERVICE), None)
    min_sdk = as_int(sdk.attrs.get("minSdkVersion")) if sdk else None
    target_sdk = as_int(sdk.attrs.get("targetSdkVersion")) if sdk else None
    if min_sdk is None:
        m = re.search(r"^sdkVersion:'(\d+)'", badging, re.M); min_sdk = int(m.group(1)) if m else None
    if target_sdk is None:
        m = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.M); target_sdk = int(m.group(1)) if m else None
    return {
        "package": manifest.attrs.get("package") if manifest else None,
        "perms": perms,
        "min_sdk": min_sdk,
        "target_sdk": target_sdk,
        "debuggable": as_bool(app.attrs.get("debuggable")) if app else None,
        "badging_debuggable": "application-debuggable" in badging,
        "service_present": svc is not None,
        "service_permission": svc.attrs.get("permission") if svc else None,
        "service_exported": as_bool(svc.attrs.get("exported")) if svc else None,
        "service_fgs_type": (as_int(svc.attrs.get("foregroundServiceType")) or 0) if svc else 0,
        "service_vpn_action": bool(svc) and any(a.attrs.get("name") == "android.net.VpnService" for a in svc.find_all("action")),
        "accessibility_services": [s.attrs.get("name") for s in root.find_all("service") if s.attrs.get("permission") == "android.permission.BIND_ACCESSIBILITY_SERVICE"],
        "exported_services": sorted(s.attrs.get("name", "?") for s in root.find_all("service") if as_bool(s.attrs.get("exported"))),
    }


def evaluate(f, expected_package):
    checks = {
        f"package is {expected_package}": f["package"] == expected_package,
        "android:debuggable ABSENT (release variant)": f["debuggable"] in (None, False) and not f["badging_debuggable"],
        "minSdkVersion 26": f["min_sdk"] == 26,
        "targetSdkVersion 36": f["target_sdk"] == 36,
        f"{VPN_SERVICE} present": f["service_present"],
        "service android:permission BIND_VPN_SERVICE": f["service_permission"] == "android.permission.BIND_VPN_SERVICE",
        "service android:exported=false": f["service_exported"] is False,
        "service foregroundServiceType includes systemExempted (0x400)": bool(f["service_fgs_type"] & FGS_SYSTEM_EXEMPTED),
        "service intent action android.net.VpnService": f["service_vpn_action"],
        "uses-permission FOREGROUND_SERVICE": "android.permission.FOREGROUND_SERVICE" in f["perms"],
        "uses-permission FOREGROUND_SERVICE_SYSTEM_EXEMPTED": "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" in f["perms"],
        "uses-permission INTERNET": "android.permission.INTERNET" in f["perms"],
        "uses-permission ACCESS_NETWORK_STATE": "android.permission.ACCESS_NETWORK_STATE" in f["perms"],
        "no accessibility service declared": not f["accessibility_services"],
    }
    for d in DENY_LIST:
        checks[f"absent: {d.split('.')[-1]}"] = d not in f["perms"]
    unexpected = sorted(p for p in f["perms"] if permission_origin(p, expected_package) is None)
    checks["every requested permission is on the allow-list (see permission set)"] = not unexpected
    return checks, unexpected


def render(kind, f, checks, unexpected):
    lines = [f"== packaged RELEASE manifest audit ({kind}) ==",
             f"package={f['package']} minSdk={f['min_sdk']} targetSdk={f['target_sdk']} debuggable={f['debuggable']} fgsType={hex(f['service_fgs_type'])}"]
    lines += [f"{'PASS' if v else 'FAIL'}  {k}" for k, v in checks.items()]
    if unexpected:
        lines += [f"      unexpected permission: {p}" for p in unexpected]
    if f["exported_services"]:
        lines.append("INFO  exported services: " + ", ".join(f["exported_services"]))
    ok = all(checks.values())
    lines.append(f"RELEASE MANIFEST AUDIT ({kind}): {'PASS' if ok else 'FAIL'}")
    return ok, lines


def permission_listing(kind, f):
    out = [f"== complete final <uses-permission> set of the packaged {kind} ({len(f['perms'])}) =="]
    for p in sorted(f["perms"]):
        out.append(f"{p}  <- {permission_origin(p, f['package']) or 'NOT ON ALLOW-LIST'}")
    return out


# ---------------------------------------------------------------- self-test (parsers + rules on inline fixtures)
XMLTREE_FIXTURE = """N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
    A: android:versionCode(0x0101021b)=1
    A: package="com.example.app" (Raw: "com.example.app")
    E: uses-sdk (line=7)
      A: android:minSdkVersion(0x0101020c)=26
      A: android:targetSdkVersion(0x01010270)=36
    E: uses-permission (line=8)
      A: android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")
    E: uses-permission (line=9)
      A: android:name(0x01010003)="android.permission.ACCESS_NETWORK_STATE" (Raw: "android.permission.ACCESS_NETWORK_STATE")
    E: uses-permission (line=10)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE" (Raw: "android.permission.FOREGROUND_SERVICE")
    E: uses-permission (line=11)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" (Raw: "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED")
    E: uses-permission (line=12)
      A: android:name(0x01010003)="android.permission.SYSTEM_ALERT_WINDOW" (Raw: "android.permission.SYSTEM_ALERT_WINDOW")
    E: application (line=20)
      A: android:debuggable(0x0101000f)=true
      E: service (line=30)
        A: android:name(0x01010003)="com.guarddog.vpn.GuardDogVpnService" (Raw: "com.guarddog.vpn.GuardDogVpnService")
        A: android:permission(0x01010006)="android.permission.BIND_VPN_SERVICE" (Raw: "android.permission.BIND_VPN_SERVICE")
        A: android:exported(0x01010010)=false
        A: android:foregroundServiceType(0x01010599)=(type 0x11)0x00000400
        E: intent-filter (line=31)
          E: action (line=32)
            A: android:name(0x01010003)="android.net.VpnService" (Raw: "android.net.VpnService")
      E: service (line=40)
        A: android:name(0x01010003)="com.example.Other" (Raw: "com.example.Other")
        A: android:exported(0x01010010)=true
"""

XML_FIXTURE = """<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED"/>
  <application>
    <service android:name="com.guarddog.vpn.GuardDogVpnService" android:permission="android.permission.BIND_VPN_SERVICE" android:exported="false" android:foregroundServiceType="systemExempted">
      <intent-filter><action android:name="android.net.VpnService"/></intent-filter>
    </service>
  </application>
</manifest>"""


def selftest():
    f = extract_facts(parse_xmltree(XMLTREE_FIXTURE), badging="application-debuggable\n")
    checks, unexpected = evaluate(f, "com.example.app")
    assert f["min_sdk"] == 26 and f["target_sdk"] == 36, f
    assert f["service_present"] and f["service_permission"] == "android.permission.BIND_VPN_SERVICE" and f["service_exported"] is False, f
    assert f["service_fgs_type"] == 0x400 and f["service_vpn_action"], f
    assert f["exported_services"] == ["com.example.Other"], f
    assert checks["android:debuggable ABSENT (release variant)"] is False, "debug fixture must fail the debuggable rule"
    assert checks["absent: SYSTEM_ALERT_WINDOW"] is False, "SYSTEM_ALERT_WINDOW fixture must fail the deny-list rule"
    assert unexpected == ["android.permission.SYSTEM_ALERT_WINDOW"], unexpected  # also off the allow-list: two independent FAILs
    debug_only_fails = {"android:debuggable ABSENT (release variant)", "absent: SYSTEM_ALERT_WINDOW", "every requested permission is on the allow-list (see permission set)"}
    assert all(v for k, v in checks.items() if k not in debug_only_fails), checks
    g = extract_facts(parse_xml(XML_FIXTURE))
    checks2, unexpected2 = evaluate(g, "com.example.app")
    assert g["service_fgs_type"] == 0x400 and g["debuggable"] is None and g["min_sdk"] == 26, g
    assert all(checks2.values()) and not unexpected2, checks2
    # a foreign permission must be flagged
    h = extract_facts(parse_xml(XML_FIXTURE.replace("</application>", '</application><uses-permission android:name="com.evil.PERM"/>')))
    _, unexpected3 = evaluate(h, "com.example.app")
    assert unexpected3 == ["com.evil.PERM"], unexpected3
    print("gate_guard_audit selftest: PASS (xmltree + xml parsers, debuggable/deny-list/allow-list rules)")


def main(argv):
    if argv[1:] == ["--selftest"]:
        selftest(); return 0
    kind = argv[1]
    if kind == "apk":
        tree_path, badging_path, out_path, perms_path, expected_package = argv[2:7]
        badging = open(badging_path).read()
        f = extract_facts(parse_xmltree(open(tree_path).read()), badging)
    elif kind == "aab":
        xml_path, out_path, perms_path, expected_package = argv[2:6]
        f = extract_facts(parse_xml(open(xml_path).read()))
    else:
        raise SystemExit(__doc__)
    checks, unexpected = evaluate(f, expected_package)
    ok, lines = render(kind.upper(), f, checks, unexpected)
    open(out_path, "w").write("\n".join(lines) + "\n")
    open(perms_path, "w").write("\n".join(permission_listing(kind.upper(), f)) + "\n")
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
