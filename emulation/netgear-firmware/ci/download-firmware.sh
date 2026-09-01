#!/bin/sh
set -eu

WORK_DIR="${RUNNER_TEMP:-/tmp}/nch-netgear-firmware"
FIRMWARE_NAME="$(printf '%s' "$NETGEAR_FIRMWARE_URL" | sed 's/[?#].*$//' | awk -F/ '{print $NF}')"

case "$FIRMWARE_NAME" in
    ''|*[!A-Za-z0-9._-]*) FIRMWARE_NAME="gs108tv3-firmware.bin" ;;
esac

FIRMWARE_PATH="$WORK_DIR/$FIRMWARE_NAME"

mkdir -p "$WORK_DIR"
rm -f "$FIRMWARE_PATH"

curl \
    --fail \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    --retry 3 \
    --retry-delay 2 \
    --output "$FIRMWARE_PATH" \
    "$NETGEAR_FIRMWARE_URL"

printf '%s  %s\n' "$NETGEAR_FIRMWARE_SHA256" "$FIRMWARE_PATH" | sha256sum --check --strict

if [ ! -s "$FIRMWARE_PATH" ]; then
    echo "ERROR: downloaded firmware is empty." >&2
    exit 1
fi

export NETGEAR_FIRMWARE_PATH="$FIRMWARE_PATH"

if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'NETGEAR_FIRMWARE_PATH=%s\n' "$FIRMWARE_PATH" >> "$GITHUB_ENV"
fi

printf 'Firmware verified: %s\n' "$FIRMWARE_PATH"
