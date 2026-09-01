const test = require("node:test");
const assert = require("node:assert/strict");
const { loadNCH } = require("./helpers/load-nch");

const NCH = loadNCH();
const defaults = NCH.config.defaults;

const SW01 = `! Model: GS108Tv3
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
 description router-a
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 10,45 tagged
exit`;

const SW02 = `! Model: GS108Tv3
system name sw02
ip address 172.16.0.4 mask 255.255.0.0
ip default-gateway 172.16.0.1
management-vlan vlan 1
vlan 10
 name wifi-admins
exit
interface g1
 description unrelated-workload
 switchport hybrid pvid 4
 switchport hybrid allowed vlan add 4 untagged
exit
interface g8
 description router-b
 switchport hybrid pvid 1
 switchport hybrid allowed vlan add 10 tagged
exit`;

function pairStates(a = SW01, b = SW02) {
    return {
        sw01: NCH.importer.parseNetgear(a),
        sw02: NCH.importer.parseNetgear(b)
    };
}

function values(extra = {}) {
    return Object.assign({}, defaults.redundancy, extra);
}

test("redundancy defaults keep access ports independent but mirror g8 trunk", () => {
    const policy = NCH.redundancy.policyFromValues(defaults.redundancy);
    assert.equal(policy.ports.g1.mode, "exception");
    assert.equal(policy.ports.g7.mode, "exception");
    assert.equal(policy.ports.g8.mode, "mirror");
});

test("pair comparison ignores expected identity differences and independent port drift", () => {
    const comparison = NCH.redundancy.compare(pairStates(), values());
    assert.equal(comparison.available, true);
    assert.ok(comparison.items.some((item) => item.key === "systemName" && item.status === "ignored"));
    assert.ok(comparison.items.some((item) => item.key === "ipAddress" && item.status === "ignored"));
    assert.ok(comparison.items.some((item) => item.key === "g1.exception" && item.status === "ignored"));
    assert.ok(comparison.items.some((item) => item.key === "45.exists" && item.status === "drift"));
    assert.ok(comparison.items.some((item) => item.key === "g8.tagged" && item.status === "drift"));
});

test("changing a port from exception to mirror exposes its configuration drift", () => {
    const comparison = NCH.redundancy.compare(pairStates(), values({ rdG1Mode: "mirror" }));
    assert.ok(comparison.items.some((item) => item.key === "g1.pvid" && item.status === "drift"));
    assert.ok(comparison.items.some((item) => item.key === "g1.untagged" && item.status === "drift"));
});

test("redundancy-ready ports require equivalent L2 policy and no LAG membership", () => {
    const sw1 = `${SW01}\ninterface g2\n switchport hybrid pvid 83\n switchport hybrid allowed vlan add 83 untagged\n lag 1 mode active\nexit`;
    const sw2 = `${SW02}\ninterface g2\n switchport hybrid pvid 83\n switchport hybrid allowed vlan add 83 untagged\nexit`;
    const comparison = NCH.redundancy.compare(pairStates(sw1, sw2), values({ rdG2Mode: "redundancy", rdG2Role: "future-pve2" }));
    assert.ok(comparison.items.some((item) => item.key === "g2.pvid" && item.status === "match"));
    assert.ok(comparison.items.some((item) => item.key === "g2.lag" && item.status === "warning" && item.risk === "high"));
});

test("pair remediation synchronises mirrored VLAN/trunk drift but leaves exception ports untouched", () => {
    const result = NCH.redundancy.generateRemediation(pairStates(), values({ rdAuthority: "sw01" }));
    const apply = result.commands.join("\n");
    const revert = result.rollbackCommands.join("\n");
    assert.match(apply, /vlan 45/);
    assert.match(apply, /name setup/);
    assert.match(apply, /interface g8/);
    assert.match(apply, /allowed vlan add 45 tagged/);
    assert.doesNotMatch(apply, /interface g1/);
    assert.match(revert, /no vlan 45/);
    assert.match(revert, /allowed vlan remove 45/);
    assert.equal(result.rollbackExact, true);
});

test("pair remediation can reverse authority from sw02 to sw01", () => {
    const result = NCH.redundancy.generateRemediation(pairStates(), values({ rdAuthority: "sw02" }));
    assert.equal(result.meta.authority, "sw02");
    assert.equal(result.meta.target, "sw01");
    assert.match(result.commands.join("\n"), /sw02 -> sw01/);
});

test("extra target VLANs are reported but not removed unless destructive reconciliation is enabled", () => {
    const sw2 = `${SW02}\nvlan 120\n name monitoring\nexit`;
    const safe = NCH.redundancy.generateRemediation(pairStates(SW01, sw2), values({ rdAuthority: "sw01", rdAllowDestructive: false }));
    assert.doesNotMatch(safe.commands.join("\n"), /no vlan 120/);
    assert.ok(safe.risks.some((risk) => risk.code === "PAIR_EXTRA_VLAN"));

    const destructive = NCH.redundancy.generateRemediation(pairStates(SW01, sw2), values({ rdAuthority: "sw01", rdAllowDestructive: true }));
    assert.match(destructive.commands.join("\n"), /no vlan 120/);
    assert.ok(destructive.risks.some((risk) => risk.code === "PAIR_REMOVE_VLAN" && risk.level === "high"));
});

test("same management IP on both peers is a high-risk pair warning", () => {
    const sw2 = SW02.replace("172.16.0.4", "172.16.0.3");
    const comparison = NCH.redundancy.compare(pairStates(SW01, sw2), values());
    assert.ok(comparison.items.some((item) => item.key === "ipAddress" && item.status === "warning" && item.risk === "high"));
});

test("mirrored NETGEAR desired change produces separate sw01 and sw02 device runbook sections", () => {
    const netgearValues = Object.assign({}, defaults.netgear, { sTask: "trunk", sPort: "g8", sTagged: "10,45" });
    const result = NCH.redundancy.generateMirroredNetgear(netgearValues, pairStates(), values());
    const apply = result.commands.join("\n");
    assert.match(apply, /# DEVICE: sw01/);
    assert.match(apply, /# DEVICE: sw02/);
    assert.match(apply, /switchport hybrid allowed vlan add 10,45 tagged/);
    assert.ok(result.risks.some((risk) => risk.code === "PAIR_MIRROR_CHANGE"));
});

test("plan item device labels survive compile and trigger multi-device risk", () => {
    const a = NCH.plan.createItem({ commands: ["a"], rollbackCommands: ["ra"], rollbackExact: true, risks: [], errors: [], summary: [], resources: [], plan: { title: "A", platform: "netgear", task: "port", order: 10, mutating: true } }, { deviceName: "sw01" });
    const b = NCH.plan.createItem({ commands: ["b"], rollbackCommands: ["rb"], rollbackExact: true, risks: [], errors: [], summary: [], resources: [], plan: { title: "B", platform: "netgear", task: "port", order: 10, mutating: true } }, { deviceName: "sw02" });
    const plan = NCH.plan.compile([a, b]);
    assert.match(plan.commands.join("\n"), /# DEVICE: sw01/);
    assert.match(plan.commands.join("\n"), /# DEVICE: sw02/);
    assert.ok(plan.risks.some((risk) => risk.code === "MULTI_DEVICE_PLAN"));
});
