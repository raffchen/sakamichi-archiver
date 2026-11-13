#!/usr/bin/env bash
# Create a rooted Android AVD with a google_apis (non-Play-Store) image.
# Google Play images have a read-only /system and can't take a system CA cert.
set -euo pipefail

API="${API:-34}"
AVD_NAME="${AVD_NAME:-mitm-test}"
IMG="system-images;android-${API};google_apis;x86_64"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}}"

# sdkmanager/avdmanager need Java; fall back to Android Studio's bundled JBR
if [ -z "${JAVA_HOME:-}" ]; then
    for jbr in "C:/Program Files/Android/Android Studio/jbr" \
               "/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
        [ -x "$jbr/bin/java" -o -x "$jbr/bin/java.exe" ] && export JAVA_HOME="$jbr" && break
    done
fi

# On Windows the tools are .bat wrappers
if ls "$SDK/cmdline-tools/latest/bin/avdmanager.bat" >/dev/null 2>&1; then
    AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager.bat"
    SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
else
    AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
    SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
fi

[ -f "$AVDMANAGER" ] || {
    echo "avdmanager not found at $AVDMANAGER"
    echo "Install Android cmdline-tools or set ANDROID_HOME."
    exit 1
}

echo ">> Installing system image: $IMG"
echo "y" | "$SDKMANAGER" "$IMG"

echo ">> Creating AVD: $AVD_NAME"
echo "no" | "$AVDMANAGER" create avd \
    -n "$AVD_NAME" \
    -k "$IMG" \
    -d pixel_6

echo
echo "Done. Start it with ./03-start-emulator.sh"
