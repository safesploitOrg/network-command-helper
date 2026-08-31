const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.resolve(__dirname, "../public/assets/js");
const context = { console };
context.window = context;
vm.createContext(context);

[
    "core/config.js",
    "core/utils.js",
    "core/risk.js",
    "presets/openwrt.js",
    "generators/openwrt-vlan.js",
    "generators/openwrt-wireless.js",
    "generators/netgear.js"
].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
});

const NCH = context.NCH;
const defaults = NCH.config.defaults;
const presets = NCH.presets.openwrt;

function merge(base, extra) {
    return Object.assign({}, base, extra || {});
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const setup = NCH.generators.openwrtVlan.generate(
    merge(defaults.openwrtVlan, presets.get("setup").vlan)
);

const admins = NCH.generators.openwrtVlan.generate(
    merge(defaults.openwrtVlan, presets.get("wifi-admins").vlan)
);

const guestsVlan = NCH.generators.openwrtVlan.generate(
    merge(defaults.openwrtVlan, presets.get("wifi-guests").vlan)
);

const guestsWireless = NCH.generators.openwrtWireless.generate(
    merge(defaults.openwrtWireless, {
        ...presets.get("wifi-guests").wireless,
        wKey: "correcthorsebattery"
    })
);

const dynamicWireless = NCH.generators.openwrtWireless.generate(
    merge(defaults.openwrtWireless, {
        ...presets.get("enterprise-dynamic").wireless,
        wSsid: "Enterprise-Test",
        wRadiusServer: "172.16.5.22",
        wRadiusSecret: "test-secret"
    })
);

const netgear = NCH.generators.netgear.generate(defaults.netgear);

const setupText = setup.commands.join("\n");
const adminsText = admins.commands.join("\n");
const guestsText = guestsVlan.commands.join("\n");
const guestsWirelessText = guestsWireless.commands.join("\n");
const dynamicText = dynamicWireless.commands.join("\n");
const netgearText = netgear.commands.join("\n");

assert(setupText.includes("dest_ip='172.16.0.0/24'"), "Setup management deny missing");
assert(setupText.includes("dest_ip='172.16.0.0/16'"), "Setup internal allow missing");
assert(
    setupText.indexOf("dest_ip='172.16.0.0/24'") < setupText.indexOf("dest_ip='172.16.0.0/16'"),
    "Specific setup deny must be emitted before broad internal allow"
);

assert(adminsText.includes("input='ACCEPT'"), "Wi-Fi Admins INPUT ACCEPT missing");
assert(adminsText.includes("dest='lan'"), "Wi-Fi Admins LAN forwarding missing");
assert(NCH.risk.assess(admins.risks).level === "high", "Wi-Fi Admins should be high risk");

assert(guestsText.includes("input='REJECT'"), "Wi-Fi Guests INPUT REJECT missing");
assert(guestsText.includes("dest_port='67'"), "Wi-Fi Guests DHCP exception missing");
assert(guestsText.includes("dest_port='53'"), "Wi-Fi Guests DNS exception missing");

assert(guestsWirelessText.includes("isolate='1'"), "Guest client isolation missing");
assert(guestsWirelessText.includes("bridge_isolate='1'"), "Guest bridge isolation missing");

assert(dynamicText.includes("dynamic_vlan='1'"), "Dynamic VLAN setting missing");
assert(dynamicText.includes("delete wireless.default_radio1.network"), "Dynamic VLAN must remove static network binding");
assert(dynamicText.includes("vlan_tagged_interface='eth2'"), "Dynamic VLAN tagged interface missing");

assert(netgearText.includes("switchport hybrid allowed vlan add 10-12,45 tagged"), "NETGEAR tagged trunk membership missing");
assert(!netgearText.includes("switchport hybrid pvid 1"), "Default trunk must not rewrite native PVID");
assert(netgearText.includes("copy running-config startup-config"), "NETGEAR save command missing");

console.log("Network Command Helper smoke tests: PASS");
