#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NATIVE="$ROOT/native/macos"
OUT="$NATIVE/build"
command -v xcodegen >/dev/null 2>&1 || { echo "xcodegen is required to generate the native extension project" >&2; exit 2; }
cd "$NATIVE"
xcodegen generate
xcodebuild -project ApolloNativeExtensions.xcodeproj -scheme ApolloNetworkExtension -configuration Release -derivedDataPath "$OUT" build
xcodebuild -project ApolloNativeExtensions.xcodeproj -scheme ApolloExtensionManager -configuration Release -derivedDataPath "$OUT" build
DEST="$ROOT/src-tauri/macos-embedded"
rm -rf "$DEST"
mkdir -p "$DEST/Library/SystemExtensions" "$DEST/MacOS"
cp -R "$OUT/Build/Products/Release/ApolloNetworkExtension.systemextension" "$DEST/Library/SystemExtensions/"
cp "$OUT/Build/Products/Release/ApolloExtensionManager" "$DEST/MacOS/"
echo "Native macOS components prepared under $DEST. The build owner must embed, sign nested components first, sign the app, notarize and verify on macOS."