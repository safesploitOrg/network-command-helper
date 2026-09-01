# Testing and CI/CD

## Objective

Networking command generation is outage-sensitive. Tests protect both syntax and safety invariants, especially rollback claims and management-affecting changes.

The project deliberately uses Node's built-in `node:test` runner and currently has no npm dependencies.

## Local gate

```bash
npm ci
npm run ci
```

Equivalent individual commands:

```bash
npm test
npm run test:smoke
```

## Test layers

### Core unit tests — `tests/core.test.js`

Covers:

- IPv4/CIDR helpers;
- VLAN range parsing;
- risk precedence;
- OpenWrt import parsing;
- NETGEAR running-config parsing;
- UCI prior-state restoration;
- diff ADD/CHANGE/MATCH/UNKNOWN behaviour;
- plan dependency order;
- reverse rollback order;
- `ROLLBACK_GAP` and multi-device risk facts;
- secret scrubbing before browser persistence.

### Generator unit tests — `tests/generators.test.js`

Covers existing and new generators.

Security/operational invariants include:

- Setup `/24` management deny precedes broad `/16` allow.
- Wi-Fi Admins INPUT ACCEPT remains high risk.
- Wi-Fi Guests retains DHCP/DNS exceptions and both isolation controls.
- Dynamic RADIUS VLAN removes the static network binding.
- NETGEAR default trunk does not rewrite native VLAN/PVID.
- Firewall/DHCP/DNS exact additive Revert.
- Static route Apply/Revert.
- high-risk blackhole route classification.
- DNAT/port-forward syntax and Revert.
- selective MASQUERADE and SNAT.
- zone masquerade exactness only with imported prior state.
- NETGEAR port manager state restoration.
- irreversible counter-clear handling.
- LACP Apply and prior-member Revert.
- read-only diagnostic bundles.
- safe VLAN-name restoration.
- partial OpenWrt import cannot enable unsafe exact VLAN rollback.
- partial NETGEAR import cannot infer missing VLAN absence.
- full NETGEAR running config can prove newly-created VLAN removal.

### Redundancy unit tests — `tests/redundancy.test.js`

Covers:

- default `g1-g7` independent / `g8` mirror policy;
- expected identity differences;
- port exceptions;
- mirrored-port drift;
- redundancy-ready L2 equivalence and no-LAG warning;
- authority-directed remediation;
- exact state-aware pair Revert;
- destructive extra-VLAN removal remaining opt-in;
- duplicate management-IP warning;
- mirrored desired changes generating separate `sw01` / `sw02` device sections;
- device-labelled plan compilation and multi-device risk.

### Static-site integrity — `tests/site.test.js`

Covers:

- all browser JavaScript parses;
- all local HTML assets exist;
- application/package versions match;
- GitHub Pages `.nojekyll` exists;
- v2.0 UI surfaces Network Intent plus routing, NAT, import/diff, plan and switch-pair redundancy controls;
- every direct `app.js` element-ID reference exists exactly once;
- secrets/imported state persistence safeguards remain present.

### Smoke suite — `tests/smoke.js`

The smoke suite combines representative operational workflows rather than isolated functions.

It currently exercises:

1. Setup VLAN/firewall ordering.
2. Wi-Fi Admins and Guest security policy.
3. wireless isolation.
4. RADIUS dynamic VLAN behaviour.
5. default NETGEAR trunk safety.
6. static route + exact Revert.
7. DNAT port forward + exact Revert.
8. selective MASQUERADE.
9. imported NETGEAR state.
10. port manager + exact Revert.
11. LACP + member Revert.
12. diagnostic bundle.
13. OpenWrt import + route diff.
14. state-aware zone masquerade rollback.
15. multi-device Configuration Plan dependency ordering.
16. reverse-order plan Revert.
17. incomplete-roll-back detection for an unsafe VLAN plan.
18. pair drift with independent-port exception.
19. mirrored trunk drift remediation.
20. exact pair rollback from complete imports.
21. mirrored desired change targeting both switches.
22. redundancy-ready port validation.

## Rollback test requirements

Any feature advertising `rollbackExact=true` must have evidence in tests.

### Additive object

Assert:

1. Apply collision-checks the section/name.
2. Apply creates expected state.
3. Revert targets exactly that created state.

### Existing-state modification

Assert:

1. no imported state → exact Revert is unavailable;
2. partial state → absence is UNKNOWN, not assumed;
3. sufficient imported state → previous value is restored exactly.

### Irreversible operation

Assert `rollbackExact=false`, even if configuration values themselves can be restored.

## Import-parser rules

Parser tests should be based on realistic device output.

For OpenWrt, use `uci show` style lines.

For NETGEAR, use syntax documented by the supplied Lite CLI Reference Manual. Full-config tests should include the normal `! Model:` header so absence can be proven safely.

## Browser QA

The application is intentionally dependency-free, so DOM correctness is primarily protected with static-integrity tests.

A real browser smoke check is desirable when the execution environment supports Chromium reliably. The current container Chromium can fail to initialise because of its DBus/zygote environment; this is an environment limitation, not a substitute for unit tests.

If browser automation becomes important enough to justify a dependency, add Playwright as a separate test layer rather than replacing pure generator tests.

## GitHub Actions

### Unit tests

`.github/workflows/unit-tests.yml` runs on pushes, pull requests and manual dispatch, testing latest Node LTS and Node Current.

### GitHub Pages

`.github/workflows/pages.yml`:

```text
checkout
  -> Node LTS
  -> npm ci
  -> npm run ci
  -> configure Pages
  -> upload ./public
  -> deploy
```

A failing test gate blocks Pages deployment.

## Dependency / workflow freshness

- Actions are pinned to immutable release commit SHAs.
- Dependabot checks Actions and future npm dependencies.
- Standard-library functionality is preferred when practical.


## v2.0 Network Intent regression layer

`tests/intent.test.js` verifies the desired-network compiler separately from the vendor generators.

Required coverage includes:

- one network expands into `sw01`, `sw02` and OpenWrt steps;
- switch preparation precedes OpenWrt routed activation;
- Revert is reverse ordered;
- complete per-device imports permit exact Revert;
- absent imports create rollback gaps rather than unsafe deletion assumptions;
- any subset of target devices can be selected;
- gateway/subnet validation rejects impossible L3 intent;
- intent diff remains device-labelled.

The smoke suite also compiles a complete three-device intent using imported state and asserts exact rollback.

## Experimental firmware-emulation CI — disabled

`.github/workflows/netgear-firmware-emulation.yml` is intentionally manual-only and double-gated. It is not part of the normal PR, push or Pages test gate.

The emulation job requires:

```text
vars.NETGEAR_FIRMWARE_CI_ENABLED == 'true'
inputs.confirm_firmware_emulation == true
```

and runs only on a labelled self-hosted runner.

`tests/firmware-ci.test.js` verifies that:

- there are no push/PR/schedule triggers;
- both enablement gates are present;
- the workflow targets the dedicated self-hosted runner;
- firmware URL/hash are supplied through repository variables rather than embedded;
- FirmAE's Docker emulation command is present;
- all firmware-CI shell wrappers parse successfully;
- firmware image extensions are not present in the repository tree.

This tests the **safety of the disabled scaffold**, not GS108Tv3 emulation itself. Actual firmware boot/CLI tests remain TODO until the workflow is deliberately enabled and validated.
