// app.config.js — single authoritative Expo configuration.
// There is no app.json; this file is the sole config source.
// Expo loads it automatically (https://docs.expo.dev/workflow/configuration/).

const acceptance = require("./guarddog-acceptance.config.json");

const ANDROID_PACKAGE = "app.apollo.hwg";
const IOS_BUNDLE_IDENTIFIER = "app.apollo.hwg";

// ── Expo project identity ──────────────────────────────────────────────────
// Canonical values for the owner's Expo project.
//
// Emergent (or any other build route that targets a *different* Expo project)
// can override all three atomically via environment variables:
//   EAS_PROJECT_OWNER   – Expo account that owns the build project
//   EAS_PROJECT_SLUG    – project slug registered under that account
//   EAS_PROJECT_ID      – the project's UUID (extra.eas.projectId)
const CANONICAL_OWNER      = "zelnixs-team";
const CANONICAL_SLUG       = "apollo-cyber-guard-dog";
const CANONICAL_PROJECT_ID = "b2eb337d-2687-46bf-b1cc-292d30c0b601";

const EAS_OWNER      = process.env.EAS_PROJECT_OWNER || CANONICAL_OWNER;
const EAS_SLUG       = process.env.EAS_PROJECT_SLUG  || CANONICAL_SLUG;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID    || CANONICAL_PROJECT_ID;

// Evaluate dynamic values at require-time (all env vars are available).
const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV || "development";
const engine = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || (appEnvironment === "production" ? "guarddog_production" : "legacy");
const candidate = engine === "guarddog_acceptance" ? acceptance : {};

// Direct object export — compatible with both Expo's config loader and the
// Emergent build pipeline which does require('./app.config.js') without
// calling a function.  All dynamic values are resolved above.
module.exports = {
  // ── core identity ────────────────────────────────────────────────────
  name: "Apollo",
    owner: EAS_OWNER,
    slug: EAS_SLUG,
    version: "1.1.0",
    orientation: "default",
    icon: "./assets/images/icon.png",
    scheme: "apollo",
    userInterfaceStyle: "light",
    backgroundColor: "#F5F7FA",

    // ── iOS ──────────────────────────────────────────────────────────────
    ios: {
      buildNumber: "2",
      supportsTablet: true,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      infoPlist: {
        // Export compliance: iOS uses only system-provided encryption (Keychain via
        // SecureStore, HTTPS/TLS, CryptoKit SHA-256 hashing, WebRTC DTLS/SRTP).
        // No custom or proprietary encryption algorithms. Android's AES/GCM-NoPadding
        // (Keystore-backed) in ApolloSmsListenerService is Android-only and does not
        // affect the iOS encryption classification. All usage qualifies as exempt under
        // Apple's export compliance categories.
        ITSAppUsesNonExemptEncryption: false,
        NSUserNotificationsUsageDescription: "Receive important threat and family alerts",
        NSLocationWhenInUseUsageDescription: "Check whether your Wi-Fi connection is secured",
        NSMicrophoneUsageDescription: "Record reassurance notes for trusted family",
      },
      entitlements: {
        "com.apple.developer.networking.wifi-info": true,
      },
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
          { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        ],
        NSPrivacyCollectedDataTypes: [],
        NSPrivacyTracking: false,
      },
    },

    // ── Android ──────────────────────────────────────────────────────────
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#F5F7FA",
      },
      package: ANDROID_PACKAGE,
      googleServicesFile: "./google-services.json",
      permissions: [
        "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.INTERNET",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.CAMERA",
      ],
    },

    // ── Web ──────────────────────────────────────────────────────────────
    web: {
      bundler: "metro",
      output: "single",
      themeColor: "#F5F7FA",
      backgroundColor: "#F5F7FA",
      favicon: "./assets/images/favicon.png",
    },

    // ── Plugins ──────────────────────────────────────────────────────────
    plugins: [
      "./plugins/withEasAppExtensionsDedupe",
      "./plugins/withNativeDependencyGuard",
      "./modules/apollo-family-assist/plugin/withApolloFamilyAssist",
      "expo-router",
      ["expo-notifications", { sounds: ["./assets/sounds/apollo_bark.wav", "./assets/sounds/apollo_chime.wav"] }],
      ["expo-splash-screen", { image: "./assets/images/splash-image.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#F5F7FA" }],
      "expo-font",
      "expo-asset",
      "expo-image",
      "expo-secure-store",
      "expo-web-browser",
      "expo-status-bar",
      "./plugins/withApolloShareIntake",
      ["expo-share-intent", {
        iosAppGroupIdentifier: "group.app.apollo.hwg.apollo",
        iosShareExtensionBundleIdentifier: "app.apollo.hwg.shareextension",
        iosShareExtensionName: "Apollo Share Extension",
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsImageWithMaxCount: 10,
          NSExtensionActivationSupportsFileWithMaxCount: 10,
        },
        androidIntentFilters: ["text/*", "image/*", "application/*"],
        androidMultiIntentFilters: ["*/*"],
      }],
      "./plugins/withApolloSiteGuard",
      "./plugins/withApolloCallGuard",
      "./plugins/withApolloTextGuard",
      "./plugins/withGuardDogEngine",
      "./plugins/withGuardDogCandidateProfile",
      "./plugins/withGuardDogProductionTrust",
      "./plugins/withLiveCallerID",
      "expo-sharing",
      ["expo-camera", { cameraPermission: "Scan QR codes so Apollo can check where they lead", microphonePermission: false, recordAudioAndroid: false }],
      ["expo-image-picker", { photosPermission: "Pick a screenshot of a message for Apollo to check", cameraPermission: false, microphonePermission: false }],
      ["expo-audio", { microphonePermission: false }],
      ["expo-build-properties", { android: { minSdkVersion: 26 }, ios: { deploymentTarget: "16.4" } }],
    ],

    // ── Updates (EAS Update) ─────────────────────────────────────────────
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    },
    runtimeVersion: {
      policy: "appVersion",
    },

    // ── Experiments ──────────────────────────────────────────────────────
    experiments: {
      typedRoutes: true,
    },

    // ── Extra ────────────────────────────────────────────────────────────
    extra: {
      pirServer: { url: "" },
      eas: {
        build: {
          experimental: {
            ios: {
              appExtensions: [
                { targetName: "ApolloFamilyAssistBroadcast", bundleIdentifier: "app.apollo.hwg.familyassistbroadcast", entitlements: { "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
                { targetName: "ApolloShareExtension", bundleIdentifier: "app.apollo.hwg.shareextension", entitlements: { "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
                { targetName: "ApolloContentBlocker", bundleIdentifier: "app.apollo.hwg.contentblocker", entitlements: { "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
                { targetName: "ApolloCallDirectory", bundleIdentifier: "app.apollo.hwg.calldirectory", entitlements: { "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
                { targetName: "ApolloMessageFilter", bundleIdentifier: "app.apollo.hwg.messagefilter", entitlements: { "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
                { targetName: "ApolloLiveCallerID", bundleIdentifier: "app.apollo.hwg.ApolloLiveCallerID", entitlements: { "com.apple.developer.live-caller-id-lookup": true, "com.apple.security.application-groups": ["group.app.apollo.hwg.apollo"] } },
              ],
            },
          },
        },
        projectId: EAS_PROJECT_ID,
      },
      guardDogCandidate: {
        engine,
        profile: "guarddog-stage1d-acceptance",
        controlledHost: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST || candidate.controlledHost || "",
        controlledIpv4: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4 || candidate.controlledIpv4 || "",
        controlledUrl: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL || candidate.controlledUrl || "",
        rulesetId: process.env.EXPO_PUBLIC_GUARDDOG_RULESET_ID || candidate.rulesetId || "",
        signedBundleB64: process.env.EXPO_PUBLIC_GUARDDOG_SIGNED_BUNDLE_B64 || candidate.signedBundleB64 || "",
      },
      guardDogProduction: {
        manifestUrl: process.env.EXPO_PUBLIC_GUARDDOG_TRUST_MANIFEST_URL || "",
        ruleBundleUrl: process.env.EXPO_PUBLIC_GUARDDOG_RULE_BUNDLE_URL || "",
        controlledHost: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST || "",
        controlledIpv4: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4 || "",
        controlledUrl: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL || "",
        rulesetId: process.env.EXPO_PUBLIC_GUARDDOG_RULESET_ID || "",
        dedupeWindowMs: Number(process.env.EXPO_PUBLIC_GUARDDOG_DEDUPE_WINDOW_MS || "2000"),
      },
    },
};
