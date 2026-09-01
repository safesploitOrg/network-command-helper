#!/bin/sh
set -eu

: "${FIRMAE_HOME:?FIRMAE_HOME is required}"
: "${NETGEAR_FIRMWARE_PATH:?NETGEAR_FIRMWARE_PATH is required}"

FIRMAE_BRAND="${FIRMAE_BRAND:-netgear}"

if [ ! -x "$FIRMAE_HOME/docker-helper.py" ]; then
    echo "ERROR: FirmAE docker-helper.py not found or not executable." >&2
    exit 1
fi

if [ ! -s "$NETGEAR_FIRMWARE_PATH" ]; then
    echo "ERROR: verified firmware file is missing." >&2
    exit 1
fi

cat <<EOF
FirmAE emulation check
  brand:    $FIRMAE_BRAND
  firmware: $NETGEAR_FIRMWARE_PATH
  source:   $FIRMAE_HOME
EOF

(
    cd "$FIRMAE_HOME"
    ./docker-helper.py -ec "$FIRMAE_BRAND" "$NETGEAR_FIRMWARE_PATH"
)

cat <<'EOF'
FirmAE returned success for the emulation check.
NOTE: This does not yet prove that the GS108Tv3 Lite CLI is reachable or that
      RTL8380 switching/VLAN behaviour is faithfully emulated.
EOF
