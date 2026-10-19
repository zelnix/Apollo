#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sh "$ROOT/scripts/prepare-macos-source.sh"
cd "$ROOT"
yarn web:export
cargo tauri build --bundles app
APP="$ROOT/src-tauri/target/release/bundle/macos/Apollo.app"
[ -d "$APP" ] || { echo "Apollo.app was not produced" >&2; exit 3; }
mkdir -p "$APP/Contents/Library/SystemExtensions" "$APP/Contents/MacOS"
cp -R "$ROOT/src-tauri/macos-embedded/Library/SystemExtensions/ApolloNetworkExtension.systemextension" "$APP/Contents/Library/SystemExtensions/"
cp "$ROOT/src-tauri/macos-embedded/MacOS/ApolloExtensionManager" "$APP/Contents/MacOS/"
echo "Unsigned Package 6 source app prepared at $APP. Build owner signs nested components first, then the containing app."