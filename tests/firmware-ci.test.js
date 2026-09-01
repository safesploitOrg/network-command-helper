const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workflowPath = path.join(root, ".github/workflows/netgear-firmware-emulation.yml");
const emulationRoot = path.join(root, "emulation/netgear-firmware");
const workflow = fs.readFileSync(workflowPath, "utf8");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("firmware workflow is manual-only and double-gated", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /vars\.NETGEAR_FIRMWARE_CI_ENABLED == 'true'/);
  assert.match(workflow, /inputs\.confirm_firmware_emulation == true/);
});

test("firmware workflow requires a dedicated self-hosted runner", () => {
  assert.match(workflow, /- self-hosted/);
  assert.match(workflow, /- netgear-firmware/);
});

test("firmware workflow does not embed or commit a firmware URL", () => {
  assert.match(workflow, /vars\.NETGEAR_GS108TV3_FIRMWARE_URL/);
  assert.match(workflow, /vars\.NETGEAR_GS108TV3_FIRMWARE_SHA256/);
  assert.doesNotMatch(workflow, /downloads\.netgear|downloadcenter|GS108Tv3.*\.(zip|img|bin)/i);
});

test("FirmAE workflow follows the documented Docker emulation check", () => {
  assert.match(read("emulation/netgear-firmware/ci/run-emulation.sh"), /docker-helper\.py -ec/);
  assert.match(read("emulation/netgear-firmware/ci/setup-firmae.sh"), /docker-init\.sh/);
});

test("all firmware CI shell scripts pass sh syntax validation", () => {
  const scripts = fs.readdirSync(path.join(emulationRoot, "ci"))
    .filter((name) => name.endsWith(".sh"));

  assert.ok(scripts.length >= 4);

  for (const script of scripts) {
    execFileSync("sh", ["-n", path.join(emulationRoot, "ci", script)], { stdio: "pipe" });
  }
});

test("firmware images are not present in repository tree", () => {
  const forbidden = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(bin|img|chk|stk|trx|fw)$/i.test(entry.name)) {
        forbidden.push(path.relative(root, full));
      }
    }
  }

  walk(root);
  assert.deepEqual(forbidden, []);
});
