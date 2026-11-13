#!/usr/bin/env bash
# Install mitmproxy's CA cert into the emulator's SYSTEM trust store.
# Requires: emulator already running (started with -writable-system).
set -euo pipefail

# Stop Git Bash/MSYS from rewriting /system/... into a Windows path
export MSYS_NO_PATHCONV=1

AVD_NAME="${AVD_NAME:-mitm-test}"
MITM_DIR="${MITM_DIR:-$HOME/.mitmproxy}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Native Windows tools (openssl.exe) need Windows-style paths
command -v cygpath >/dev/null 2>&1 && WORK="$(cygpath -m "$WORK")"

CA_PEM="$MITM_DIR/mitmproxy-ca-cert.pem"
# Native Windows tools (openssl.exe) need a Windows-style path
command -v cygpath >/dev/null 2>&1 && CA_PEM="$(cygpath -m "$CA_PEM")"
[ -f "$CA_PEM" ] || {
    echo "No CA at $CA_PEM. Run 'mitmproxy' once to generate it."
    exit 1
}

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}}"
command -v adb >/dev/null 2>&1 || export PATH="$PATH:$SDK/platform-tools"
command -v adb >/dev/null 2>&1 || { echo "adb not found (on PATH or in $SDK/platform-tools)"; exit 1; }
adb wait-for-device

echo ">> Ensuring adbd is root"
adb root
sleep 2
adb wait-for-device

remount_phase() {
    adb root >/dev/null 2>&1
    sleep 2
    adb wait-for-device
    echo ">> Remounting /system as writable"
    adb remount
}

remount_phase

# First remount after disabling verity needs a reboot to activate the overlay
if adb remount 2>&1 | grep -qi "reboot"; then
    echo ">> Rebooting to activate writable system (one-time)"
    adb reboot
    adb wait-for-device
    for i in $(seq 1 60); do
        [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
        sleep 5
    done
    remount_phase
fi

echo ">> Converting cert to Android system-cert format"
# Android needs a single DER cert named <subject_hash_old>.0
openssl x509 -inform PEM -in "$CA_PEM" -out "$WORK/mitmproxy.crt"
HASH="$(openssl x509 -inform PEM -subject_hash_old -in "$WORK/mitmproxy.crt" | head -1)"
CERT_NAME="$HASH.0"
echo ">> Cert will be installed as $CERT_NAME"

echo ">> Pushing to /system/etc/security/cacerts/"
adb push "$WORK/mitmproxy.crt" "/system/etc/security/cacerts/$CERT_NAME"
adb shell chmod 644 "/system/etc/security/cacerts/$CERT_NAME"

API_LEVEL=$(adb shell getprop ro.build.version.sdk | tr -d '\r')

if [ "${API_LEVEL:-0}" -ge 34 ]; then
    # Android 14+: the real CA store lives in the read-only Conscrypt APEX
    # (/apex/com.android.conscrypt/cacerts). /system/etc/security/cacerts is
    # legacy and ignored. Overlay it with a tmpfs holding APEX certs + ours.
    echo ">> API $API_LEVEL detected: injecting into Conscrypt APEX store"
    adb shell rm -rf /data/local/tmp/apex-cacerts
    adb shell mkdir -p /data/local/tmp/apex-cacerts
    adb shell cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/apex-cacerts/
    adb push "$WORK/mitmproxy.crt" /data/local/tmp/apex-cacerts/$CERT_NAME

    adb shell "
        mount -t tmpfs tmpfs /apex/com.android.conscrypt/cacerts &&
        cp /data/local/tmp/apex-cacerts/* /apex/com.android.conscrypt/cacerts/ &&
        chown root:root /apex/com.android.conscrypt/cacerts/* &&
        chmod 644 /apex/com.android.conscrypt/cacerts/* &&
        chcon u:object_r:system_security_cacerts_file:s0 /apex/com.android.conscrypt/cacerts/*
    "
    adb shell rm -rf /data/local/tmp/apex-cacerts
fi

echo ">> Rebooting to apply (keeps writable system as long as you use -writable-system)"
adb reboot
adb wait-for-device

if [ "${API_LEVEL:-0}" -ge 34 ]; then
    # The tmpfs APEX overlay does NOT survive a reboot — re-apply after boot
    adb root >/dev/null 2>&1
    sleep 2
    adb wait-for-device
    adb shell rm -rf /data/local/tmp/apex-cacerts
    adb shell mkdir -p /data/local/tmp/apex-cacerts
    adb shell cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/apex-cacerts/
    adb push "$WORK/mitmproxy.crt" /data/local/tmp/apex-cacerts/$CERT_NAME >/dev/null
    adb shell "
        mount -t tmpfs tmpfs /apex/com.android.conscrypt/cacerts &&
        cp /data/local/tmp/apex-cacerts/* /apex/com.android.conscrypt/cacerts/ &&
        chown root:root /apex/com.android.conscrypt/cacerts/* &&
        chmod 644 /apex/com.android.conscrypt/cacerts/* &&
        chcon u:object_r:system_security_cacerts_file:s0 /apex/com.android.conscrypt/cacerts/*
    "
    adb shell rm -rf /data/local/tmp/apex-cacerts
    echo ">> APEX store re-applied after reboot"
fi

echo
echo "Done. Verify with:"
echo "  adb shell 'ls /apex/com.android.conscrypt/cacerts/ | grep $HASH'"
