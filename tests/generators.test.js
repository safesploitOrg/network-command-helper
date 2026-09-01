const test = require("node:test");
const assert = require("node:assert/strict");
const { loadNCH } = require("./helpers/load-nch");

const NCH = loadNCH();
const defaults = NCH.config.defaults;
const presets = NCH.presets.openwrt;

function merge(base, extra) {
    return Object.assign({}, base, extra || {});
}

function commandText(result) {
    return result.commands.join("\n");
}

test("Setup VLAN emits the management /24 deny before the broad /16 allow", () => {
    const result = NCH.generators.openwrtVlan.generate(
        merge(defaults.openwrtVlan, presets.get("setup").vlan)
    );
    const text = commandText(result);

    assert.match(text, /dest_ip='172\.16\.0\.0\/24'/);
    assert.match(text, /dest_ip='172\.16\.0\.0\/16'/);
    assert.ok(
        text.indexOf("dest_ip='172.16.0.0/24'") < text.indexOf("dest_ip='172.16.0.0/16'"),
        "specific management deny must be emitted before broad internal allow"
    );
});

test("Wi-Fi Admins retains INPUT ACCEPT and LAN forwarding and is high risk", () => {
    const result = NCH.generators.openwrtVlan.generate(
        merge(defaults.openwrtVlan, presets.get("wifi-admins").vlan)
    );
    const text = commandText(result);

    assert.match(text, /input='ACCEPT'/);
    assert.match(text, /dest='lan'/);
    assert.equal(NCH.risk.assess(result.risks).level, "high");
});

test("Wi-Fi Guests retains default-deny input plus DHCP and DNS exceptions", () => {
    const result = NCH.generators.openwrtVlan.generate(
        merge(defaults.openwrtVlan, presets.get("wifi-guests").vlan)
    );
    const text = commandText(result);

    assert.match(text, /input='REJECT'/);
    assert.match(text, /dest_port='67'/);
    assert.match(text, /dest_port='53'/);
});

test("Wi-Fi Guests enables client and bridge isolation", () => {
    const result = NCH.generators.openwrtWireless.generate(
        merge(defaults.openwrtWireless, {
            ...presets.get("wifi-guests").wireless,
            wKey: "correcthorsebattery"
        })
    );
    const text = commandText(result);

    assert.match(text, /isolate='1'/);
    assert.match(text, /bridge_isolate='1'/);
    assert.equal(result.errors.length, 0);
});

test("Dynamic RADIUS VLAN mode removes the static network binding", () => {
    const result = NCH.generators.openwrtWireless.generate(
        merge(defaults.openwrtWireless, {
            ...presets.get("enterprise-dynamic").wireless,
            wSsid: "Enterprise-Test",
            wRadiusServer: "172.16.5.22",
            wRadiusSecret: "test-secret"
        })
    );
    const text = commandText(result);

    assert.match(text, /dynamic_vlan='1'/);
    assert.match(text, /delete wireless\.default_radio1\.network/);
    assert.match(text, /vlan_tagged_interface='eth2'/);
    assert.equal(result.errors.length, 0);
});

test("NETGEAR default trunk adds tagged VLANs without rewriting native VLAN 1", () => {
    const result = NCH.generators.netgear.generate(defaults.netgear);
    const text = commandText(result);

    assert.match(text, /switchport hybrid allowed vlan add 10-12,45 tagged/);
    assert.doesNotMatch(text, /switchport hybrid pvid 1/);
    assert.match(text, /copy running-config startup-config/);
});


test("Firewall traffic rule supports ports and has exact Revert", () => {
    const result = NCH.generators.openwrtFirewall.generate(merge(defaults.openwrtFirewall, {
        fSection: "nch_allow_guest_https",
        fName: "Allow Guest HTTPS",
        fSrcZone: "wifi_guests",
        fDestZone: "lan",
        fDestIp: "172.16.4.20",
        fDestPort: "443",
        fProto: "tcp",
        fTarget: "ACCEPT"
    }));
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /firewall\.nch_allow_guest_https\.dest_port='443'/);
    assert.match(text, /firewall\.nch_allow_guest_https\.proto='tcp'/);
    assert.match(text, /refusing to overwrite it so Revert remains exact/);
    assert.match(rollback, /uci -q delete firewall\.nch_allow_guest_https/);
    assert.equal(result.rollbackExact, true);
    assert.equal(result.errors.length, 0);
});

test("Firewall zone forwarding generates reversible forwarding section", () => {
    const result = NCH.generators.openwrtFirewall.generate(merge(defaults.openwrtFirewall, {
        fKind: "forwarding", fSection: "nch_setup_to_lan", fSrcZone: "setup", fDestZone: "lan",
        fSrcIp: "", fDestIp: "", fSrcPort: "", fDestPort: ""
    }));
    const text = commandText(result);
    assert.match(text, /firewall\.nch_setup_to_lan='forwarding'/);
    assert.match(text, /\.src='setup'/);
    assert.match(text, /\.dest='lan'/);
    assert.match(result.rollbackCommands.join("\n"), /delete firewall\.nch_setup_to_lan/);
    assert.equal(result.errors.length, 0);
});

test("DHCP pool options emit gateway DNS NTP and exact del_list Revert", () => {
    const result = NCH.generators.openwrtDhcpDns.generate(merge(defaults.openwrtDhcpDns, {
        dMode: "pool-options", dPool: "setup", dGateway: "172.18.45.254",
        dDnsServers: "172.16.5.22,1.1.1.1", dNtpServers: "172.16.0.10"
    }));
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /3,172\.18\.45\.254/);
    assert.match(text, /6,172\.16\.5\.22,1\.1\.1\.1/);
    assert.match(text, /42,172\.16\.0\.10/);
    assert.match(rollback, /del_list/);
    assert.equal(result.rollbackExact, true);
    assert.equal(result.errors.length, 0);
});

test("Static DHCP lease and local DNS host record are named and reversible", () => {
    const lease = NCH.generators.openwrtDhcpDns.generate(merge(defaults.openwrtDhcpDns, {
        dMode: "static-lease", dLeaseSection: "nch_ldap", dHostName: "ldap", dMac: "00:11:22:33:44:55", dLeaseIp: "172.18.45.20"
    }));
    assert.match(commandText(lease), /dhcp\.nch_ldap='host'/);
    assert.match(lease.rollbackCommands.join("\n"), /delete dhcp\.nch_ldap/);

    const record = NCH.generators.openwrtDhcpDns.generate(merge(defaults.openwrtDhcpDns, {
        dMode: "host-record", dRecordSection: "nch_ldap_dns", dRecordName: "ldap.safesploit.com", dRecordIp: "172.16.5.20"
    }));
    assert.match(commandText(record), /dhcp\.nch_ldap_dns='hostrecord'/);
    assert.match(record.rollbackCommands.join("\n"), /delete dhcp\.nch_ldap_dns/);
});

test("Conditional DNS forwarding adds and reverses the exact dnsmasq server entry", () => {
    const result = NCH.generators.openwrtDhcpDns.generate(merge(defaults.openwrtDhcpDns, {
        dMode: "dns-forward", dForwardDomain: "safesploit.com", dForwardServers: "172.16.5.22"
    }));
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /\/safesploit\.com\/172\.16\.5\.22/);
    assert.match(rollback, /del_list/);
    assert.match(rollback, /\/safesploit\.com\/172\.16\.5\.22/);
    assert.equal(result.errors.length, 0);
});

test("Static route generator creates named route with exact additive Revert", () => {
    const result = NCH.generators.openwrtRouting.generate(merge(defaults.openwrtRouting, {
        rtSection: "nch_setup_return",
        rtInterface: "lan",
        rtTarget: "172.18.45.0/24",
        rtGateway: "172.16.0.2",
        rtMetric: "10",
        rtTable: "main"
    }));
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /network\.nch_setup_return='route'/);
    assert.match(text, /target='172\.18\.45\.0\/24'/);
    assert.match(text, /gateway='172\.16\.0\.2'/);
    assert.match(text, /metric='10'/);
    assert.match(rollback, /delete network\.nch_setup_return/);
    assert.equal(result.rollbackExact, true);
    assert.equal(result.errors.length, 0);
});

test("Blackhole route is classified high risk", () => {
    const result = NCH.generators.openwrtRouting.generate(merge(defaults.openwrtRouting, {
        rtTarget: "10.10.0.0/16", rtGateway: "", rtType: "blackhole"
    }));
    assert.match(commandText(result), /type='blackhole'/);
    assert.equal(NCH.risk.assess(result.risks).level, "high");
});

test("Port forwarding creates firewall4 DNAT redirect with exact Revert", () => {
    const result = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
        nMode: "port-forward", nSection: "nch_https", nName: "HTTPS to web",
        nSrcZone: "wan", nSrcPort: "443", nDestZone: "lan", nDestIp: "172.16.4.20", nDestPort: "8443", nProto: "tcp"
    }));
    const text = commandText(result);
    assert.match(text, /firewall\.nch_https='redirect'/);
    assert.match(text, /src_dport='443'/);
    assert.match(text, /dest_ip='172\.16\.4\.20'/);
    assert.match(text, /target='DNAT'/);
    assert.match(result.rollbackCommands.join("\n"), /delete firewall\.nch_https/);
    assert.equal(result.rollbackExact, true);
    assert.equal(result.errors.length, 0);
});

test("Selective masquerade and SNAT use named firewall nat sections", () => {
    const masq = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
        nMode: "masquerade", nSection: "nch_setup_masq", nSrcZone: "lan", nSourceCidr: "172.18.45.0/24"
    }));
    assert.match(commandText(masq), /firewall\.nch_setup_masq='nat'/);
    assert.match(commandText(masq), /target='MASQUERADE'/);
    assert.match(commandText(masq), /src_ip='172\.18\.45\.0\/24'/);

    const snat = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
        nMode: "snat", nSection: "nch_setup_snat", nSrcZone: "lan", nSourceCidr: "172.18.45.0/24", nSnatIp: "172.16.0.2"
    }));
    assert.match(commandText(snat), /target='SNAT'/);
    assert.match(commandText(snat), /snat_ip='172\.16\.0\.2'/);
    assert.equal(snat.errors.length, 0);
});

test("Zone masquerade only claims exact Revert with imported current state", () => {
    const withoutState = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, { nMode: "zone-masq", nZoneSection: "wan" }));
    assert.equal(withoutState.rollbackExact, false);

    const state = NCH.importer.parseOpenWrt("firewall.wan='zone'\nfirewall.wan.name='wan'\nfirewall.wan.masq='0'");
    const withState = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, { nMode: "zone-masq", nZoneSection: "wan" }), { currentState: state });
    assert.equal(withState.rollbackExact, true);
    assert.match(withState.rollbackCommands.join("\n"), /firewall\.wan\.masq='0'/);
});

test("NETGEAR port manager restores imported description speed flow and admin state", () => {
    const currentState = NCH.importer.parseNetgear(`interface g4\n description old-server\n speed 100\n flowcontrol off\n shutdown\nexit`);
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "port", sPort: "g4", sPortDescription: "new server", sPortAdmin: "enabled", sPortSpeed: "1000", sPortFlow: "auto", sClearCounters: false
    }), { currentState });
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /description "new server"/);
    assert.match(text, /no shutdown/);
    assert.match(text, /speed 1000/);
    assert.match(rollback, /description old-server/);
    assert.match(rollback, /shutdown/);
    assert.match(rollback, /speed 100/);
    assert.match(rollback, /flowcontrol off/);
    assert.equal(result.rollbackExact, true);
});

test("Clearing NETGEAR interface counters is marked irreversible", () => {
    const currentState = NCH.importer.parseNetgear("interface g4\nexit");
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "port", sPort: "g4", sPortAdmin: "unchanged", sPortSpeed: "unchanged", sPortFlow: "unchanged", sPortDescription: "", sClearCounters: true
    }), { currentState });
    assert.match(commandText(result), /clear interfaces g4 counters/);
    assert.equal(result.rollbackExact, false);
});

test("NETGEAR LACP uses documented lag syntax and state-aware no-lag Revert", () => {
    const currentState = NCH.importer.parseNetgear("interface g1\nexit\ninterface g2\nexit");
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "lacp", sLagId: "1", sLagMembers: "g1-2", sLagMode: "active"
    }), { currentState });
    const text = commandText(result);
    const rollback = result.rollbackCommands.join("\n");
    assert.match(text, /interface range g1-2/);
    assert.match(text, /lag 1 mode active/);
    assert.match(rollback, /interface g1\nno lag/);
    assert.match(rollback, /interface g2\nno lag/);
    assert.equal(result.rollbackExact, true);
});

test("NETGEAR diagnostics are read-only and include useful troubleshooting commands", () => {
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "diagnostics", sPort: "g8", sDiagMode: "troubleshooting", sDiagTarget: "172.16.0.1"
    }));
    const text = commandText(result);
    assert.match(text, /show cable-diag interfaces g8/);
    assert.match(text, /show mac address-table/);
    assert.match(text, /show arp/);
    assert.match(text, /show ip route/);
    assert.match(text, /ping 172\.16\.0\.1 count 4/);
    assert.match(text, /show tech-support/);
    assert.equal(result.plan.mutating, false);
    assert.equal(result.rollbackExact, true);
});

test("NETGEAR VLAN rename from default state has explicit name Revert", () => {
    const currentState = NCH.importer.parseNetgear("vlan 45\nexit");
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "vlans", sTagged: "45", sNames: "45=setup"
    }), { currentState });
    assert.match(result.rollbackCommands.join("\n"), /vlan 45\nno name setup\nexit/);
    assert.equal(result.rollbackExact, true);
});

test("Partial OpenWrt imports do not produce unsafe exact VLAN rollback", () => {
    const partial = NCH.importer.parseOpenWrt("network.lan='interface'\nnetwork.lan.proto='static'");
    const result = NCH.generators.openwrtVlan.generate(
        merge(defaults.openwrtVlan, presets.get("setup").vlan),
        { currentState: partial }
    );
    assert.equal(result.rollbackExact, false);
    assert.equal(result.rollbackCommands.length, 0);
});

test("Partial NETGEAR imports do not infer missing VLANs are absent", () => {
    const partial = NCH.importer.parseNetgear("interface g8\n switchport hybrid pvid 1\nexit");
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "trunk", sPort: "g8", sTagged: "45", sNames: "45=setup", sNativeTouch: false
    }), { currentState: partial });
    const rollback = result.rollbackCommands.join("\n");
    assert.equal(result.rollbackExact, false);
    assert.doesNotMatch(rollback, /^no vlan 45$/m);
    assert.match(rollback, /absence is not proven/);
});

test("Full NETGEAR running-config import can safely revert a newly-created VLAN", () => {
    const full = NCH.importer.parseNetgear("! Model: GS108Tv3\ninterface g8\n switchport hybrid pvid 1\nexit");
    const result = NCH.generators.netgear.generate(merge(defaults.netgear, {
        sTask: "trunk", sPort: "g8", sTagged: "45", sNames: "45=setup", sNativeTouch: false
    }), { currentState: full });
    assert.equal(result.rollbackExact, true);
    assert.match(result.rollbackCommands.join("\n"), /^no vlan 45$/m);
});

test("Routing rejects numeric table IDs above the OpenWrt 0-65535 range", () => {
    const result = NCH.generators.openwrtRouting.generate(merge(defaults.openwrtRouting, { rtTable: "65536" }));
    assert.ok(result.errors.some((error) => error.includes("0 and 65535")));
});

test("Port-forward generator rejects non-port protocols", () => {
    const result = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, { nProto: "icmp" }));
    assert.ok(result.errors.some((error) => error.includes("TCP, UDP")));
});
