const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pkg = require("../package.json");
const { ROOT, FILES, loadNCH } = require("./helpers/load-nch");

const PUBLIC = path.resolve(__dirname, "../public");
const INDEX = path.join(PUBLIC, "index.html");

test("all browser JavaScript files parse successfully", () => {
    const jsFiles = [];

    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".js")) {
                jsFiles.push(fullPath);
            }
        }
    }

    walk(ROOT);
    assert.ok(jsFiles.length >= FILES.length, "expected browser JavaScript files to be present");

    jsFiles.forEach((file) => {
        assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }));
    });
});

test("index.html only references local static assets that exist", () => {
    const html = fs.readFileSync(INDEX, "utf8");
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((ref) => !ref.startsWith("#") && !/^[a-z]+:/i.test(ref));

    assert.ok(refs.length > 0, "expected index.html to reference local assets");

    refs.forEach((ref) => {
        const clean = ref.split(/[?#]/)[0].replace(/^\//, "");
        assert.ok(fs.existsSync(path.join(PUBLIC, clean)), `missing public asset: ${ref}`);
    });
});

test("GitHub Pages marker exists and app version matches package version", () => {
    assert.ok(fs.existsSync(path.join(PUBLIC, ".nojekyll")), "public/.nojekyll is required for direct Pages publishing");
    const NCH = loadNCH();
    assert.equal(NCH.config.version, pkg.version);
});


test("v2.0 UI exposes network intent, routing, NAT, import/diff, plans, redundancy and Apply/Revert controls", () => {
    const html = fs.readFileSync(INDEX, "utf8");
    assert.match(html, /data-device="intent"/);
    assert.match(html, /id="intentWorkspace"/);
    assert.match(html, /id="iVlan"/);
    assert.match(html, /id="iTargetOpenwrt"/);
    assert.match(html, /id="iTargetSw01"/);
    assert.match(html, /id="iTargetSw02"/);
    assert.match(html, /data-openwrt-task="firewall"/);
    assert.match(html, /data-openwrt-task="dhcpdns"/);
    assert.match(html, /data-openwrt-task="routing"/);
    assert.match(html, /data-openwrt-task="nat"/);
    assert.match(html, /id="importConfig"/);
    assert.match(html, /id="diffList"/);
    assert.match(html, /id="planList"/);
    assert.match(html, /id="addToPlan"/);
    assert.match(html, /data-preview-mode="plan"/);
    assert.match(html, /data-output-mode="apply"/);
    assert.match(html, /data-output-mode="rollback"/);
    assert.match(html, /data-device="redundancy"/);
    assert.match(html, /id="rdSw1Config"/);
    assert.match(html, /id="rdSw2Config"/);
    assert.match(html, /id="pairDriftList"/);
    assert.match(html, /id="rdG8Mode"/);
    assert.match(html, /id="sTarget"/);
});

test("all direct app.js element ID references exist exactly once in index.html", () => {
    const html = fs.readFileSync(INDEX, "utf8");
    const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    const htmlIds = [...html.matchAll(/id=["']([^"']+)["']/g)].map((match) => match[1]);
    const appRefs = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map((match) => match[1]);
    const counts = new Map();
    htmlIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    assert.deepEqual(duplicates, []);
    [...new Set(appRefs)].forEach((id) => assert.equal(counts.get(id), 1, `app.js references missing/duplicate element #${id}`));
});

test("imported configuration and secret fields are documented as memory-only/non-persistent", () => {
    const stateSource = fs.readFileSync(path.join(ROOT, "core/state.js"), "utf8");
    const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    assert.match(stateSource, /NCH\.config\?\.secrets/);
    assert.match(appSource, /Imported configuration is never saved to localStorage/);
    assert.match(appSource, /plans are intentionally memory-only/);
    assert.match(appSource, /Pair running-configs are never saved to localStorage|Pair state is memory-only/);
});
