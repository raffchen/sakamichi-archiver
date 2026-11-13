#!/usr/bin/env bash
# Start the emulator with a writable system image, routed through mitmproxy.
# Assumes the proxy is listening on the host at 127.0.0.1:8080 (see README).
set -euo pipefail

AVD_NAME="${AVD_NAME:-mitm-test}"
PROXY_PORT="${PROXY_PORT:-8080}"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}}"
EMULATOR="$SDK/emulator/emulator"
command -v "$EMULATOR" >/dev/null 2>&1 || EMULATOR=emulator

# -writable-system : keeps /system writable so the injected CA cert persists
# -no-snapshot     : cold boot avoids stale state on first run
# -http-proxy      : route all emulator traffic through mitmproxy
exec "$EMULATOR" \
    -avd "$AVD_NAME" \
    -writable-system \
    -gpu swiftshader_indirect \
    -no-snapshot \
    -http-proxy "http://127.0.0.1:$PROXY_PORT"
