# Network Command Helper

Network Command Helper is a static, browser-based network change planner and command generator for OpenWrt and NETGEAR switches.

The deployable website lives entirely under `public/`, so GitHub Pages or any basic static web server can publish that directory directly.

## Current release: v2.0.0

v2.0.0 is cumulative and includes the following completed milestones:

| Milestone | Status | Capability |
| --- | --- | --- |
| v1.4 | ✅ | OpenWrt Routing + NAT + port forwarding |
| v1.5 | ✅ | NETGEAR port manager + LACP + diagnostics |
| v1.6 | ✅ | Current-config import + desired-state diff |
| v1.7 | ✅ | Multi-step Configuration Plan engine |
| v1.8 | ✅ | NETGEAR switch-pair mirroring, drift policy, port exceptions and redundancy readiness |
| v1.9 | ✅ | Disabled-by-default GS108Tv3 firmware-emulation CI scaffold using FirmAE/Docker |
| v2.0 | ✅ | Cross-device Network Intent compiler: one desired VLAN/network expands to OpenWrt + sw01 + sw02 |

## Operating model

The UI has three levels:

- **Simple**: preset/task driven.
- **Advanced**: exposes normal network/security controls.
- **Expert**: exposes hardware-specific values and disruptive settings.

Generated commands are always previewed before use.


## Cross-device Network Intent compiler

v2.0 adds a first-class desired-network workflow above the individual device generators.

Define the network once:

```text
Name:       monitoring
VLAN:       120
Subnet:     172.18.120.0/24
Gateway:    172.18.120.254
Targets:    OpenWrt + sw01 + sw02
```

The intent compiler delegates to the existing tested vendor generators and produces a dependency-ordered Configuration Plan:

```text
Desired Network
      |
      +--> sw01: create/name VLAN + tag selected trunk
      +--> sw02: create/name VLAN + tag selected trunk
      `--> OpenWrt: switch VLAN + 802.1Q + bridge + L3 + DHCP + firewall
```

Switch preparation is emitted before the routed OpenWrt activation. Revert runs in reverse order, taking OpenWrt down before switch VLAN teardown.

The intent can target any subset of OpenWrt, `sw01`, and `sw02`. The two switch uplink ports are independently selectable, so the workflow does not assume the pair uses identical physical port numbers.

### State-aware intent diff and Revert

- OpenWrt desired resources are compared against the memory-only OpenWrt UCI import.
- `sw01` and `sw02` are independently compared against their switch-pair running-config imports.
- Diff output is device-labelled.
- Missing imported state is treated as unknown, not absence.
- Exact Revert is only claimed when every mutating target has a provably exact inverse.
- If one target lacks sufficient current state, the whole intent receives the existing high-risk `ROLLBACK_GAP` finding.

The compiler deliberately reuses the OpenWrt/NETGEAR generators rather than embedding vendor syntax in the intent engine.

## OpenWrt capabilities

### VLAN / Network

- `swconfig` VLAN definitions for the current GL.iNet-style design.
- 802.1Q devices and bridges.
- Static IPv4 interface/subnet/gateway configuration.
- DHCP scope generation.
- Firewall zone generation.
- Ordered CIDR deny/allow rules.
- WAN/LAN forwarding and DHCP/DNS/ICMP router exceptions.
- State-aware Revert when complete relevant UCI package state is imported.

### Firewall

- Named firewall4 traffic rules.
- INPUT/OUTPUT/FORWARD semantics through source/destination zone selection.
- Source/destination IPv4/CIDR.
- Source/destination ports and ranges.
- TCP, UDP, TCP+UDP, ICMP and all protocols.
- ACCEPT, REJECT and DROP.
- Named zone-forwarding sections.
- Collision-checked exact additive Revert.

### DHCP / DNS

- DHCP option 3 gateway advertisement.
- DHCP option 6 DNS advertisement.
- DHCP option 42 NTP advertisement.
- Named static leases.
- Global and conditional dnsmasq forwarding entries.
- Local `hostrecord` sections.
- Exact additive Revert using collision checks / exact `del_list` values.

### Wireless

- SSID/radio/network generation.
- WPA2 Personal, WPA3 Personal, WPA2/WPA3 mixed and WPA2 Enterprise modes.
- `isolate` client isolation.
- `bridge_isolate` bridge-wide wireless isolation.
- RADIUS-backed dynamic VLAN configuration.
- Dynamic VLAN modes disabled/enabled/required.
- State-aware Revert when `uci show wireless` state is imported.
- Wireless/RADIUS secrets are not persisted to localStorage.

### Routing

- Named IPv4 static routes.
- Interface, target, gateway and metric.
- Routing table selection.
- Preferred source, route type, MTU and on-link option in Expert mode.
- Unicast, blackhole, unreachable and prohibit route types.
- Exact additive Revert by collision-checking the named route section.
- Verification using UCI plus `ip route show table all` / `ip route get`.

### NAT / Port forwarding

- firewall4 DNAT redirects / port forwarding.
- Selective MASQUERADE for a source CIDR.
- SNAT to a specified IPv4 address.
- Zone masquerading.
- Named NAT/redirect sections with exact additive Revert.
- Existing zone `masq` changes only claim exact Revert when prior UCI state is imported.

## NETGEAR GS108Tv3 capabilities

The generator is based on the supplied NETGEAR Lite CLI Reference Manual and deliberately does not invent unsupported commands.

### VLAN / ports

- VLAN create/name.
- Hybrid/trunk VLAN membership.
- Access/native VLAN configuration.
- PVID handling.
- Tagged/untagged membership.
- Verification and startup-config save.

### Port manager

- Interface description.
- Administrative shutdown / no shutdown.
- 10/100/1000/auto speed selection.
- Flow control: off/auto/asymmetric/symmetric.
- Optional counter clear.
- State-aware configuration Revert using imported running config.
- Counter clear is correctly marked irreversible.

### LAG / LACP

- Member ranges, e.g. `g1-2`.
- Static aggregation.
- LACP active.
- LACP passive.
- `show lag` verification.
- State-aware member Revert when prior interface membership is imported.

### Diagnostics

Read-only bundles include combinations of:

- system/info/version/CPU/IP.
- interface status/counters.
- switchport/VLAN state.
- LAG.
- STP.
- LLDP neighbours/local-device/statistics.
- MAC table.
- ARP / route table.
- cable diagnostics.
- SSH/users/storm control.
- logs.
- ping.
- `show tech-support`.


## NETGEAR switch-pair / redundancy capabilities

v1.8 adds a first-class switch-pair abstraction for two independent GS108Tv3 switches. The pair is treated as two devices with one desired policy, not as a stack or MLAG chassis.

### Mirrored desired changes

NETGEAR tasks can target:

- standalone/current import;
- `sw01`;
- `sw02`;
- both switches as a mirrored pair.

Pair-targeted changes generate separate device-labelled runbook sections and use each switch's own imported state for Revert when available.

### Drift detection

Paste complete `show running-config` from both switches. The pair comparator classifies differences as:

```text
DRIFT     mirrored policy differs
WARNING   potentially unsafe pair condition
MATCH     values are equivalent
IGNORED   intentional/expected difference
UNKNOWN   import coverage is insufficient
```

Management IP is always treated as a deliberate per-switch identity difference. System name and port descriptions are ignored by default but can be enabled in mirror policy.

### Port policy

Each GS108Tv3 port can independently be marked:

- **Mirror**: normal pair drift/remediation applies.
- **Independent / exception**: differences are intentional and never automatically remediated.
- **Redundancy-ready**: same-numbered ports are expected to have equivalent L2/admin policy for future active/backup endpoint bonding. Local LAG membership is flagged because the two physical links should remain independent for cross-switch active/backup use.

The default profile mirrors `g8` as the router trunk and leaves `g1-g7` independent, matching a design where `sw02` ports may legitimately host different workloads until dual-NIC endpoints are introduced.

### Safe remediation

The pair can use `sw01 -> sw02` or `sw02 -> sw01` as the remediation authority. Remediation only touches enabled mirror-policy fields and non-exception ports.

Removal of extra VLANs is **disabled by default**. Expert mode can opt into destructive reconciliation after complete current-state imports.

## Experimental NETGEAR firmware-emulation CI

v1.9 adds an intentionally disabled GitHub Actions workflow for future GS108Tv3 stock-firmware emulation experiments.

The workflow is **manual-only** and the real emulation job is double-gated:

```text
workflow_dispatch confirmation = true
AND
NETGEAR_FIRMWARE_CI_ENABLED = true
```

The released repository does not set that variable, so the firmware-emulation job cannot run as delivered.

The experimental job is restricted to a labelled self-hosted runner and is designed to:

1. validate the runner/tooling;
2. download vendor firmware over HTTPS at runtime;
3. verify an operator-supplied SHA-256 digest;
4. clone/update FirmAE;
5. build FirmAE's Docker environment;
6. run FirmAE's documented `docker-helper.py -ec` emulation check.

Firmware images are never committed to this repository. This layer is **not** yet considered authoritative for RTL8380 switching behaviour, VLAN forwarding, LACP/STP hardware behaviour, or physical ports. Future hardware-in-the-loop testing remains the intended authoritative layer.

See `emulation/netgear-firmware/README.md`.

## Current-state import and diff

Current device state can be pasted into the browser:

### OpenWrt

```bash
uci show network
uci show firewall
uci show dhcp
uci show wireless
```

### NETGEAR

```text
show running-config
```

The importer creates an in-memory model used for:

- current-vs-desired diff;
- state-aware rollback;
- proving whether a value existed before the change;
- avoiding destructive assumptions from partial configuration.

Imported configuration is **memory-only** and is never persisted to localStorage.

### Partial-state safety

Absence is only treated as proof when the import has adequate coverage.

Examples:

- importing only `uci show network` cannot prove a firewall section did not exist;
- a partial NETGEAR interface capture cannot prove VLAN 45 did not exist;
- NETGEAR VLAN deletion on Revert requires a complete `show running-config` capture, recognised by the normal `! Model:` header.

## Configuration Plan engine

Individual generated tasks can be added to a plan.

The plan engine:

1. captures immutable command output for each task;
2. dependency-orders Apply steps;
3. aggregates risks/errors/resources;
4. generates a multi-device Apply runbook;
5. generates a reverse-order Revert runbook;
6. reports whether every mutating step has an exact Revert;
7. raises a high-risk `ROLLBACK_GAP` finding if exact rollback is incomplete.

Typical ordering:

```text
Switch VLAN/LAG changes
        ↓
OpenWrt VLAN/network
        ↓
Routing
        ↓
Firewall/NAT
        ↓
DHCP/DNS
        ↓
Wireless
        ↓
Diagnostics
```

Revert runs in the opposite direction.

A plan that spans more than one device is explicitly marked as a multi-device change and should be executed one management session at a time with verification between steps.

## Apply / Revert contract

Every mutating generator must explicitly answer: **can an exact inverse be proven?**

Supported patterns:

- **additive named section**: pre-flight collision check, create section, Revert deletes that exact section;
- **additive list value**: pre-flight duplicate check, add exact value, Revert removes exact value;
- **modify existing value**: import current state first, Apply new value, Revert restores imported prior value;
- **irreversible operation**: report it as non-exact and never claim complete rollback.

The tool never fabricates a previous PVID, route, firewall policy or other prior value.

## Change risk

Examples:

### Low

- create isolated additive objects;
- add tagged VLAN membership without changing PVID;
- read-only diagnostics.

### Medium

- static routing changes;
- network/wireless/firewall reloads;
- selective NAT;
- port enable/speed changes;
- multi-device plans.

### High

- native VLAN/PVID change;
- switch port shutdown;
- LAG membership change;
- broad router INPUT access;
- WAN port forwarding;
- blackhole/unreachable/prohibit routes;
- any plan with an incomplete exact Revert.

## Project layout

```text
network-command-helper-v2.0.0/
├── README.md
├── AGENTS.md
├── CHANGELOG.md
├── package.json
├── package-lock.json
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── unit-tests.yml
│       ├── pages.yml
│       └── netgear-firmware-emulation.yml
├── docs/
│   ├── ARCHITECTURE.md
│   └── TESTING.md
├── tests/
│   ├── core.test.js
│   ├── generators.test.js
│   ├── intent.test.js
│   ├── redundancy.test.js
│   ├── firmware-ci.test.js
│   ├── site.test.js
│   ├── smoke.js
│   └── helpers/load-nch.js
├── emulation/
│   └── netgear-firmware/
│       ├── README.md
│       ├── .gitignore
│       └── ci/
│           ├── preflight.sh
│           ├── download-firmware.sh
│           ├── setup-firmae.sh
│           └── run-emulation.sh
└── public/
    ├── .nojekyll
    ├── index.html
    └── assets/
        ├── css/app.css
        └── js/
            ├── core/
            │   ├── config.js
            │   ├── diff.js
            │   ├── import.js
            │   ├── intent.js
            │   ├── plan.js
            │   ├── redundancy.js
            │   ├── risk.js
            │   ├── rollback.js
            │   ├── state.js
            │   └── utils.js
            ├── generators/
            │   ├── netgear.js
            │   ├── openwrt-dhcp-dns.js
            │   ├── openwrt-firewall.js
            │   ├── openwrt-nat.js
            │   ├── openwrt-routing.js
            │   ├── openwrt-vlan.js
            │   └── openwrt-wireless.js
            ├── presets/openwrt.js
            └── app.js
```

## Local testing

```bash
npm ci
npm run ci
```

The project uses Node's built-in test runner and has no runtime or development npm dependencies.

## Static hosting

```bash
cd public
python3 -m http.server 8080
```

For GitHub Pages, configure **Settings → Pages → Build and deployment → Source → GitHub Actions**. The Pages workflow tests the project and uploads only `./public`.

## Roadmap / TODO

| Status | Priority | Module | Useful functionality |
| --- | --- | --- | --- |
| ✅ | ⭐⭐⭐⭐⭐ | VLANs | VLAN, interface, bridge, subnet |
| ✅ | ⭐⭐⭐⭐⭐ | Firewall | zones, CIDR allow/deny, ports, forwarding |
| ✅ | ⭐⭐⭐⭐⭐ | Wireless | SSID, radio, security, VLAN/network, isolation |
| ✅ | ⭐⭐⭐⭐⭐ | DHCP | scope, lease, gateway, DNS/NTP advertisement |
| ✅ | ⭐⭐⭐⭐ | Routing | static routes, gateways, metrics/tables |
| 🟡 | ⭐⭐⭐⭐ | DNS | forwarding/local records done; broader resolver/domain controls remain |
| ✅ | ⭐⭐⭐⭐ | NAT | masquerading, SNAT/DNAT |
| ✅ | ⭐⭐⭐ | Port forwarding | source-restricted WAN/zone → internal service |
| ❌ | ⭐⭐⭐ | IPv6 | RA, DHCPv6, zones |
| ❌ | ⭐⭐⭐ | WireGuard | interfaces, peers, routes/firewall |
| ❌ | ⭐⭐ | QoS/SQM | CAKE/fq_codel helper |
| ❌ | ⭐⭐ | Multi-WAN | mwan3 failover/load-balancing/PBR |
| ❌ | ⭐⭐ | Advanced Wi-Fi | 802.11r/k, BSS transition, channels/power |
| ❌ | ⭐ | obscure UCI/package features | only on demand |

### Product roadmap

#### Completed platform foundations

- ✅ NETGEAR port manager, LACP and diagnostics.
- ✅ current-state import and desired-state diff.
- ✅ Configuration Plan engine and reverse-order Revert.
- ✅ NETGEAR switch-pair mirroring and drift detection.
- ✅ expected-difference policy and per-port mirror/independent/redundancy-ready exceptions.
- ✅ state-aware pair remediation with destructive VLAN removal opt-in.
- ✅ disabled-by-default GS108Tv3 FirmAE/Docker CI scaffold.
- ✅ cross-device Network Intent compiler with per-device diff and reverse-order Revert.

#### Highest-priority remaining work

- 🔲 **OpenWrt DSA support** alongside the current `swconfig` path, including capability/profile detection.
- 🔲 **Device profiles/inventory** for concrete devices such as router, `sw01`, `sw02`, switch model/capabilities and port roles.
- ✅ **Cross-device VLAN intent compiler** creates coordinated OpenWrt + sw01 + sw02 plan steps from one desired network.
- 🔲 **Management-path lockout simulation** before applying PVID, management VLAN, gateway, bridge, zone or interface changes.
- 🔲 **Downloadable change artefacts**: Apply, Verify, Revert and Markdown change-plan/runbook files.
- 🔲 **Plan-wide diff view** rather than only current-task/pair-focused diff.
- 🔲 **Configuration catalogue export/import** for reusable desired-state networks and switch-pair policies.

#### OpenWrt networking backlog

- 🔲 DSA bridge-VLAN filtering, tagged/untagged ports and PVIDs.
- 🔲 richer interfaces: DHCP client, unmanaged, PPPoE, MTU/MAC/metric and multiple addresses.
- 🔲 richer firewall: logging, rate limits, source MAC, ICMP types, nft sets/ipsets and advanced ordering.
- 🔲 richer DHCP: reservations UI depth, DHCP classes/tags, PXE/TFTP and custom option codes.
- 🟡 DNS: resolver ordering, local/search domains, rebind/DNSSEC controls, cache/logging and optional encrypted-DNS integrations.
- 🔲 IPv6: prefixes, RA, SLAAC, DHCPv6, relay/NDP and IPv6 firewalling.
- 🔲 WireGuard: interfaces, peers, site-to-site/remote-access presets, routes, DNS and firewall.
- 🔲 SQM/QoS: CAKE/fq_codel, bandwidth/overhead and advanced queue controls.
- 🔲 Multi-WAN: mwan3 health checks, failover, weighted balance and policy routing.
- 🔲 Advanced Wi-Fi: 802.11r/k, BSS transition, PMF, channels, widths, power and radio tuning.

#### NETGEAR backlog

- 🔲 richer eight-port visual manager with clickable port/VLAN matrix.
- 🔲 management-security helper: SSH protocol/port, timeouts/session limits and user visibility.
- 🔲 storm-control builder and diagnostics.
- 🔲 port-mirroring builder for packet-capture/IDS workflows.
- 🔲 broader LLDP/STP visual diagnostics and topology mapping.
- 🔲 management VLAN / IPv4/IPv6 management helpers with high-risk lockout checks.
- 🔲 additional supported NETGEAR models through a formal device capability matrix.

#### Testing / emulation / hardware backlog

- ✅ FirmAE firmware-emulation CI scaffold exists and is intentionally disabled.
- 🔲 prove GS108Tv3 stock firmware extraction/boot under FirmAE.
- 🔲 determine the exact vendor firmware payload/file that FirmAE should receive.
- 🔲 pin a reviewed FirmAE commit after the first successful experiment.
- 🔲 establish emulated management reachability.
- 🔲 add read-only emulated Lite CLI smoke tests (`show version`, `show vlan`, `show interfaces`).
- 🔲 add disposable emulated configuration Apply/Revert tests if CLI state changes work.
- 🔲 upload emulation logs/results as CI artefacts.
- 🔲 add **physical GS108Tv3 hardware-in-the-loop CI** on dedicated test VLAN/ports.
- 🔲 HIL safety controls: reserved CI port/VLAN, pre-check, backup, Apply, Verify, Revert, verify-Revert, stop-on-rollback-failure.
- 🔲 deterministic NETGEAR CLI simulator/fixtures for fast PR tests independent of firmware/hardware.
- 🔲 browser-level Playwright tests when the dependency is justified.

#### Future platform/vendor expansion

- 🔲 Proxmox VLAN-aware bridge/VM/LXC network helper.
- 🔲 Proxmox native-VLAN/PVID validation and bridge diagnostics.
- 🔲 endpoint active-backup bonding helper for dual-homed redundancy-ready ports.
- 🔲 import more device-state formats and support additional switch/router vendors only with authoritative syntax sources.
- 🔲 command explanation/reference mode with provenance and risk metadata.

## References

- OpenWrt UCI: https://openwrt.org/docs/guide-user/base-system/uci
- OpenWrt static routes: https://openwrt.org/docs/guide-user/network/routing/routes_configuration
- OpenWrt firewall configuration: https://openwrt.org/docs/guide-user/firewall/firewall_configuration
- OpenWrt NAT examples: https://openwrt.org/docs/guide-user/firewall/fw3_configurations/fw3_nat
- OpenWrt DHCP/DNS: https://openwrt.org/docs/guide-user/base-system/dhcp_configuration
- OpenWrt wireless: https://openwrt.org/docs/guide-user/network/wifi/basic
- OpenWrt 802.1X dynamic VLAN: https://openwrt.org/docs/guide-user/network/wifi/wireless.security.8021x
- NETGEAR Lite CLI Reference Manual for GS108Tv3-family switches: `GS108Tv3-commands-Smart_Switches_CLI_Manual_EN.pdf` / NETGEAR support site.
