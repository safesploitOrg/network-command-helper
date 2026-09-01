# NETGEAR GS108Tv3 firmware emulation CI

## Status

**DISABLED / experimental.**

The workflow is intentionally not connected to `push`, `pull_request`, `schedule`, or `workflow_call`.
It can only be manually dispatched and the actual emulation job is further blocked unless the repository variable below is explicitly set:

```text
NETGEAR_FIRMWARE_CI_ENABLED=true
```

The manual confirmation checkbox must also be selected.

## Why it is disabled

The GS108Tv3 stock firmware is MIPS/Linux-based, but the switch depends on a Realtek RTL8380 switching ASIC. FirmAE/QEMU may emulate enough of the Linux userspace to test firmware startup or management interfaces, but it should **not** be assumed to reproduce the physical switching ASIC accurately.

The workflow is therefore scaffolding for a future experiment, not a current CI quality gate.

## Intended confidence level

If FirmAE can boot the firmware successfully, this layer may eventually validate:

- firmware extraction/boot;
- management service startup;
- Lite CLI parser availability;
- selected safe configuration commands;
- `show` command behaviour;
- command compatibility regression testing.

It must **not** be treated as authoritative proof of:

- actual packet forwarding;
- RTL8380 VLAN implementation;
- link negotiation;
- physical port behaviour;
- LACP/STP hardware behaviour.

Real hardware-in-the-loop remains the authoritative future layer for those behaviours.

## Required self-hosted runner

The emulation job targets these labels:

```text
self-hosted
linux
x64
netgear-firmware
```

The runner is expected to provide:

- Docker;
- Python 3;
- Git;
- curl;
- SHA-256 tooling;
- enough disk/RAM for FirmAE/QEMU;
- any kernel/network privileges required by FirmAE's Docker workflow.

FirmAE's upstream documentation says it was tested on Ubuntu 20.04 and provides a Docker workflow through `docker-init.sh` and `docker-helper.py`.

## Repository variables required before enabling

```text
NETGEAR_FIRMWARE_CI_ENABLED=true
NETGEAR_GS108TV3_FIRMWARE_URL=https://...official vendor firmware...
NETGEAR_GS108TV3_FIRMWARE_SHA256=<64-character expected digest>
FIRMAE_REF=<optional reviewed FirmAE ref; defaults to master>
```

Firmware is downloaded only at runtime and verified before it is passed to FirmAE.
Do **not** commit NETGEAR firmware images to this repository.

## Current workflow

```text
Manual workflow dispatch
        |
        v
Double enablement gate
        |
        v
Self-hosted runner preflight
        |
        v
Download vendor firmware over HTTPS
        |
        v
Verify SHA-256
        |
        v
Clone/update FirmAE
        |
        v
Build FirmAE Docker image
        |
        v
FirmAE docker-helper.py -ec netgear <firmware>
        |
        v
Emulation PASS / FAIL
```

## Future work before making this a CI gate

1. Prove that a GS108Tv3 firmware image is accepted/extracted by FirmAE.
2. Determine the correct firmware packaging level if the vendor ZIP contains multiple images/files.
3. Pin a reviewed FirmAE commit instead of tracking `master`.
4. Record expected boot/runtime signals for the GS108Tv3.
5. Identify how the emulated management interface becomes reachable.
6. Add read-only Lite CLI smoke tests (`show version`, `show vlan`, `show interfaces`).
7. Add disposable configuration tests only after Apply/Revert behaviour is proven.
8. Add CI log/result artefact upload.
9. Build a separate hardware-in-the-loop workflow for authoritative switch tests.

## Safety

Do not reuse the future hardware-in-the-loop runner credentials or network path in this emulator workflow.
Firmware emulation and physical-switch testing should remain separate trust boundaries.
