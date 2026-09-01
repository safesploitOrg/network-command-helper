#!/bin/sh
set -eu

require_command() {
    COMMAND_NAME="$1"
    if ! command -v "$COMMAND_NAME" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $COMMAND_NAME" >&2
        exit 1
    fi
}

require_value() {
    VARIABLE_NAME="$1"
    eval "VARIABLE_VALUE=\${$VARIABLE_NAME:-}"
    if [ -z "$VARIABLE_VALUE" ]; then
        echo "ERROR: required environment variable is empty: $VARIABLE_NAME" >&2
        exit 1
    fi
}

require_command git
require_command curl
require_command sha256sum
require_command docker
require_command python3

require_value NETGEAR_FIRMWARE_URL
require_value NETGEAR_FIRMWARE_SHA256

case "$NETGEAR_FIRMWARE_URL" in
    https://*) ;;
    *)
        echo "ERROR: NETGEAR_FIRMWARE_URL must use HTTPS." >&2
        exit 1
        ;;
esac

case "$NETGEAR_FIRMWARE_SHA256" in
    *[!0-9a-fA-F]*|'')
        echo "ERROR: NETGEAR_FIRMWARE_SHA256 must be a hexadecimal SHA-256 digest." >&2
        exit 1
        ;;
esac

if [ "${#NETGEAR_FIRMWARE_SHA256}" -ne 64 ]; then
    echo "ERROR: NETGEAR_FIRMWARE_SHA256 must contain exactly 64 hexadecimal characters." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker is installed but not usable by the runner account." >&2
    exit 1
fi

if [ "${FIRMAE_REF:-}" = "" ]; then
    echo "INFO: FIRMAE_REF is unset; setup will use the current upstream default branch (master)."
else
    echo "INFO: FirmAE ref requested: $FIRMAE_REF"
fi

cat <<'EOF'
INFO: Firmware emulation remains experimental.
INFO: Passing this preflight does not prove the RTL8380 switch ASIC can be emulated.
INFO: The firmware file will be downloaded at runtime and is never stored in this repository.
EOF
