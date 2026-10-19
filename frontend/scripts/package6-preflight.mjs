import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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
  "desktop/native/macos/ApolloExtensionManager/ApolloExtensionManager.entitlements",
  "desktop/native/macos/project.yml",
  "desktop/src-tauri/entitlements.macos.plist",
  "desktop/src-tauri/tauri.windows.conf.json",
];
const errors = [];
for (const rel of required) if (!fs.existsSync(path.join(root, rel))) errors.push(`Missing ${rel}`);
// Resolve app config — app.config.js is authoritative, but in EAS builds the
// Emergent pipeline may have replaced it with a generated app.json.
const appConfigPath = path.join(frontend, "app.config.js");
const appJsonPath = path.join(frontend, "app.json");
let app;
if (fs.existsSync(appConfigPath)) {
  const appConfig = require(appConfigPath);
  app = appConfig.expo || appConfig;
} else if (fs.existsSync(appJsonPath)) {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  app = appJson.expo || appJson;
} else {
  errors.push("Neither app.config.js nor app.json found.");
  app = { android: {}, ios: {}, extra: {} };
}
if (app.android.package !== "app.apollo.hwg" || app.ios.bundleIdentifier !== "app.apollo.hwg") errors.push("Mobile application identity changed.");
const extensions = app.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
for (const target of ["ApolloContentBlocker", "ApolloCallDirectory", "ApolloMessageFilter"]) if (!extensions.some((item) => item.targetName === target)) errors.push(`Missing iOS target metadata: ${target}`);
const desktop = fs.readFileSync(path.join(root, "desktop/src-tauri/src/lib.rs"), "utf8");
for (const command of ["native_filter_status", "native_enforcement_evidence", "acknowledge_native_evidence", "deactivate_native_filter"]) if (!desktop.includes(command)) errors.push(`Missing desktop host command ${command}`);
const adapter = fs.readFileSync(path.join(frontend, "src/security/DesktopSecurityAdapter.ts"), "utf8");
if (/simulated/i.test(adapter)) errors.push("Desktop production adapter references simulation.");
const macManager = fs.readFileSync(path.join(root, "desktop/native/macos/ApolloExtensionManager/main.swift"), "utf8");
for (const token of ["NEFilterManager.shared()", "filterDataProviderBundleIdentifier", "saveToPreferences"]) if (!macManager.includes(token)) errors.push(`Missing macOS filter activation step: ${token}`);
if (errors.length) { for (const error of errors) console.error(`[package6-preflight] ${error}`); process.exit(1); }
console.log(`[package6-preflight] OK ios-extensions=${extensions.length} desktop-contract=1 package=${app.android.package}`);