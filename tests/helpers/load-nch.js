const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../../public/assets/js");

const FILES = [
    "core/config.js",
    "core/utils.js",
    "core/import.js",
    "core/rollback.js",
    "core/diff.js",
    "core/plan.js",
    "core/redundancy.js",
    "core/state.js",
    "core/risk.js",
    "presets/openwrt.js",
    "generators/openwrt-vlan.js",
    "generators/openwrt-firewall.js",
    "generators/openwrt-dhcp-dns.js",
    "generators/openwrt-routing.js",
    "generators/openwrt-nat.js",
    "generators/openwrt-wireless.js",
    "generators/netgear.js",
    "core/intent.js"
];

function loadNCH() {
    const memoryStorage = new Map();
    const context = {
        console,
        Date,
        localStorage: {
            getItem(key) { return memoryStorage.has(key) ? memoryStorage.get(key) : null; },
            setItem(key, value) { memoryStorage.set(key, String(value)); },
            removeItem(key) { memoryStorage.delete(key); },
            clear() { memoryStorage.clear(); }
        }
    };
    context.window = context;
    vm.createContext(context);

    FILES.forEach((file) => {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        vm.runInContext(source, context, { filename: file });
    });

    return context.NCH;
}

module.exports = {
    ROOT,
    FILES,
    loadNCH
};
