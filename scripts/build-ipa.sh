#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/build-ipa.sh [DEVELOPMENT_TEAM_ID]
# Or:    DEVELOPMENT_TEAM=ABC123DEFG ./scripts/build-ipa.sh
#
# DEVELOPMENT_TEAM_ID is the 10-character Apple Team ID from
# developer.apple.com/account → Membership → Team ID.
#
# One-time Xcode setup required before first run:
#   1. Open app/ios/SignalBridge.xcworkspace
#   2. Target → Signing & Capabilities → set Team to your Apple account
#   3. Let Xcode auto-create the provisioning profile
#   4. Product → Build once to confirm
#
# Output: build/ipa/SignalBridge.ipa
# Distribute this file — users install via Sideloadly with their own Apple ID.

TEAM_ID="${1:-${DEVELOPMENT_TEAM:-}}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
IOS_DIR="$APP_DIR/ios"
ARCHIVE_PATH="$REPO_ROOT/build/SignalBridge.xcarchive"
EXPORT_PATH="$REPO_ROOT/build/ipa"
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"

if [[ -z "$TEAM_ID" ]]; then
  echo "Error: DEVELOPMENT_TEAM is required."
  echo "Usage: $0 <TEAM_ID>"
  echo "   or: DEVELOPMENT_TEAM=<TEAM_ID> $0"
  exit 1
fi

# Ensure NODE_BINARY in .xcode.env.local points to a real node binary.
# The Xcode "Bundle React Native code and images" build phase sources this
# file to find node — a stale Cellar path after a brew upgrade breaks archive.
XCODE_ENV_LOCAL="$IOS_DIR/.xcode.env.local"
if [[ ! -x "$(grep -oE '/[^ ]+node' "$XCODE_ENV_LOCAL" 2>/dev/null | head -1)" ]]; then
  NODE_BIN="$(command -v node)"
  if [[ -z "$NODE_BIN" ]]; then
    echo "Error: node not found on PATH. Install Node.js and retry."
    exit 1
  fi
  echo "==> Updating NODE_BINARY in .xcode.env.local → $NODE_BIN"
  echo "export NODE_BINARY=$NODE_BIN" > "$XCODE_ENV_LOCAL"
fi

echo "==> Installing JS dependencies"
cd "$APP_DIR"
pnpm install --frozen-lockfile

echo "==> Installing CocoaPods"
cd "$IOS_DIR"
pod install

echo "==> Archiving (Release)"
xcodebuild \
  -workspace "$IOS_DIR/SignalBridge.xcworkspace" \
  -scheme SignalBridge \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -quiet \
  archive

echo "==> Exporting IPA"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID"

IPA="$EXPORT_PATH/SignalBridge.ipa"
echo ""
echo "✓ IPA ready: $IPA"
echo "  Size: $(du -sh "$IPA" | cut -f1)"
echo ""
echo "Distribute $IPA — users install via Sideloadly with their Apple ID."
