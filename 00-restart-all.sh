#!/usr/bin/env bash
# Bring up the whole stack in one command: proxy -> emulator -> system cert.
# Safe to run at any time; kills any existing instances first.
#
#   ./00-restart-all.sh              # background, logs in logs/
#   MITMDUMP_ARGS="--set block_global=false" ./00-restart-all.sh
#
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}}"
AVD_NAME="${AVD_NAME:-mitm-test}"
PROXY_PORT="${PROXY_PORT:-8080}"

export PATH="$PATH:$SDK/platform-tools:$SDK/emulator"
export PYTHONUNBUFFERED=1   # live mitmdump log
export MSYS_NO_PATHCONV=1   # stop Git Bash mangling /system/... paths
command -v cygpath >/dev/null 2>&1 && [ -z "${JAVA_HOME:-}" ] && \
    export JAVA_HOME="$(cygpath -m 'C:/Program Files/Android/Android Studio/jbr' 2>/dev/null)" || true

log() { echo "[restart-all] $*"; }

# ---- 0. stop anything already running --------------------------------------
adb emu kill >/dev/null 2>&1 || true
# mitmdump.exe is a launcher that delegates to python.exe -- kill whatever
# process actually holds the proxy port, not just the launcher.
# Use cmd.exe so this works regardless of MSYS path conversion.
killpid()   { cmd /c "taskkill /F /PID $1"   >/dev/null 2>&1 || true; }
killname()  { cmd /c "taskkill /F /IM $1"    >/dev/null 2>&1 || true; }
listen_pids() {
    netstat -ano 2>/dev/null | awk -v p=":$1" '$2 ~ p"$" && $4 == "LISTENING" {print $NF}' | sort -u
}
for pid in $(listen_pids "$PROXY_PORT"); do killpid "$pid"; done
for pid in $(listen_pids "53"); do killpid "$pid"; done   # dns-strip-aaaa
killname mitmdump.exe
killname qemu-system-x86_64.exe
sleep 2
leftover=$(listen_pids "$PROXY_PORT")
[ -n "$leftover" ] && log "WARNING: port $PROXY_PORT still held by PID $leftover"

# ---- 0.5 start the AAAA-stripping DNS proxy ---------------------------------
# Host has no IPv6 route; strip AAAA so the guest never picks IPv6 addresses.
log "starting dns-strip-aaaa on :53 (log: logs/dns-strip.log)"
nohup python "$DIR/tools/dns-strip-aaaa.py" > "$DIR/logs/dns-strip.log" 2>&1 &
sleep 2

# ---- 1. start mitmdump ------------------------------------------------------
mkdir -p "$DIR/logs"
log "starting mitmdump on :$PROXY_PORT (log: logs/mitmdump.log)"
# mitmproxy (a Windows binary) needs a Windows-style script path, while the
# rest of the script relies on MSYS_NO_PATHCONV=1 — convert just this one
MITM_SCRIPT="$DIR/tools/api-capture.py"
command -v cygpath >/dev/null 2>&1 && MITM_SCRIPT="$(cygpath -m "$MITM_SCRIPT")"
nohup mitmdump --listen-port "$PROXY_PORT" \
    -s "$MITM_SCRIPT" ${MITMDUMP_ARGS:-} \
    > "$DIR/logs/mitmdump.log" 2>&1 &
MITM_PID=$!
sleep 3
kill -0 "$MITM_PID" 2>/dev/null || { log "ERROR: mitmdump failed to start"; exit 1; }

# ---- 2. start the emulator --------------------------------------------------
log "starting emulator $AVD_NAME (writable system, proxied)"
nohup "$SDK/emulator/emulator.exe" \
    -avd "$AVD_NAME" \
    -writable-system \
    -gpu swiftshader_indirect \
    -no-snapshot \
    -dns-server 127.0.0.1 \
    -http-proxy "http://127.0.0.1:$PROXY_PORT" \
    > "$DIR/logs/emulator.log" 2>&1 &
sleep 5

# ---- 3. wait for boot -------------------------------------------------------
log "waiting for device..."
adb wait-for-device
for i in $(seq 1 90); do
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 5
done
if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; then
    log "ERROR: emulator did not finish booting (see logs/emulator.log)"
    exit 1
fi
log "boot complete"

# ---- 4. (re-)apply the system CA cert --------------------------------------
# On API 34+ the Conscrypt APEX overlay doesn't survive reboots, and this
# script cold-boots the emulator every time, so always run the installer.
log "applying system CA cert..."
if ! bash "$DIR/02-install-cert.sh" > "$DIR/logs/cert-install.log" 2>&1; then
    log "ERROR: cert install failed (see logs/cert-install.log)"
    exit 1
fi
log "cert applied"

# Chrome on Android 14 uses its own root store and ignores our injected CA.
# Its command-line file needs the program name as the first token.
log "configuring Chrome to trust mitmproxy (ignore cert errors, disable QUIC)"
adb shell "printf 'chrome --ignore-certificate-errors --disable-quic' \
    > /data/local/tmp/chrome-command-line" 2>/dev/null || true
adb shell "chmod 644 /data/local/tmp/chrome-command-line; \
    am force-stop com.android.chrome" >/dev/null 2>&1 || true

# ---- done --------------------------------------------------------------------
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
echo
log "ALL UP:  mitmdump :$PROXY_PORT | emulator $AVD_NAME (API $API) | CA trusted"
log "logs:    $DIR/logs/  (use mitmweb instead of mitmdump for a web UI)"
