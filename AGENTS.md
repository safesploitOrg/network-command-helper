# Agent workflow

This file defines the minimum contract for AI agents and automated contributors changing Network Command Helper.

## Read first

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/TESTING.md`
4. the owning generator/core module
5. its existing tests

## Architecture rules

- `public/` is the complete deployable static site.
- `app.js` orchestrates UI only; vendor syntax belongs in generators.
- Presets are data, not alternate generators.
- Do not couple OpenWrt syntax to NETGEAR syntax.
- Current imported device state stays memory-only.
- Do not persist secrets.
- Do not invent device commands from familiarity with another vendor.

## Generator change workflow

For every mutating feature:

1. Identify the owning generator.
2. Define desired-state `resources` for diff.
3. Define Apply commands.
4. Define the Revert model.
5. Define risk facts.
6. Define Configuration Plan order.
7. Add unit tests for Apply and Revert together.
8. Add/extend smoke coverage for operationally significant workflows.
9. Update README/TODO and architecture docs.
10. Run:

```bash
npm ci
npm run ci
```

Do not declare completion while tests fail.

## Exact Revert rules

`rollbackExact=true` is a security/operational claim and must be proven.

Allowed models:

- collision-checked additive named section;
- collision-checked additive list value;
- prior value restored from sufficiently complete imported current state;
- read-only task that makes no change.

Forbidden models:

- guessing an old PVID;
- assuming an unseen VLAN never existed;
- assuming a missing UCI package was imported and empty;
- restoring a guessed default when the current value is unknown;
- claiming counter/history restoration after destructive clear operations.

Partial imports must produce UNKNOWN/partial rollback rather than unsafe absence assumptions.

## Configuration Plan rules

Each result added to the plan freezes its generated commands and Revert state at that point.

A plan must:

- apply dependency order;
- Revert reverse dependency order;
- aggregate risk/error facts;
- raise a rollback-gap risk when any mutating step is not exact;
- identify multi-device plans;
- never imply that commands from different devices can be pasted into one shell/session.



## Cross-device Network Intent rules

- `core/intent.js` is an orchestration layer. Never put raw OpenWrt/NETGEAR command syntax there when an owning generator can produce it.
- A network intent must compile into normal `NCH.plan` items so Apply/Revert ordering and rollback-gap rules remain universal.
- Per-device current state must remain separate. OpenWrt state cannot prove anything about `sw01`/`sw02`, and one switch import cannot prove the other switch's state.
- Missing state is UNKNOWN, never absence.
- Switch transport should be prepared before activating the routed OpenWrt network; Revert should deactivate OpenWrt before removing transport.
- Every new intent target must add unit and smoke coverage for ordering, target selection, diff and Revert behaviour.
- Do not bypass switch-pair port exceptions or redundancy policy implicitly. If a future intent uses those policies, make the behaviour explicit in the UI and tests.

## Switch-pair / redundancy rules

- Treat a redundancy pair as two independent devices, never as a stack/MLAG chassis unless a future target platform explicitly supports that feature.
- Management IP inequality is expected. Do not "remediate" one peer onto the other's management IP.
- Respect per-port policy:
  - `mirror` may be compared/remediated;
  - `exception` must never be automatically changed by pair remediation;
  - `redundancy` expects equivalent L2/admin policy but independent links, and must flag LAG membership.
- Do not infer an intentionally independent port is drift.
- Destructive reconciliation (for example deleting target-only VLANs) must remain opt-in and requires complete target current state.
- Mirrored desired changes must generate distinct device-labelled Apply/Revert sections so each peer can preserve its own previous state.
- Add redundancy tests whenever pair normalisation, policy, remediation or device targeting changes.

## NETGEAR rule

Use the supplied GS108Tv3-family Lite CLI Reference Manual as the syntax authority for implemented switch commands.

Examples currently supported and documented there include:

- `interface` / `interface range`;
- `description`;
- `speed`;
- `flowcontrol`;
- `shutdown` / `no shutdown`;
- hybrid VLAN/PVID commands;
- `lag <id> mode {static|active|passive}` / `no lag`;
- `show` diagnostics.

If a requested command is not supported by the target manual/model, do not fabricate it.

## OpenWrt rule

Use current OpenWrt documentation for UCI/netifd/firewall4 semantics.

The current VLAN module intentionally supports the existing `swconfig` design. Add DSA as an explicit capability path rather than silently translating/swapping the current implementation.

## Test requirements

At minimum, a new generator/feature needs:

- normal valid case;
- invalid input case;
- relevant risk assertion;
- Revert assertion;
- partial-state safety assertion when imported state affects rollback;
- security-sensitive ordering assertion when order matters.

Preserve existing regression tests unless behaviour is intentionally redesigned and documented.

## CI/CD rules

- Pull requests must pass tests.
- Pages deploys only after the full test gate.
- Actions should remain immutable-SHA pinned.
- Keep Dependabot enabled.
- Avoid new npm dependencies when Node/browser standard APIs are sufficient.

## Firmware-emulation CI rules

The GS108Tv3 FirmAE workflow is experimental and intentionally disabled. Agents must preserve these safeguards unless the user explicitly requests enablement:

- no `push`, `pull_request`, `schedule`, or `workflow_call` trigger;
- require `NETGEAR_FIRMWARE_CI_ENABLED=true`;
- require explicit manual workflow confirmation;
- use a dedicated labelled self-hosted runner;
- never commit/download firmware into the repository tree;
- require HTTPS plus expected SHA-256 verification before emulation;
- keep firmware emulation separate from physical hardware-in-the-loop credentials/networking;
- never treat FirmAE/QEMU success as proof of RTL8380 switching ASIC behaviour.

FirmAE currently defaults to its upstream `master` only while this workflow is disabled/experimental. Before enabling it as a real quality gate, resolve the current upstream revision and pin a reviewed commit.

Any change to this workflow must run the normal repository tests, including `tests/firmware-ci.test.js`.
