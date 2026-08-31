# Network Command Helper

Network Command Helper is a static, browser-based command generator for OpenWrt and NETGEAR switches.

The public site lives entirely under `public/`, so the directory can be hosted directly by a basic static web server.

## Current capabilities

### OpenWrt

- VLAN creation using the existing `swconfig` + UCI pattern.
- 802.1Q device and bridge generation.
- Static interface and DHCP generation.
- Firewall zones with default-deny policy.
- Ordered CIDR deny/allow rules.
- WAN forwarding.
- DHCP, DNS and ICMP input exceptions.
- Wireless SSID generation.
- WPA2 Personal, WPA3 Personal, WPA2/WPA3 mixed and WPA2 Enterprise options.
- Wireless client isolation (`isolate`).
- Bridge-wide wireless client isolation (`bridge_isolate`).
- Enterprise dynamic-VLAN generation for RADIUS-backed SSIDs.
- Explicit dynamic VLAN modes: disabled, enabled, required.
- Config commit/reload and verification commands.

### NETGEAR

- VLAN creation and naming.
- Hybrid/trunk port generation.
- Access-port generation.
- Native VLAN/PVID handling.
- Tagged VLAN lists and ranges.
- Verification commands.
- `copy running-config startup-config` save command.

## Operating levels

The UI uses three levels so the tool can grow without exposing every knob at once:

- **Simple** - task/preset driven, only asks for the values normally needed.
- **Advanced** - exposes network, firewall and wireless controls.
- **Expert** - exposes hardware-specific and dynamic-VLAN controls.

The generated configuration is always visible before it is run.

## Change risk

The UI scores the generated plan as Low, Medium or High risk.

Examples:

- Low: create a new VLAN, add a new isolated SSID, add a tagged VLAN to an existing trunk.
- Medium: create or broaden firewall forwarding, enable RADIUS dynamic VLANs, reload networking.
- High: change a native VLAN/PVID, allow router input broadly, alter management-facing connectivity.

The risk engine is advisory. It does not prove that a change is safe for a specific device.

## Project layout

```text
network-command-helper-v1.1.0/
├── README.md
├── tests/
│   └── smoke.js
├── docs/
│   └── ARCHITECTURE.md
└── public/
    ├── index.html
    └── assets/
        ├── css/
        │   └── app.css
        └── js/
            ├── core/
            │   ├── config.js
            │   ├── risk.js
            │   ├── state.js
            │   └── utils.js
            ├── generators/
            │   ├── netgear.js
            │   ├── openwrt-vlan.js
            │   └── openwrt-wireless.js
            ├── presets/
            │   └── openwrt.js
            └── app.js
```

See `docs/ARCHITECTURE.md` before extending the codebase.

Run the generator regression tests with:

```bash
node tests/smoke.js
```

## Hosting

The site is dependency-free.

For a quick local server:

```bash
cd public
python3 -m http.server 8080
```

Then browse to `http://localhost:8080/`.

Because the JavaScript files use classic deferred scripts rather than ES modules, the page can also be opened directly from disk with `file://` in most browsers.

## Roadmap / TODO

| Status | Priority | Module | Useful functionality |
| --- | --- | --- | --- |
| ✅ | ⭐⭐⭐⭐⭐ | VLANs | VLAN, interface, bridge, subnet |
| 🟡 | ⭐⭐⭐⭐⭐ | Firewall | zones, CIDR allow/deny, ports, forwarding; dedicated visual rule builder still TODO |
| ✅ | ⭐⭐⭐⭐⭐ | Wireless | SSID, radio, security, VLAN/network, isolation |
| ✅ | ⭐⭐⭐⭐⭐ | DHCP | scope and lease implemented; gateway/DNS option sets can expand later |
| ❌ | ⭐⭐⭐⭐ | Routing | static routes, gateways, metrics |
| ❌ | ⭐⭐⭐⭐ | DNS | DNS advertisement, forwarding, local domain |
| ❌ | ⭐⭐⭐⭐ | NAT | masquerading, SNAT/DNAT |
| ❌ | ⭐⭐⭐ | Port forwarding | WAN to internal service |
| ❌ | ⭐⭐⭐ | IPv6 | RA, DHCPv6, zones |
| ❌ | ⭐⭐⭐ | WireGuard | interfaces, peers, routes/firewall |
| ❌ | ⭐⭐ | QoS/SQM | later |
| ❌ | ⭐⭐ | Multi-WAN | later |
| ❌ | ⭐⭐ | Advanced Wi-Fi | 802.11r/k/v, channels, powers |
| ❌ | ⭐ | obscure UCI/package features | only on demand |

Additional product TODO:

- Configuration Plan that combines multiple generators and dependency-orders their output.
- Dedicated visual firewall rule builder.
- NETGEAR eight-port visual VLAN/PVID manager.
- Device profiles, e.g. `SWS-Router2` and individual switches.
- Cross-device generation, e.g. create VLAN on OpenWrt and add it tagged to the relevant switch trunk in one plan.
- Proxmox bridge/VLAN helper.
- Import existing `uci show` / switch configuration for comparison before generating changes.
- Diff mode: current state versus proposed state.
- Safer management-network detection and explicit lockout warnings.
- Download generated commands as `.sh` / `.txt` files.

## Wireless notes

OpenWrt distinguishes two useful wireless isolation controls:

- `isolate=1` isolates clients attached to the same Wi-Fi interface.
- `bridge_isolate=1` extends client isolation across Wi-Fi interfaces sharing the AP bridge, such as 2.4 GHz and 5 GHz BSSs for the same guest network.

For 802.1X dynamic VLANs, OpenWrt documents `dynamic_vlan` as a tri-state setting:

- `0` disabled
- `1` enabled
- `2` required

When dynamic VLANs are enabled, the generator intentionally removes/omits the normal `network` option from that `wifi-iface` because current OpenWrt guidance describes dynamic VLAN configuration that way.

## References

- OpenWrt UCI: https://openwrt.org/docs/techref/uci
- OpenWrt wireless configuration: https://openwrt.org/docs/guide-user/network/wifi/basic
- OpenWrt guest Wi-Fi extras / isolation: https://openwrt.org/docs/guide-user/network/wifi/guestwifi/extras
- OpenWrt Wi-Fi encryption: https://openwrt.org/docs/guide-user/network/wifi/encryption
- OpenWrt 802.1X dynamic VLANs: https://openwrt.org/docs/guide-user/network/wifi/wireless.security.8021x
- OpenWrt firewall: https://openwrt.org/docs/guide-user/firewall/firewall_configuration
- NETGEAR GS108Tv3 CLI manual: https://www.downloads.netgear.com/files/GDC/GS108Tv3/Smart_Switches_CLI_Manual_EN.pdf
