#!/usr/bin/env bash
# Idempotent Android toolchain setup for a Linux CI/container host (Debian/Ubuntu, x86_64 or arm64).
# Installs JDK 17, Android SDK (platform 36, build-tools 35.0.0), Gradle bootstrap, and — on arm64 —
# runs Google's x86_64 aapt2 through qemu-user-static (AGP ships no arm64 Linux aapt2).
# Afterwards: source /opt/guarddog-android-env.sh && bash scripts/ci/android-native-gate.sh
set -euo pipefail
SDK=/opt/android-sdk
# Pinned versions + SHA-256 of every standalone download (reproducibility; update deliberately, never "latest").
CMDLINE_TOOLS_ZIP="commandlinetools-linux-11076708_latest.zip"
CMDLINE_TOOLS_SHA256="2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258"
GRADLE_VERSION="8.13"
GRADLE_SHA256="20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78"
PLATFORMS="platforms;android-36 platforms;android-35"
BUILD_TOOLS="build-tools;35.0.0 build-tools;34.0.0"
JDK_PKG="openjdk-17-jdk-headless"
NDK_VERSION="27.1.12297006"   # must match react-native/gradle/libs.versions.toml (Expo SDK 57 / RN 0.81)
CMAKE_VERSION="3.22.1"
verify() { echo "$2  $1" | sha256sum -c - >/dev/null || { echo "CHECKSUM MISMATCH for $1"; exit 1; }; }
export DEBIAN_FRONTEND=noninteractive
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO=sudo

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq "$JDK_PKG" unzip curl >/dev/null

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  $SUDO mkdir -p "$SDK/cmdline-tools" && $SUDO chown -R "$(id -u)" "$SDK"
  curl -sSL -o /tmp/cmdline-tools.zip "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  verify /tmp/cmdline-tools.zip "$CMDLINE_TOOLS_SHA256"
  unzip -q -o /tmp/cmdline-tools.zip -d "$SDK/cmdline-tools" && mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
# shellcheck disable=SC2086
"$SDK/cmdline-tools/latest/bin/sdkmanager" $PLATFORMS $BUILD_TOOLS "platform-tools" >/dev/null

if [ ! -d "/opt/gradle/gradle-$GRADLE_VERSION" ]; then
  curl -sSL -L -o /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  verify /tmp/gradle.zip "$GRADLE_SHA256"
  $SUDO mkdir -p /opt/gradle && $SUDO unzip -q -o /tmp/gradle.zip -d /opt/gradle
fi

if [ "$(uname -m)" = "aarch64" ]; then
  $SUDO dpkg --add-architecture amd64 && $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq qemu-user-static libc6:amd64 libstdc++6:amd64 libgcc-s1:amd64 zlib1g:amd64 >/dev/null
  $SUDO mkdir -p /opt/aapt2 && $SUDO chown "$(id -u)" /opt/aapt2
  printf '#!/bin/sh\nexec /usr/bin/qemu-x86_64-static %s/build-tools/35.0.0/aapt2 "$@"\n' "$SDK" > /opt/aapt2/aapt2 && chmod +x /opt/aapt2/aapt2
  mkdir -p "$HOME/.gradle"
  grep -q aapt2FromMavenOverride "$HOME/.gradle/gradle.properties" 2>/dev/null || echo "android.aapt2FromMavenOverride=/opt/aapt2/aapt2" >> "$HOME/.gradle/gradle.properties"
  grep -q "org.gradle.jvmargs" "$HOME/.gradle/gradle.properties" || echo "org.gradle.jvmargs=-Xmx3g" >> "$HOME/.gradle/gradle.properties"
  /opt/aapt2/aapt2 version
  # NDK + CMake are x86_64-only as well: install the pinned versions and wrap every ELF tool so cmake/ninja/clang/lld run
  # through qemu. `-0 "$0"` preserves argv[0] (lld picks its flavour — ld.lld — from it). Slow, but functionally complete.
  "$SDK/cmdline-tools/latest/bin/sdkmanager" "ndk;$NDK_VERSION" "cmake;$CMAKE_VERSION" >/dev/null
  python3 - "$SDK/cmake/$CMAKE_VERSION/bin" "$SDK/ndk/$NDK_VERSION/toolchains/llvm/prebuilt/linux-x86_64/bin" <<'PY'
import os, sys
for d in sys.argv[1:]:
    n = 0
    for name in os.listdir(d):
        f = os.path.join(d, name)
        if os.path.islink(f) or not os.path.isfile(f) or name.endswith(".x86_64"): continue
        with open(f, "rb") as fh: hdr = fh.read(20)
        if not (hdr[:4] == b"\x7fELF" and hdr[18:20] == b"\x3e\x00"): continue
        os.rename(f, f + ".x86_64")
        with open(f, "w") as w: w.write(f'#!/bin/sh\nexec /usr/bin/qemu-x86_64-static -0 "$0" "{f}.x86_64" "$@"\n')
        os.chmod(f, 0o755); n += 1
    print(f"{d}: wrapped {n} x86_64 tools for qemu")
PY
fi

JAVA_DIR="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
$SUDO tee /opt/guarddog-android-env.sh >/dev/null <<EOF
export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK JAVA_HOME=$JAVA_DIR
export PATH=$JAVA_DIR/bin:/opt/gradle/gradle-$GRADLE_VERSION/bin:$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:\$PATH
EOF
echo "toolchain ready: $(java -version 2>&1 | head -1); source /opt/guarddog-android-env.sh"
