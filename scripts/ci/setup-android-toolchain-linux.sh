#!/usr/bin/env bash
# Idempotent Android toolchain setup for a Linux CI/container host (Debian/Ubuntu, x86_64 or arm64).
# Installs JDK 17, Android SDK (platform 36, build-tools 35.0.0), Gradle bootstrap, and — on arm64 —
# runs Google's x86_64 aapt2 through qemu-user-static (AGP ships no arm64 Linux aapt2).
# Afterwards: source /opt/guarddog-android-env.sh && bash scripts/ci/android-native-gate.sh
set -euo pipefail
SDK=/opt/android-sdk
export DEBIAN_FRONTEND=noninteractive
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO=sudo

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq openjdk-17-jdk-headless unzip curl >/dev/null

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  $SUDO mkdir -p "$SDK/cmdline-tools" && $SUDO chown -R "$(id -u)" "$SDK"
  curl -sSL -o /tmp/cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q -o /tmp/cmdline-tools.zip -d "$SDK/cmdline-tools" && mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" "platforms;android-36" "platforms;android-35" "build-tools;35.0.0" "build-tools;34.0.0" "platform-tools" >/dev/null

if [ ! -d /opt/gradle/gradle-8.13 ]; then
  curl -sSL -L -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.13-bin.zip
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
fi

JAVA_DIR="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
$SUDO tee /opt/guarddog-android-env.sh >/dev/null <<EOF
export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK JAVA_HOME=$JAVA_DIR
export PATH=$JAVA_DIR/bin:/opt/gradle/gradle-8.13/bin:$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:\$PATH
EOF
echo "toolchain ready: $(java -version 2>&1 | head -1); source /opt/guarddog-android-env.sh"
