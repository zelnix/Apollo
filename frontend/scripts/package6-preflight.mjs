import fs from "node:fs";
import path from "node:path";

const frontend = process.cwd();
const root = path.resolve(frontend, "..");
const required = [
  "frontend/plugins/withApolloTextGuard.js",
  "frontend/plugins/ios/ApolloMessageFilter/MessageFilterExtension.swift",
  "frontend/plugins/ios/ApolloMessageFilter/Info.plist",
  "desktop/native/platform-delivery.json",
  "desktop/native/windows-wfp/ApolloWfpService.cpp",
  "desktop/native/windows-wfp/CMakeLists.txt",
  "desktop/native/macos/ApolloNetworkExtension/FilterDataProvider.swift",
  "desktop/native/macos/ApolloNetworkExtension/Info.plist",
  "desktop/native/macos/ApolloNetworkExtension/ApolloNetworkExtension.entitlements",
  "desktop/native/macos/ApolloExtensionManager/main.swift",
  "desktop/native/macos/project.yml",
  "desktop/src-tauri/entitlements.macos.plist",
  "desktop/src-tauri/tauri.windows.conf.json",
];
const errors = [];
for (const rel of required) if (!fs.existsSync(path.join(root, rel))) errors.push(`Missing ${rel}`);
const app = JSON.parse(fs.readFileSync(path.join(frontend, "app.json"), "utf8"));
if (app.expo.android.package !== "app.apollo.hwg" || app.expo.ios.bundleIdentifier !== "app.apollo.hwg") errors.push("Mobile application identity changed.");
const extensions = app.expo.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
for (const target of ["ApolloContentBlocker", "ApolloCallDirectory", "ApolloMessageFilter"]) if (!extensions.some((item) => item.targetName === target)) errors.push(`Missing iOS target metadata: ${target}`);
const desktop = fs.readFileSync(path.join(root, "desktop/src-tauri/src/lib.rs"), "utf8");
for (const command of ["native_filter_status", "native_enforcement_evidence", "acknowledge_native_evidence", "deactivate_native_filter"]) if (!desktop.includes(command)) errors.push(`Missing desktop host command ${command}`);
const adapter = fs.readFileSync(path.join(frontend, "src/security/DesktopSecurityAdapter.ts"), "utf8");
if (/simulated/i.test(adapter)) errors.push("Desktop production adapter references simulation.");
if (errors.length) { for (const error of errors) console.error(`[package6-preflight] ${error}`); process.exit(1); }
console.log(`[package6-preflight] OK ios-extensions=${extensions.length} desktop-contract=1 package=${app.expo.android.package}`);