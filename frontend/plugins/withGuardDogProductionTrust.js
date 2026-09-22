const { withAndroidManifest } = require("expo/config-plugins");

const TEST_KEY_ID = "m1-acceptance";
const TEST_PUBLIC_KEY = "xWUz5JD/mRHiCg7axpaEQV+dJ6cllJV4UHWOA9YPh1A=";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when guarddog_production is selected`);
  return value;
}
function publicKey(name) {
  const value = required(name);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error(`${name} must be canonical base64 for exactly 32 Ed25519 public-key bytes`);
  if (value === TEST_PUBLIC_KEY) throw new Error(`${name} cannot use the GuardDog acceptance test key`);
  return value;
}

module.exports = function withGuardDogProductionTrust(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error("Android application manifest is unavailable");
    app.$["android:allowBackup"] = "false";
    const metadata = app["meta-data"] ?? [];
    const names = ["app.apollo.guarddog.productionEnabled", "app.apollo.guarddog.trustDomain", "app.apollo.guarddog.trustProfile",
      "app.apollo.guarddog.primaryRootId", "app.apollo.guarddog.primaryRootKey", "app.apollo.guarddog.recoveryRootId", "app.apollo.guarddog.recoveryRootKey"];
    app["meta-data"] = metadata.filter((entry) => !names.includes(entry.$?.["android:name"]));
    const selected = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE === "guarddog_production";
    app["meta-data"].push({ $: { "android:name": names[0], "android:value": selected ? "true" : "false" } });
    if (!selected) return mod;
    if (process.env.EXPO_PUBLIC_APP_ENV !== "production") throw new Error("guarddog_production requires EXPO_PUBLIC_APP_ENV=production");
    const primaryId = required("APOLLO_GUARDDOG_PRIMARY_ROOT_ID"); const recoveryId = required("APOLLO_GUARDDOG_RECOVERY_ROOT_ID");
    if (primaryId === recoveryId || [primaryId, recoveryId].includes(TEST_KEY_ID)) throw new Error("Production primary/recovery root IDs must be distinct and cannot use the acceptance key ID");
    const values = [required("APOLLO_GUARDDOG_TRUST_DOMAIN"), required("APOLLO_GUARDDOG_TRUST_PROFILE"), primaryId,
      publicKey("APOLLO_GUARDDOG_PRIMARY_ROOT_PUBLIC_KEY_B64"), recoveryId, publicKey("APOLLO_GUARDDOG_RECOVERY_ROOT_PUBLIC_KEY_B64")];
    names.slice(1).forEach((name, index) => app["meta-data"].push({ $: { "android:name": name, "android:value": values[index] } }));
    return mod;
  });
};