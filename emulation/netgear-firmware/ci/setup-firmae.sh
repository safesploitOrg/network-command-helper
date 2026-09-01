#!/bin/sh
set -eu

FIRMAE_HOME="${FIRMAE_HOME:-${RUNNER_TEMP:-/tmp}/FirmAE}"
FIRMAE_REF="${FIRMAE_REF:-master}"

if [ -d "$FIRMAE_HOME/.git" ]; then
    echo "INFO: reusing existing FirmAE checkout at $FIRMAE_HOME"
    git -C "$FIRMAE_HOME" fetch --tags --prune origin
else
    rm -rf "$FIRMAE_HOME"
    git clone --recursive https://github.com/pr0v3rbs/FirmAE.git "$FIRMAE_HOME"
fi

# Update submodules after selecting the requested ref. Using master by default
# intentionally follows current upstream while this experimental workflow is
# disabled. Before production enablement, prefer pinning a reviewed commit.
git -C "$FIRMAE_HOME" checkout "$FIRMAE_REF"
git -C "$FIRMAE_HOME" submodule update --init --recursive

if [ -x "$FIRMAE_HOME/download.sh" ]; then
    (
        cd "$FIRMAE_HOME"
        ./download.sh
    )
fi

if [ ! -x "$FIRMAE_HOME/docker-init.sh" ]; then
    echo "ERROR: FirmAE docker-init.sh not found or not executable." >&2
    exit 1
fi

(
    cd "$FIRMAE_HOME"
    ./docker-init.sh
)

export FIRMAE_HOME
if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'FIRMAE_HOME=%s\n' "$FIRMAE_HOME" >> "$GITHUB_ENV"
fi

printf 'FirmAE prepared at: %s\n' "$FIRMAE_HOME"
