const { loadNCH } = require("./helpers/load-nch");

const NCH = loadNCH();
const defaults = NCH.config.defaults;
const presets = NCH.presets.openwrt;

function merge(base, extra) {
    return Object.assign({}, base, extra || {});
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function text(result) { return result.commands.join("\n"); }
function revert(result) { return result.rollbackCommands.join("\n"); }

// ---------------------------------------------------------------------------
// Existing v1.x regression scenarios
// ---------------------------------------------------------------------------
const setup = NCH.generators.openwrtVlan.generate(merge(defaults.openwrtVlan, presets.get("setup").vlan));
const admins = NCH.generators.openwrtVlan.generate(merge(defaults.openwrtVlan, presets.get("wifi-admins").vlan));
const guestsVlan = NCH.generators.openwrtVlan.generate(merge(defaults.openwrtVlan, presets.get("wifi-guests").vlan));
const guestsWireless = NCH.generators.openwrtWireless.generate(merge(defaults.openwrtWireless, {
    ...presets.get("wifi-guests").wireless,
    wKey: "correcthorsebattery"
}));
const dynamicWireless = NCH.generators.openwrtWireless.generate(merge(defaults.openwrtWireless, {
    ...presets.get("enterprise-dynamic").wireless,
    wSsid: "Enterprise-Test",
    wRadiusServer: "172.16.5.22",
    wRadiusSecret: "test-secret"
}));
const netgearTrunk = NCH.generators.netgear.generate(defaults.netgear);

assert(text(setup).includes("dest_ip='172.16.0.0/24'"), "Setup management deny missing");
assert(text(setup).includes("dest_ip='172.16.0.0/16'"), "Setup internal allow missing");
assert(text(setup).indexOf("dest_ip='172.16.0.0/24'") < text(setup).indexOf("dest_ip='172.16.0.0/16'"), "Specific setup deny must precede broad allow");
assert(text(admins).includes("input='ACCEPT'"), "Wi-Fi Admins INPUT ACCEPT missing");
assert(NCH.risk.assess(admins.risks).level === "high", "Wi-Fi Admins should remain high risk");
assert(text(guestsVlan).includes("dest_port='67'") && text(guestsVlan).includes("dest_port='53'"), "Guest DHCP/DNS exceptions missing");
assert(text(guestsWireless).includes("isolate='1'") && text(guestsWireless).includes("bridge_isolate='1'"), "Guest isolation missing");
assert(text(dynamicWireless).includes("dynamic_vlan='1'") && text(dynamicWireless).includes("delete wireless.default_radio1.network"), "Dynamic VLAN behavior regressed");
assert(text(netgearTrunk).includes("switchport hybrid allowed vlan add 10-12,45 tagged"), "NETGEAR trunk membership missing");
assert(!text(netgearTrunk).includes("switchport hybrid pvid 1"), "Default trunk must not rewrite native PVID");

// ---------------------------------------------------------------------------
// v1.4 Routing + NAT + port forwarding
// ---------------------------------------------------------------------------
const route = NCH.generators.openwrtRouting.generate(merge(defaults.openwrtRouting, {
    rtSection: "nch_setup_return",
    rtTarget: "172.18.45.0/24",
    rtGateway: "172.16.0.2"
}));
assert(text(route).includes("network.nch_setup_return='route'"), "Static route section missing");
assert(revert(route).includes("delete network.nch_setup_return"), "Static route exact Revert missing");

const forward = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
    nMode: "port-forward",
    nSection: "nch_https",
    nSrcPort: "443",
    nDestIp: "172.16.4.20",
    nDestPort: "8443"
}));
assert(text(forward).includes("target='DNAT'"), "DNAT target missing");
assert(text(forward).includes("dest_port='8443'"), "DNAT translated port missing");
assert(revert(forward).includes("delete firewall.nch_https"), "DNAT exact Revert missing");

const masq = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
    nMode: "masquerade",
    nSection: "nch_setup_masq",
    nSrcZone: "lan",
    nSourceCidr: "172.18.45.0/24"
}));
assert(text(masq).includes("target='MASQUERADE'"), "Selective MASQUERADE missing");

// ---------------------------------------------------------------------------
// v1.5 NETGEAR port manager + LACP + diagnostics
// ---------------------------------------------------------------------------
const netgearState = NCH.importer.parseNetgear(`! Model: GS108Tv3
vlan 1
 name default
exit
interface g1
 description old-a
exit
interface g2
 description old-b
exit
interface g8
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 1 untagged
exit`);

const portChange = NCH.generators.netgear.generate(merge(defaults.netgear, {
    sTask: "port", sPort: "g8", sPortDescription: "Router trunk", sPortSpeed: "1000", sPortFlow: "auto"
}), { currentState: netgearState });
assert(text(portChange).includes("description \"Router trunk\""), "NETGEAR port description missing");
assert(revert(portChange).includes("no description"), "NETGEAR port description Revert missing");
assert(portChange.rollbackExact === true, "NETGEAR port rollback should be exact with imported state");

const lag = NCH.generators.netgear.generate(merge(defaults.netgear, {
    sTask: "lacp", sLagId: "1", sLagMembers: "g1-2", sLagMode: "active"
}), { currentState: netgearState });
assert(text(lag).includes("interface range g1-2") && text(lag).includes("lag 1 mode active"), "LACP Apply missing");
assert(revert(lag).includes("interface g1\nno lag") && revert(lag).includes("interface g2\nno lag"), "LACP Revert missing");

const diag = NCH.generators.netgear.generate(merge(defaults.netgear, {
    sTask: "diagnostics", sPort: "g8", sDiagMode: "troubleshooting", sDiagTarget: "172.16.0.1"
}));
assert(text(diag).includes("show cable-diag interfaces g8"), "Cable diagnostic missing");
assert(text(diag).includes("show tech-support"), "Tech-support diagnostic missing");
assert(diag.plan.mutating === false, "Diagnostic bundle must be read-only");

// ---------------------------------------------------------------------------
// v1.6 Config import + diff
// ---------------------------------------------------------------------------
const openwrtState = NCH.importer.parseOpenWrt(`network.nch_setup_return='route'
network.nch_setup_return.interface='lan'
network.nch_setup_return.target='172.18.45.0/24'
network.nch_setup_return.gateway='172.16.0.9'
firewall.wan='zone'
firewall.wan.name='wan'
firewall.wan.masq='0'`);
const routeDiff = NCH.diff.compare(route.resources, openwrtState);
assert(routeDiff.counts.change >= 1, "Imported route diff should detect changed gateway");
assert(routeDiff.compatible === true, "OpenWrt import should be compatible with route resources");

const zoneMasq = NCH.generators.openwrtNat.generate(merge(defaults.openwrtNat, {
    nMode: "zone-masq", nZoneSection: "wan"
}), { currentState: openwrtState });
assert(zoneMasq.rollbackExact === true, "Zone masquerade should become exact with imported state");
assert(revert(zoneMasq).includes("firewall.wan.masq='0'"), "Zone masquerade prior state restore missing");

// ---------------------------------------------------------------------------
// v1.7 Configuration Plan engine
// ---------------------------------------------------------------------------
const plan = NCH.plan.compile([
    NCH.plan.createItem(lag),
    NCH.plan.createItem(route),
    NCH.plan.createItem(forward),
    NCH.plan.createItem(diag)
]);
const planApply = text(plan);
const planRevert = revert(plan);
assert(planApply.indexOf("NETGEAR lacp") < planApply.indexOf("OpenWrt route"), "Plan did not dependency-order NETGEAR LACP before route");
assert(planApply.indexOf("OpenWrt route") < planApply.indexOf("OpenWrt port forward"), "Plan did not order route before firewall/NAT");
assert(planRevert.indexOf("OpenWrt port forward") < planRevert.indexOf("OpenWrt route"), "Plan Revert is not reverse-ordered");
assert(plan.rollbackExact === true, "Plan should have exact Revert for all mutating smoke steps");
assert(plan.risks.some((risk) => risk.code === "MULTI_DEVICE_PLAN"), "Multi-device plan risk marker missing");

const unsafePlan = NCH.plan.compile([NCH.plan.createItem(setup)]);
assert(unsafePlan.rollbackExact === false, "VLAN without current-state import must not claim exact plan Revert");
assert(unsafePlan.risks.some((risk) => risk.code === "ROLLBACK_GAP"), "Unsafe plan must report rollback gap");

// ---------------------------------------------------------------------------
// v1.8 Switch-pair mirroring + drift + port exceptions/redundancy readiness
// ---------------------------------------------------------------------------
const sw01Pair = NCH.importer.parseNetgear(`! Model: GS108Tv3
system name sw01
ip address 172.16.0.3 mask 255.255.0.0
ip default-gateway 172.16.0.1
management-vlan vlan 1
vlan 10
 name wifi-admins
exit
vlan 45
 name setup
exit
interface g1
 description pve-primary
 switchport hybrid pvid 83
 switchport hybrid allowed vlan add 83 untagged
exit
interface g8
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 10,45 tagged
exit`);
const sw02Pair = NCH.importer.parseNetgear(`! Model: GS108Tv3
system name sw02
ip address 172.16.0.4 mask 255.255.0.0
ip default-gateway 172.16.0.1
management-vlan vlan 1
vlan 10
 name wifi-admins
exit
interface g1
 description unrelated-test-port
 switchport hybrid pvid 4
 switchport hybrid allowed vlan add 4 untagged
exit
interface g8
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 10 tagged
exit`);
const pairStates = { sw01: sw01Pair, sw02: sw02Pair };
const pairValues = merge(defaults.redundancy, { rdAuthority: "sw01" });
const pairDiff = NCH.redundancy.compare(pairStates, pairValues);
assert(pairDiff.items.some((item) => item.key === "g1.exception" && item.status === "ignored"), "Independent port exception should be ignored in pair drift");
assert(pairDiff.items.some((item) => item.key === "g8.tagged" && item.status === "drift"), "Mirrored g8 trunk drift should be detected");
assert(pairDiff.items.some((item) => item.key === "ipAddress" && item.status === "ignored"), "Unique switch management IPs should be expected differences");

const pairRemediation = NCH.redundancy.generateRemediation(pairStates, pairValues);
assert(text(pairRemediation).includes("vlan 45"), "Pair remediation should create missing VLAN 45");
assert(text(pairRemediation).includes("switchport hybrid allowed vlan add 45 tagged"), "Pair remediation should restore mirrored g8 tagged VLAN 45");
assert(!text(pairRemediation).includes("interface g1"), "Independent g1 must not be remediated");
assert(revert(pairRemediation).includes("no vlan 45"), "Pair remediation should include state-aware VLAN Revert");
assert(pairRemediation.rollbackExact === true, "Complete pair imports should permit exact remediation Revert");

const mirroredChange = NCH.redundancy.generateMirroredNetgear(merge(defaults.netgear, {
    sTask: "trunk", sPort: "g8", sTagged: "10,45"
}), pairStates, pairValues);
assert(text(mirroredChange).includes("# DEVICE: sw01") && text(mirroredChange).includes("# DEVICE: sw02"), "Mirrored desired change must produce separate switch device sections");
assert(mirroredChange.risks.some((risk) => risk.code === "PAIR_MIRROR_CHANGE"), "Mirrored pair change risk marker missing");

const redundancyReady = NCH.redundancy.compare(pairStates, merge(pairValues, { rdG1Mode: "redundancy", rdG1Role: "future-pve2" }));
assert(redundancyReady.items.some((item) => item.key === "g1.pvid" && item.status === "drift"), "Redundancy-ready port should require equivalent L2 policy");


// ---------------------------------------------------------------------------
// v2.0 Cross-device network intent compiler
// ---------------------------------------------------------------------------
const intentOpenwrtState = NCH.importer.parseOpenWrt(`network.lan='interface'
network.lan.proto='static'
network.lan.device='br-lan'
dhcp.lan='dhcp'
dhcp.lan.interface='lan'
firewall.lan='zone'
firewall.lan.name='lan'`);
const networkIntent = NCH.intent.generateNetwork(merge(defaults.networkIntent, {
    iName: "monitoring", iVlan: "120", iSubnet: "172.18.120.0/24", iGateway: "172.18.120.254",
    iTargetOpenwrt: true, iTargetSw01: true, iTargetSw02: true
}), { currentState: intentOpenwrtState, pairStates, pairValues });
assert(networkIntent.meta.intent === true && networkIntent.meta.count === 3, "Network intent should compile three target steps");
assert(text(networkIntent).includes("# DEVICE: sw01") && text(networkIntent).includes("# DEVICE: sw02"), "Network intent switch device sections missing");
assert(text(networkIntent).includes("# PLATFORM: openwrt") && text(networkIntent).includes("network.vlan120_switch='switch_vlan'"), "Network intent OpenWrt VLAN step missing");
assert(text(networkIntent).indexOf("# DEVICE: sw01") < text(networkIntent).indexOf("# PLATFORM: openwrt"), "Switch preparation should precede OpenWrt routed VLAN activation");
assert(revert(networkIntent).indexOf("Create routed VLAN 120 on OpenWrt") < revert(networkIntent).indexOf("Prepare VLAN 120 on sw01"), "Network intent Revert should run OpenWrt before switch teardown");
assert(networkIntent.rollbackExact === true, "Complete imported target state should permit exact network-intent Revert");
assert(networkIntent.intentDiff.counts.add > 0, "Network intent should expose per-device desired-state diff");

console.log("Network Command Helper v2.0 smoke tests: PASS");
