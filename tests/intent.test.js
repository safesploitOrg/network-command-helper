const test = require("node:test");
const assert = require("node:assert/strict");
const { loadNCH } = require("./helpers/load-nch");

const NCH = loadNCH();
const defaults = NCH.config.defaults;

const OPENWRT_BASE = `network.lan='interface'
network.lan.proto='static'
network.lan.device='br-lan'
network.lan.ipaddr='172.16.0.1'
network.lan.netmask='255.255.0.0'
dhcp.lan='dhcp'
dhcp.lan.interface='lan'
firewall.lan='zone'
firewall.lan.name='lan'
firewall.lan.input='ACCEPT'
firewall.lan.output='ACCEPT'
firewall.lan.forward='ACCEPT'`;

function switchConfig(name, ip) {
    return `! Model: GS108Tv3
system name ${name}
ip address ${ip} mask 255.255.0.0
ip default-gateway 172.16.0.1
management-vlan vlan 1
interface g8
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 10,11,12,45 tagged
exit`;
}

function context(withState = false) {
    return {
        currentState: withState ? NCH.importer.parseOpenWrt(OPENWRT_BASE) : null,
        pairStates: withState ? {
            sw01: NCH.importer.parseNetgear(switchConfig("sw01", "172.16.0.3")),
            sw02: NCH.importer.parseNetgear(switchConfig("sw02", "172.16.0.4"))
        } : { sw01: null, sw02: null },
        pairValues: defaults.redundancy
    };
}

function intent(extra = {}) {
    return Object.assign({}, defaults.networkIntent, extra);
}

test("network intent compiles one VLAN definition into sw01, sw02 and OpenWrt steps", () => {
    const result = NCH.intent.generateNetwork(intent(), context(false));
    const text = result.commands.join("\n");
    assert.equal(result.errors.length, 0);
    assert.equal(result.meta.intent, true);
    assert.equal(result.meta.count, 3);
    assert.match(text, /STEP 1: Prepare VLAN 120 on sw01/);
    assert.match(text, /STEP 2: Prepare VLAN 120 on sw02/);
    assert.match(text, /STEP 3: Create routed VLAN 120 on OpenWrt/);
    assert.match(text, /switchport hybrid allowed vlan add 120 tagged/);
    assert.match(text, /uci set network\.vlan120_switch='switch_vlan'/);
    assert.equal(result.rollbackExact, false);
    assert.ok(result.risks.some((risk) => risk.code === "ROLLBACK_GAP"));
});

test("network intent uses imported per-device state for exact reverse-order Revert", () => {
    const result = NCH.intent.generateNetwork(intent(), context(true));
    const revert = result.rollbackCommands.join("\n");
    assert.equal(result.errors.length, 0);
    assert.equal(result.rollbackExact, true);
    assert.match(revert, /REVERT STEP 1: original step 3 - Create routed VLAN 120 on OpenWrt/);
    assert.match(revert, /REVERT STEP 2: original step 2 - Prepare VLAN 120 on sw02/);
    assert.match(revert, /REVERT STEP 3: original step 1 - Prepare VLAN 120 on sw01/);
    assert.match(revert, /no vlan 120/);
    assert.match(revert, /uci -q delete network\.vlan120_switch/);
    assert.ok(result.intentDiff.counts.add > 0);
});

test("network intent can target a single switch without emitting router commands", () => {
    const result = NCH.intent.generateNetwork(intent({ iTargetOpenwrt: false, iTargetSw01: false, iTargetSw02: true }), context(true));
    const text = result.commands.join("\n");
    assert.equal(result.meta.count, 1);
    assert.match(text, /DEVICE: sw02/);
    assert.doesNotMatch(text, /PLATFORM: openwrt/);
    assert.doesNotMatch(text, /DEVICE: sw01/);
});

test("network intent rejects a gateway outside the requested subnet", () => {
    const result = NCH.intent.generateNetwork(intent({ iSubnet: "172.18.120.0/24", iGateway: "172.18.121.254" }), context(false));
    assert.ok(result.errors.some((error) => /Gateway must be inside/.test(error)));
    assert.equal(result.meta.count, 0);
});

test("intent compiler delegates vendor syntax instead of embedding CLI/UCI commands", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "../public/assets/js/core/intent.js"), "utf8");
    assert.doesNotMatch(source, /uci\s+set\s+/);
    assert.doesNotMatch(source, /switchport\s+hybrid\s+/);
    assert.match(source, /NCH\.generators\.openwrtVlan\.generate/);
    assert.match(source, /NCH\.generators\.netgear\.generate/);
});
