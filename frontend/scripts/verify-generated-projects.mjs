import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const requireMatch = (text, expression, message) => { if (!expression.test(text)) throw new Error(message); };
const requireFile = (relative) => { if (!fs.existsSync(path.join(root, relative))) throw new Error(`missing_generated_file:${relative}`); };

function verifyAndroid() {
  const manifestPath = fs.existsSync(path.join(root, "android/app/build/intermediates/merged_manifests/release/processReleaseMainManifest/AndroidManifest.xml"))
    ? "android/app/build/intermediates/merged_manifests/release/processReleaseMainManifest/AndroidManifest.xml" : "android/app/src/main/AndroidManifest.xml";
  const manifest = read(manifestPath); const gradle = read("android/app/build.gradle"); const settings = read("android/settings.gradle");
  requireMatch(gradle, /namespace ['"]app\.apollo\.hwg['"]/, "android_namespace_mismatch");
  requireMatch(gradle, /applicationId ['"]app\.apollo\.hwg['"]/, "android_application_id_mismatch");
  requireMatch(gradle, /versionName ['"]1\.1\.0['"]/, "android_version_name_mismatch");
  requireMatch(gradle, /versionCode 2\b/, "android_version_code_mismatch");
  requireMatch(manifest, /android:allowBackup="false"/, "android_backup_must_be_disabled");
  for (const name of ["productionEnabled", "trustDomain", "trustProfile", "primaryRootId", "primaryRootKey", "recoveryRootId", "recoveryRootKey"]) requireMatch(manifest, new RegExp(`app\\.apollo\\.guarddog\\.${name}`), `guarddog_metadata_missing:${name}`);
  requireMatch(manifest, /app\.apollo\.guarddog\.productionEnabled[^>]+android:value="true"/, "guarddog_production_not_enabled");
  if (/app\.apollo\.guarddog\.acceptance(?:Enabled|RootId|RootKey)/.test(manifest)) throw new Error("acceptance_trust_must_be_absent");
  for (const permission of ["android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION", "android.permission.POST_NOTIFICATIONS"]) requireMatch(manifest, new RegExp(permission), `ff10_permission_missing:${permission}`);
  if (manifestPath.includes("merged_manifests")) requireMatch(manifest, /FamilyAssistProjectionService/, "ff10_projection_service_missing");
  for (const project of [":guarddog-core", ":guarddog-vpn"]) requireMatch(settings, new RegExp(project.replace("-", "\\-")), `native_module_missing:${project}`);
  const dependencySource = read("modules/apollo-security/android/build.gradle");
  requireMatch(dependencySource, /project\(':guarddog-core'\)/, "guarddog_core_dependency_missing"); requireMatch(dependencySource, /project\(':guarddog-vpn'\)/, "guarddog_vpn_dependency_missing");
  for (const icon of ["mipmap-mdpi/ic_launcher.webp", "mipmap-xhdpi/ic_launcher.webp", "mipmap-xxxhdpi/ic_launcher_foreground.webp", "mipmap-anydpi-v26/ic_launcher.xml"]) requireFile(`android/app/src/main/res/${icon}`);
  const generatedIcon = fs.statSync(path.join(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp"));
  const sourceIcon = fs.statSync(path.join(root, "assets/images/adaptive-icon.png"));
  if (generatedIcon.mtimeMs + 1000 < sourceIcon.mtimeMs) throw new Error("generated_launcher_icon_is_stale");
  for (const name of ["guarddog-core", "guarddog-vpn"]) {
    if ((settings.match(new RegExp(`include\\(['"]:${name}['"]\\)`, "g")) || []).length !== 1) throw new Error(`duplicate_native_module_include:${name}`);
    if ((settings.match(new RegExp(`project\\(['"]:${name}['"]\\)\\.projectDir`, "g")) || []).length !== 1) throw new Error(`duplicate_native_module_project:${name}`);
  }
  const resolved = spawnSync("npx", ["expo-modules-autolinking", "resolve", "--platform", "android", "--json"], { cwd: root, encoding: "utf8" });
  if (resolved.status !== 0) throw new Error("expo_module_autolinking_failed");
  const modules = JSON.parse(resolved.stdout).modules.map((entry) => entry.packageName);
  for (const name of ["apollo-security", "apollo-family-assist"]) if (modules.filter((item) => item === name).length !== 1) throw new Error(`duplicate_or_missing_expo_module:${name}`);
}

function verifyIos() {
  const xcode = require("xcode"); const project = xcode.project(path.join(root, "ios/Apollo.xcodeproj/project.pbxproj")); project.parseSync();
  const objects = project.hash.project.objects; const nativeTargets = objects.PBXNativeTarget || {};
  const hostUuid = Object.keys(nativeTargets).find((key) => !key.endsWith("_comment") && nativeTargets[key].productType === '"com.apple.product-type.application"');
  if (!hostUuid) throw new Error("ios_host_target_missing");
  const host = nativeTargets[hostUuid]; const dependencies = objects.PBXTargetDependency || {};
  const dependencyTargets = new Set((host.dependencies || []).map((entry) => dependencies[entry.value]?.target).filter(Boolean));
  const copyPhases = (host.buildPhases || []).map((entry) => objects.PBXCopyFilesBuildPhase?.[entry.value]).filter((phase) => phase?.dstSubfolderSpec === 13);
  const buildFiles = objects.PBXBuildFile || {}; const embeddedRefs = new Set(copyPhases.flatMap((phase) => phase.files || []).map((entry) => buildFiles[entry.value]?.fileRef).filter(Boolean));
  const targets = ["ApolloMessageFilter", "ApolloContentBlocker", "ApolloCallDirectory", "ApolloShareExtension", "ApolloFamilyAssistBroadcast"];
  for (const target of targets) {
    const targetUuid = Object.keys(nativeTargets).find((key) => !key.endsWith("_comment") && String(nativeTargets[key].name).replaceAll('"', "") === target);
    if (!targetUuid) throw new Error(`ios_target_missing:${target}`);
    if (!dependencyTargets.has(targetUuid)) throw new Error(`ios_host_dependency_missing:${target}`);
    if (!embeddedRefs.has(nativeTargets[targetUuid].productReference)) throw new Error(`ios_embed_product_missing:${target}`);
  }
  if (embeddedRefs.size !== 5) throw new Error("ios_embed_product_count_mismatch");
}

const platform = process.argv[2] || "all";
if (platform === "android" || platform === "all") verifyAndroid();
if (platform === "ios" || platform === "all") verifyIos();
console.log(`generated_project_verification_passed:${platform}`);