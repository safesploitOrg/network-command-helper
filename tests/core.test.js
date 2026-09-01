const test = require("node:test");
const assert = require("node:assert/strict");
const { loadNCH } = require("./helpers/load-nch");

const NCH = loadNCH();

test("CIDR validation accepts valid IPv4 CIDRs and rejects invalid input", () => {
    assert.equal(NCH.utils.validCIDR("172.16.0.0/16"), true);
    assert.equal(NCH.utils.validCIDR("172.16.0.0/33"), false);
    assert.equal(NCH.utils.validCIDR("999.16.0.0/16"), false);
});

test("VLAN range parser expands bounded ranges and de-duplicates VLAN IDs", () => {
    assert.deepEqual(
        Array.from(NCH.utils.parseVlanList("10-12,11,45")),
        [10, 11, 12, 45]
    );
});

test("Risk assessment returns the highest risk and de-duplicates codes", () => {
    const result = NCH.risk.assess([
        { level: "low", code: "A", message: "Low" },
        { level: "high", code: "B", message: "High" },
        { level: "medium", code: "B", message: "Duplicate" }
    ]);

    assert.equal(result.level, "high");
    assert.equal(result.reasons.length, 2);
});

test("OpenWrt importer preserves named sections and repeated list values", () => {
    const state = NCH.importer.parseOpenWrt(`network.nch_route='route'\nnetwork.nch_route.interface='lan'\nnetwork.nch_route.target='172.18.45.0/24'\ndhcp.@dnsmasq[0]='dnsmasq'\ndhcp.@dnsmasq[0].server='/safesploit.com/172.16.5.22'\ndhcp.@dnsmasq[0].server='1.1.1.1'`);
    assert.equal(state.platform, "openwrt");
    assert.equal(state.packages.network.nch_route.options.interface, "lan");
    assert.deepEqual(Array.from(state.packages.dhcp["@dnsmasq[0]"].options.server), ["/safesploit.com/172.16.5.22", "1.1.1.1"]);
});

test("NETGEAR importer recognises interface state and LAG membership", () => {
    const state = NCH.importer.parseNetgear(`vlan 45\n name setup\nexit\ninterface g1\n description server-one\n speed 1000\n flowcontrol auto\n switchport hybrid pvid 45\n switchport hybrid allowed vlan add 45 untagged\n lag 1 mode active\nexit\ninterface LAG 1\n lag type lacp\nexit`);
    assert.equal(state.platform, "netgear");
    assert.equal(state.vlans[45].name, "setup");
    assert.equal(state.interfaces.g1.pvid, 45);
    assert.equal(state.interfaces.g1.lag, 1);
    assert.equal(state.lags[1].type, "lacp");
    assert.deepEqual(Array.from(state.lags[1].members), ["g1"]);
});

test("UCI rollback restores the imported prior section instead of guessing", () => {
    const state = NCH.importer.parseOpenWrt(`network.nch_route='route'\nnetwork.nch_route.interface='lan'\nnetwork.nch_route.target='10.0.0.0/24'\nnetwork.nch_route.metric='20'`);
    const lines = NCH.rollback.uciRestoreSection(state, "network", "nch_route");
    const text = Array.from(lines).join("\n");
    assert.match(text, /uci set network\.nch_route='route'/);
    assert.match(text, /target='10\.0\.0\.0\/24'/);
    assert.match(text, /metric='20'/);
});

test("Diff engine reports add, change and match against imported current state", () => {
    const state = NCH.importer.parseOpenWrt(`network.nch_route='route'\nnetwork.nch_route.interface='lan'\nnetwork.nch_route.target='10.0.0.0/24'`);
    const diff = NCH.diff.compare([{kind:"uci-section",platform:"openwrt",package:"network",section:"nch_route",type:"route",options:{interface:"lan",target:"10.0.1.0/24",metric:"10"}}], state);
    assert.equal(diff.compatible, true);
    assert.equal(diff.counts.change, 1);
    assert.equal(diff.counts.add, 1);
    assert.ok(diff.counts.match >= 1);
});

test("Configuration plan applies dependency order and reverts in reverse order", () => {
    const a = NCH.plan.createItem({commands:["apply-a"],rollbackCommands:["revert-a"],rollbackExact:true,risks:[],errors:[],summary:[],resources:[],plan:{title:"A",platform:"openwrt",task:"route",order:40,mutating:true}});
    const b = NCH.plan.createItem({commands:["apply-b"],rollbackCommands:["revert-b"],rollbackExact:true,risks:[],errors:[],summary:[],resources:[],plan:{title:"B",platform:"netgear",task:"vlan",order:10,mutating:true}});
    const plan = NCH.plan.compile([a,b]);
    const apply = plan.commands.join("\n");
    const revert = plan.rollbackCommands.join("\n");
    assert.ok(apply.indexOf("apply-b") < apply.indexOf("apply-a"));
    assert.ok(revert.indexOf("revert-a") < revert.indexOf("revert-b"));
    assert.equal(plan.rollbackExact, true);
    assert.ok(plan.risks.some((r) => r.code === "MULTI_DEVICE_PLAN"));
});

test("Configuration plan raises a rollback-gap risk for unsafe mutating steps", () => {
    const item = NCH.plan.createItem({commands:["change"],rollbackCommands:[],rollbackExact:false,risks:[],errors:[],summary:[],resources:[],plan:{title:"Unsafe",platform:"openwrt",task:"vlan",order:20,mutating:true}});
    const plan = NCH.plan.compile([item]);
    assert.equal(plan.rollbackExact, false);
    assert.ok(plan.risks.some((r) => r.code === "ROLLBACK_GAP" && r.level === "high"));
});

test("Persisted browser state scrubs Wi-Fi and RADIUS secrets", () => {
    const payload = { openwrtWireless: { wKey: "top-secret-psk", wRadiusSecret: "radius-secret", wSsid: "Guests" } };
    NCH.state.write(payload);
    const loaded = NCH.state.read();
    assert.equal(loaded.openwrtWireless.wKey, "");
    assert.equal(loaded.openwrtWireless.wRadiusSecret, "");
    assert.equal(loaded.openwrtWireless.wSsid, "Guests");
});
