// Harness-only build provenance (NOT part of the public GuardDogSecuritySDK surface).
// Ties a device proof to the exact CI artifact: SHA-256 of the installed APK (compare with apk-recheck.txt),
// plus the Git commit / CI run id baked into the JS bundle at build time (EXPO_PUBLIC_* set by android-dev-build.sh).
import { GuardDogNative, type NativeBuildProvenance } from "@/src/sdk/nativeModule";

export interface BuildProvenance extends NativeBuildProvenance {
  gitSha: string | null;
  ciRunId: string | null;
}

export async function readBuildProvenance(): Promise<BuildProvenance> {
  const native: NativeBuildProvenance = GuardDogNative
    ? await GuardDogNative.getBuildProvenance()
    : { apkSha256: null, apkSizeBytes: null, splitApks: 0, packageName: null, versionName: null, versionCode: null, debuggable: null };
  return {
    ...native,
    gitSha: process.env.EXPO_PUBLIC_GIT_SHA ?? null,
    ciRunId: process.env.EXPO_PUBLIC_CI_RUN_ID ?? null,
  };
}
