# Changelog

## v2.0.0

### Added

- First-class **Network Intent** workspace.
- One desired network definition can target OpenWrt, `sw01`, `sw02`, or any subset.
- Per-switch uplink selection for cross-device VLAN transport.
- Intent translation into the existing OpenWrt VLAN and NETGEAR trunk generators rather than duplicate vendor syntax.
- Dependency-ordered switch preparation followed by OpenWrt routed activation.
- Reverse-order multi-device Revert.
- Device-labelled current-vs-desired intent diff using independent imported state for OpenWrt, `sw01`, and `sw02`.
- Network Intent visual summary and plan integration.
- `tests/intent.test.js` and v2.0 smoke coverage.

### Safety

- Missing per-device current state remains UNKNOWN and causes an explicit plan rollback gap.
- Gateway must belong to the requested subnet.
- Native switch VLAN/PVID is left unchanged by the cross-device trunk intent.
- Exact Revert is only claimed when all selected mutating targets have provable inverse operations.


## v1.9.0

### Added

- Intentionally disabled GS108Tv3 firmware-emulation GitHub Actions workflow.
- Manual-only `workflow_dispatch` trigger with a second repository-variable enablement gate.
- Dedicated self-hosted runner labels for Docker/QEMU/FirmAE experimentation.
- Runtime vendor-firmware download with HTTPS enforcement and SHA-256 verification.
- FirmAE setup wrapper using upstream Docker workflow (`docker-init.sh` / `docker-helper.py -ec`).
- `emulation/netgear-firmware/README.md` with enablement, runner, trust-boundary and future HIL guidance.
- Firmware CI structural/unit tests.
- Expanded TODO roadmap covering the remaining OpenWrt, NETGEAR, testing, HIL, Proxmox and product work.

### Safety

- No firmware image is stored in the repository.
- No push/PR/schedule trigger can start firmware emulation.
- The emulation job requires both `NETGEAR_FIRMWARE_CI_ENABLED=true` and explicit manual confirmation.
- The experimental job is restricted to a dedicated self-hosted runner.
- Emulation is not treated as proof of RTL8380 switching/physical-port behaviour.

## v1.8.0

### Added

- NETGEAR switch-pair / redundancy workspace.
- Pair profiles for `sw01` / `sw02` identity and management addresses.
- Mirrored desired NETGEAR changes targeting both switches from one task.
- Pair running-config import with memory-only state.
- Policy-aware drift statuses: DRIFT, WARNING, MATCH, IGNORED and UNKNOWN.
- Expected per-switch identity differences for management IP; optional system-name comparison.
- Per-port `mirror`, `independent/exception`, and `redundancy-ready` modes.
- Role/endpoint labels for each physical port.
- Redundancy-ready validation that requires equivalent L2/admin policy and flags LAG membership.
- Directional `sw01 -> sw02` / `sw02 -> sw01` remediation.
- Exact state-aware remediation Revert from complete imported target state.
- Destructive extra-VLAN removal behind an explicit Expert-mode opt-in.
- Device labels in Configuration Plan Apply/Revert sections.
- Dedicated redundancy unit tests and smoke scenarios.

### Safety

- Independent ports are never automatically remediated.
- Pair management IPs are not mirrored.
- Partial state cannot prove destructive absence.
- Cross-switch active/backup readiness explicitly warns on local LAG membership.

## v1.7.0

### v1.7 milestone

- Added Configuration Plan engine.
- Added dependency-ordered Apply runbooks.
- Added reverse-order Revert runbooks.
- Added aggregate multi-device risk/error/resource reporting.
- Added high-risk rollback-gap detection.
- Added plan UI with add/remove/preview/clear controls.

### v1.6 milestone

- Added OpenWrt `uci show` importer.
- Added NETGEAR `show running-config` subset importer.
- Added current-vs-desired resource diff.
- Added ADD/CHANGE/MATCH/UNKNOWN semantics.
- Added partial-import coverage safeguards.
- Imported configuration remains memory-only.

### v1.5 milestone

- Added NETGEAR port manager.
- Added description, admin state, speed and flow-control generation.
- Added LAG/LACP active/passive/static generation.
- Added state-aware switch rollback.
- Added read-only diagnostic bundles including LLDP/STP/MAC/ARP/cable/logging/tech-support helpers.

### v1.4 milestone

- Added named OpenWrt static routes.
- Added route tables/metrics and Expert route controls.
- Added DNAT port forwarding.
- Added selective MASQUERADE.
- Added SNAT.
- Added zone masquerading with current-state-aware rollback.

### Safety/testing

- Exact Revert is now a first-class plan invariant.
- Partial state cannot be used to prove absence.
- Secret fields and imported configs are not persisted.
- Expanded unit, integration/static and smoke regression coverage.

## v1.3.0

- Added dedicated Firewall builder.
- Added expanded DHCP/DNS builder.
- Introduced Apply/Revert output contract for exact additive changes.

## v1.2.0

- Added GitHub Actions testing and GitHub Pages deployment.
- Added Dependabot and AI-agent workflow documentation.

## v1.1.0

- Modularised the codebase.
- Added operating levels and change-risk model.
- Added Wireless including client/bridge isolation and dynamic RADIUS VLAN support.
