window.NCH = window.NCH || {};

NCH.redundancy = (() => {
    const PORTS = Array.from({ length: 8 }, (_, index) => `g${index + 1}`);

    function defaultInterface() {
        return {
            description: "",
            pvid: 1,
            tagged: [],
            untagged: [1],
            speed: "auto 10/100/1000",
            flowcontrol: "off",
            shutdown: false,
            lag: null,
            lagMode: ""
        };
    }

    function normaliseInterface(state, port) {
        const current = state?.interfaces?.[port];
        if (!current) return state?.coverage?.full ? defaultInterface() : null;
        const merged = { ...defaultInterface(), ...current };
        merged.tagged = NCH.utils.unique([...(current.tagged || [])]).sort((a, b) => a - b);
        merged.untagged = NCH.utils.unique([...(current.untagged || [])]);
        if (!merged.untagged.length && Number(merged.pvid) === 1) merged.untagged = [1];
        merged.untagged.sort((a, b) => a - b);
        return merged;
    }

    function normaliseVlan(state, vlan) {
        if (state?.vlans?.[vlan]) return { exists: true, name: state.vlans[vlan].name || (Number(vlan) === 1 ? "default" : "") };
        if (Number(vlan) === 1 && state?.coverage?.full) return { exists: true, name: "default" };
        return { exists: false, name: "" };
    }

    function valuesEqual(left, right) {
        if (Array.isArray(left) || Array.isArray(right)) {
            const a = [...(left || [])].map(String).sort();
            const b = [...(right || [])].map(String).sort();
            return a.length === b.length && a.every((value, index) => value === b[index]);
        }
        return String(left ?? "") === String(right ?? "");
    }

    function portMode(values, port) {
        const mode = values[`rd${port.toUpperCase()}Mode`];
        return ["mirror", "exception", "redundancy"].includes(mode) ? mode : "exception";
    }

    function portRole(values, port) {
        return String(values[`rd${port.toUpperCase()}Role`] || "").trim();
    }

    function policyFromValues(values = {}) {
        return {
            vlanDefinitions: values.rdMirrorVlans !== false,
            vlanNames: values.rdMirrorVlanNames !== false,
            managementVlan: values.rdMirrorMgmtVlan !== false,
            netmask: values.rdMirrorNetmask !== false,
            defaultGateway: values.rdMirrorGateway !== false,
            systemName: Boolean(values.rdMirrorSystemName),
            portPvid: values.rdMirrorPortPvid !== false,
            tagged: values.rdMirrorTagged !== false,
            untagged: values.rdMirrorUntagged !== false,
            admin: values.rdMirrorAdmin !== false,
            speed: values.rdMirrorSpeed !== false,
            flowcontrol: values.rdMirrorFlow !== false,
            lag: values.rdMirrorLag !== false,
            description: Boolean(values.rdMirrorDescriptions),
            allowDestructive: Boolean(values.rdAllowDestructive),
            ports: Object.fromEntries(PORTS.map((port) => [port, { mode: portMode(values, port), role: portRole(values, port) }]))
        };
    }

    function entry(status, scope, key, label, left, right, detail = "", risk = "low") {
        return { status, scope, key, label, left: String(left ?? ""), right: String(right ?? ""), detail, risk };
    }

    function compareField(items, enabled, scope, key, label, left, right, ignoredLabel = "Policy ignores this difference", risk = "medium") {
        if (valuesEqual(left, right)) {
            items.push(entry("match", scope, key, label, formatValue(left), formatValue(right)));
            return;
        }
        if (!enabled) {
            items.push(entry("ignored", scope, key, label, formatValue(left), formatValue(right), ignoredLabel));
            return;
        }
        items.push(entry("drift", scope, key, label, formatValue(left), formatValue(right), "Mirrored value differs", risk));
    }

    function formatValue(value) {
        if (Array.isArray(value)) return value.length ? value.join(",") : "none";
        if (typeof value === "boolean") return value ? "enabled" : "disabled";
        if (value === null || value === undefined || value === "") return "unset";
        return String(value);
    }

    function compare(states, values = {}) {
        const left = states?.sw01;
        const right = states?.sw02;
        const policy = policyFromValues(values);
        const items = [];
        const warnings = [];

        if (!left || !right) {
            return {
                available: false,
                items,
                warnings: ["Import both NETGEAR running configurations before comparing the redundancy pair."],
                counts: { drift: 0, match: 0, ignored: 0, unknown: 1 },
                policy,
                message: "Both switch configurations are required."
            };
        }
        if (left.platform !== "netgear" || right.platform !== "netgear") {
            return {
                available: false,
                items,
                warnings: ["Redundancy comparison currently supports NETGEAR running-config imports only."],
                counts: { drift: 0, match: 0, ignored: 0, unknown: 1 },
                policy,
                message: "Incompatible imported state."
            };
        }

        // Identity fields are expected to differ by default. Each peer can still be validated against its declared profile identity.
        const expectedSw1Name = String(values.rdSw1Name || "").trim();
        const expectedSw2Name = String(values.rdSw2Name || "").trim();
        const expectedSw1Ip = String(values.rdSw1Mgmt || "").trim();
        const expectedSw2Ip = String(values.rdSw2Mgmt || "").trim();
        if (expectedSw1Name && left.global?.systemName && left.global.systemName !== expectedSw1Name) items.push(entry("warning", "profile", "sw01.systemName", "Switch 1 profile name", left.global.systemName, expectedSw1Name, "Imported system name does not match the pair profile.", "medium"));
        if (expectedSw2Name && right.global?.systemName && right.global.systemName !== expectedSw2Name) items.push(entry("warning", "profile", "sw02.systemName", "Switch 2 profile name", right.global.systemName, expectedSw2Name, "Imported system name does not match the pair profile.", "medium"));
        if (expectedSw1Ip && left.global?.ipAddress && left.global.ipAddress !== expectedSw1Ip) items.push(entry("warning", "profile", "sw01.ipAddress", "Switch 1 management IP", left.global.ipAddress, expectedSw1Ip, "Imported management IP does not match the pair profile.", "high"));
        if (expectedSw2Ip && right.global?.ipAddress && right.global.ipAddress !== expectedSw2Ip) items.push(entry("warning", "profile", "sw02.ipAddress", "Switch 2 management IP", right.global.ipAddress, expectedSw2Ip, "Imported management IP does not match the pair profile.", "high"));

        compareField(items, policy.systemName, "global", "systemName", "System name", left.global?.systemName, right.global?.systemName, "Expected per-switch identity difference");
        if (valuesEqual(left.global?.ipAddress, right.global?.ipAddress)) {
            items.push(entry("warning", "global", "ipAddress", "Management IP", left.global?.ipAddress, right.global?.ipAddress, "Redundancy peers should normally have unique management IP addresses.", "high"));
        } else {
            items.push(entry("ignored", "global", "ipAddress", "Management IP", left.global?.ipAddress, right.global?.ipAddress, "Expected per-switch identity difference"));
        }
        compareField(items, policy.netmask, "global", "netmask", "Management netmask", left.global?.netmask, right.global?.netmask);
        compareField(items, policy.defaultGateway, "global", "defaultGateway", "Default gateway", left.global?.defaultGateway, right.global?.defaultGateway);
        compareField(items, policy.managementVlan, "global", "managementVlan", "Management VLAN", left.global?.managementVlan ?? 1, right.global?.managementVlan ?? 1, "Policy ignores management VLAN", "high");

        const vlanIds = NCH.utils.unique([
            1,
            ...Object.keys(left.vlans || {}).map(Number),
            ...Object.keys(right.vlans || {}).map(Number)
        ]).sort((a, b) => a - b);

        vlanIds.forEach((vlan) => {
            const a = normaliseVlan(left, vlan);
            const b = normaliseVlan(right, vlan);
            compareField(items, policy.vlanDefinitions, "vlan", `${vlan}.exists`, `VLAN ${vlan} definition`, a.exists, b.exists, "VLAN definition comparison disabled", "high");
            if (a.exists && b.exists) compareField(items, policy.vlanNames, "vlan", `${vlan}.name`, `VLAN ${vlan} name`, a.name || "default", b.name || "default", "VLAN name comparison disabled");
        });

        PORTS.forEach((port) => {
            const portPolicy = policy.ports[port];
            const a = normaliseInterface(left, port);
            const b = normaliseInterface(right, port);
            const role = portPolicy.role ? ` · ${portPolicy.role}` : "";

            if (portPolicy.mode === "exception") {
                items.push(entry("ignored", "port", `${port}.exception`, `${port} independent/exception${role}`, a ? "configured" : "not in import", b ? "configured" : "not in import", "Port differences intentionally excluded from pair drift."));
                return;
            }

            if (!a || !b) {
                items.push(entry("unknown", "port", `${port}.coverage`, `${port} state${role}`, a ? "known" : "unknown", b ? "known" : "unknown", "Import complete running-config from both switches to compare this port."));
                return;
            }

            const redundancy = portPolicy.mode === "redundancy";
            const prefix = redundancy ? `${port} redundancy-ready${role}` : `${port}${role}`;
            compareField(items, policy.portPvid, "port", `${port}.pvid`, `${prefix} PVID`, a.pvid, b.pvid, "PVID comparison disabled", "high");
            compareField(items, policy.tagged, "port", `${port}.tagged`, `${prefix} tagged VLANs`, a.tagged, b.tagged, "Tagged VLAN comparison disabled", "high");
            compareField(items, policy.untagged, "port", `${port}.untagged`, `${prefix} untagged VLANs`, a.untagged, b.untagged, "Untagged VLAN comparison disabled", "high");
            compareField(items, policy.admin, "port", `${port}.shutdown`, `${prefix} admin state`, a.shutdown, b.shutdown, "Admin-state comparison disabled", "high");
            compareField(items, policy.speed, "port", `${port}.speed`, `${prefix} speed`, a.speed, b.speed, "Speed comparison disabled");
            compareField(items, policy.flowcontrol, "port", `${port}.flowcontrol`, `${prefix} flow control`, a.flowcontrol, b.flowcontrol, "Flow-control comparison disabled");
            if (policy.description && !redundancy) compareField(items, true, "port", `${port}.description`, `${prefix} description`, a.description, b.description);
            else if (!valuesEqual(a.description, b.description)) items.push(entry("ignored", "port", `${port}.description`, `${prefix} description`, a.description, b.description, redundancy ? "Descriptions may differ while L2 redundancy policy remains equivalent." : "Port description comparison disabled"));

            if (redundancy) {
                if (a.lag || b.lag) {
                    items.push(entry("warning", "port", `${port}.lag`, `${prefix} LAG membership`, a.lag ? `LAG ${a.lag}` : "none", b.lag ? `LAG ${b.lag}` : "none", "Cross-switch active/backup readiness expects independent physical links, not one LACP bundle spanning both switches.", "high"));
                } else {
                    items.push(entry("match", "port", `${port}.lag`, `${prefix} LAG membership`, "none", "none", "Independent links suitable for active/backup endpoint bonding."));
                }
            } else {
                compareField(items, policy.lag, "port", `${port}.lag`, `${prefix} LAG membership`, a.lag ? `${a.lag}:${a.lagMode}` : "none", b.lag ? `${b.lag}:${b.lagMode}` : "none", "LAG comparison disabled", "high");
            }
        });

        if (!left.coverage?.full || !right.coverage?.full) warnings.push("At least one switch import is partial. Missing VLANs/interfaces are treated cautiously and may appear UNKNOWN rather than absent.");

        const counts = { drift: 0, match: 0, ignored: 0, unknown: 0, warning: 0 };
        items.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
        return {
            available: true,
            items,
            warnings,
            counts,
            policy,
            message: `${counts.drift} drift · ${counts.warning} warning · ${counts.match} match · ${counts.ignored} ignored · ${counts.unknown} unknown`
        };
    }

    function quoteDescription(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        return /\s/.test(text) ? `"${text.replace(/"/g, "")}"` : text.replace(/"/g, "");
    }

    function addVlanMembershipDiff(lines, desired, current, membership) {
        const wanted = new Set(desired || []);
        const have = new Set(current || []);
        [...wanted].filter((vlan) => !have.has(vlan)).sort((a, b) => a - b).forEach((vlan) => lines.push(`switchport hybrid allowed vlan add ${vlan} ${membership}`));
        [...have].filter((vlan) => !wanted.has(vlan)).sort((a, b) => a - b).forEach((vlan) => lines.push(`switchport hybrid allowed vlan remove ${vlan}`));
    }

    function restorePort(lines, port, original, desired) {
        lines.push(`interface ${port}`);
        if (original.description !== desired.description) lines.push(original.description ? `description ${quoteDescription(original.description)}` : "no description");
        if (original.pvid !== desired.pvid) lines.push(`switchport hybrid pvid ${original.pvid}`);
        if (!valuesEqual(original.tagged, desired.tagged)) addVlanMembershipDiff(lines, original.tagged, desired.tagged, "tagged");
        if (!valuesEqual(original.untagged, desired.untagged)) addVlanMembershipDiff(lines, original.untagged, desired.untagged, "untagged");
        if (original.speed !== desired.speed) lines.push(`speed ${original.speed || "auto 10/100/1000"}`);
        if (original.flowcontrol !== desired.flowcontrol) lines.push(`flowcontrol ${original.flowcontrol || "off"}`);
        if (original.shutdown !== desired.shutdown) lines.push(original.shutdown ? "shutdown" : "no shutdown");
        const originalLag = original.lag ? `${original.lag}:${original.lagMode || "active"}` : "none";
        const desiredLag = desired.lag ? `${desired.lag}:${desired.lagMode || "active"}` : "none";
        if (originalLag !== desiredLag) lines.push(original.lag ? `lag ${original.lag} mode ${original.lagMode || "active"}` : "no lag");
        lines.push("exit", "");
    }

    function generateRemediation(states, values = {}) {
        const authority = values.rdAuthority === "sw02" ? "sw02" : "sw01";
        const target = authority === "sw01" ? "sw02" : "sw01";
        const sourceState = states?.[authority];
        const targetState = states?.[target];
        const sourceName = String(values[authority === "sw01" ? "rdSw1Name" : "rdSw2Name"] || authority);
        const targetName = String(values[target === "sw01" ? "rdSw1Name" : "rdSw2Name"] || target);
        const policy = policyFromValues(values);
        const comparison = compare(states, values);
        const commands = [
            `! REDUNDANCY PAIR REMEDIATION: ${sourceName} -> ${targetName}`,
            "! Only mirrored policy is remediated. Independent/exception ports are untouched.",
            "configure",
            ""
        ];
        const rollbackCommands = [
            `! REVERT REDUNDANCY PAIR REMEDIATION on ${targetName}`,
            "! Restores the imported target state captured before remediation.",
            "configure",
            ""
        ];
        const risks = [];
        const errors = [];
        const summary = [];
        const resources = [];
        let changes = 0;
        let exact = true;

        if (!sourceState || !targetState) {
            errors.push("Import both switch running-configs before generating pair remediation.");
            return { commands: [], rollbackCommands: [], rollbackExact: false, rollbackNote: "Both current states are required.", risks, errors, summary, resources, comparison, meta: { pair: true }, plan: { title: "Switch-pair remediation", platform: "netgear", task: "redundancy", order: 25, mutating: true } };
        }
        if (!sourceState.coverage?.full || !targetState.coverage?.full) {
            exact = false;
            risks.push({ level: "high", code: "PAIR_PARTIAL_STATE", message: "Complete running-config imports are required before absence/removal can be treated as proven for pair remediation." });
        }

        // Global settings that are safe and meaningful to mirror.
        if (policy.managementVlan && String(sourceState.global?.managementVlan ?? 1) !== String(targetState.global?.managementVlan ?? 1)) {
            commands.push(`management-vlan vlan ${sourceState.global?.managementVlan ?? 1}`);
            rollbackCommands.push(`management-vlan vlan ${targetState.global?.managementVlan ?? 1}`);
            changes += 1;
            risks.push({ level: "high", code: "PAIR_MGMT_VLAN", message: `Changes ${targetName} management VLAN.` });
        }
        if (policy.defaultGateway && sourceState.global?.defaultGateway && sourceState.global.defaultGateway !== targetState.global?.defaultGateway) {
            commands.push(`ip default-gateway ${sourceState.global.defaultGateway}`);
            rollbackCommands.push(targetState.global?.defaultGateway ? `ip default-gateway ${targetState.global.defaultGateway}` : "no ip default-gateway");
            changes += 1;
            risks.push({ level: "high", code: "PAIR_DEFAULT_GATEWAY", message: `Changes ${targetName} management default gateway.` });
        }
        if (policy.netmask && sourceState.global?.netmask && sourceState.global.netmask !== targetState.global?.netmask) {
            if (targetState.global?.ipAddress) {
                commands.push(`ip address ${targetState.global.ipAddress} mask ${sourceState.global.netmask}`);
                rollbackCommands.push(`ip address ${targetState.global.ipAddress} mask ${targetState.global.netmask || sourceState.global.netmask}`);
                changes += 1;
                risks.push({ level: "high", code: "PAIR_NETMASK", message: `Changes ${targetName} management netmask while preserving its unique management IP.` });
            } else {
                exact = false;
                risks.push({ level: "high", code: "PAIR_NETMASK_UNKNOWN_IP", message: `Cannot safely remediate ${targetName} netmask because its management IP was not imported.` });
            }
        }
        if (policy.systemName && sourceState.global?.systemName && sourceState.global.systemName !== targetState.global?.systemName) {
            commands.push(`system name ${sourceState.global.systemName}`);
            rollbackCommands.push(targetState.global?.systemName ? `system name ${targetState.global.systemName}` : "! Previous system name unavailable");
            changes += 1;
        }

        // VLAN definitions/names.
        const vlanIds = NCH.utils.unique([1, ...Object.keys(sourceState.vlans || {}).map(Number), ...Object.keys(targetState.vlans || {}).map(Number)]).sort((a, b) => a - b);
        vlanIds.forEach((vlan) => {
            const desired = normaliseVlan(sourceState, vlan);
            const current = normaliseVlan(targetState, vlan);
            if (policy.vlanDefinitions && desired.exists && !current.exists) {
                commands.push(`vlan ${vlan}`);
                if (desired.name && desired.name !== "default") commands.push(`name ${desired.name}`);
                commands.push("exit", "");
                rollbackCommands.push(`no vlan ${vlan}`, "");
                changes += 1;
                resources.push({ kind: "netgear-vlan", platform: "netgear", vlan, name: desired.name || "" });
            } else if (policy.vlanDefinitions && !desired.exists && current.exists && vlan !== 1) {
                if (policy.allowDestructive && targetState.coverage?.full) {
                    commands.push(`no vlan ${vlan}`, "");
                    rollbackCommands.push(`vlan ${vlan}`);
                    if (current.name && current.name !== "default") rollbackCommands.push(`name ${current.name}`);
                    rollbackCommands.push("exit", "");
                    changes += 1;
                    risks.push({ level: "high", code: "PAIR_REMOVE_VLAN", message: `Removes extra VLAN ${vlan} from ${targetName}.` });
                } else {
                    risks.push({ level: "medium", code: "PAIR_EXTRA_VLAN", message: `${targetName} has extra VLAN ${vlan}; destructive removal is disabled.` });
                }
            } else if (desired.exists && current.exists && policy.vlanNames && desired.name && desired.name !== current.name) {
                commands.push(`vlan ${vlan}`, desired.name === "default" ? `no name ${current.name || ""}`.trim() : `name ${desired.name}`, "exit", "");
                rollbackCommands.push(`vlan ${vlan}`, current.name && current.name !== "default" ? `name ${current.name}` : `no name ${desired.name}`, "exit", "");
                changes += 1;
            }
        });

        // Port policy. Independent ports are explicitly untouched.
        PORTS.forEach((port) => {
            const mode = policy.ports[port].mode;
            if (mode === "exception") return;
            const desired = normaliseInterface(sourceState, port);
            const current = normaliseInterface(targetState, port);
            if (!desired || !current) {
                exact = false;
                risks.push({ level: "high", code: "PAIR_PORT_UNKNOWN", message: `Cannot safely remediate ${port}; current state is incomplete on one or both switches.` });
                return;
            }
            const desiredEffective = { ...desired };
            if (!policy.description || mode === "redundancy") desiredEffective.description = current.description;
            if (!policy.portPvid) desiredEffective.pvid = current.pvid;
            if (!policy.tagged) desiredEffective.tagged = current.tagged;
            if (!policy.untagged) desiredEffective.untagged = current.untagged;
            if (!policy.speed) desiredEffective.speed = current.speed;
            if (!policy.flowcontrol) desiredEffective.flowcontrol = current.flowcontrol;
            if (!policy.admin) desiredEffective.shutdown = current.shutdown;
            if (!policy.lag || mode === "redundancy") { desiredEffective.lag = current.lag; desiredEffective.lagMode = current.lagMode; }

            const fieldsDiffer = ["description", "pvid", "tagged", "untagged", "speed", "flowcontrol", "shutdown", "lag", "lagMode"].some((field) => !valuesEqual(desiredEffective[field], current[field]));
            if (fieldsDiffer) {
                restorePort(commands, port, desiredEffective, current);
                restorePort(rollbackCommands, port, current, desiredEffective);
                changes += 1;
                resources.push({ kind: "netgear-interface", platform: "netgear", port, options: desiredEffective });
                risks.push({ level: mode === "redundancy" ? "high" : "medium", code: "PAIR_PORT_REMEDIATE", message: `Synchronises ${targetName} ${port} with ${sourceName} under ${mode} policy.` });
            }
            if (mode === "redundancy" && (desired.lag || current.lag)) {
                risks.push({ level: "high", code: "REDUNDANCY_PORT_LAG", message: `${port} is marked redundancy-ready but one or both switch ports are in a LAG. Active/backup endpoint bonding should use independent links.` });
                exact = false;
            }
        });

        commands.push("exit");
        rollbackCommands.push("exit");
        if (changes) {
            commands.push("", "! Verify before saving", "show vlan 1", "show lag", "show interfaces g1-8 status", "", "copy running-config startup-config");
            rollbackCommands.push("", "! Verify Revert before saving", "show vlan 1", "show lag", "show interfaces g1-8 status", "", "copy running-config startup-config");
            summary.push(`${changes} remediation block${changes === 1 ? "" : "s"}: ${sourceName} -> ${targetName}`);
        } else {
            commands.push("", "! No remediable drift detected under the current mirror policy.");
            rollbackCommands.push("", "! No changes were generated; no Revert is required.");
            summary.push("No remediable pair drift detected.");
        }

        return {
            commands,
            rollbackCommands,
            rollbackExact: changes ? exact : true,
            rollbackNote: changes
                ? (exact ? `Exact state-aware Revert generated from imported ${targetName} state.` : "Revert has safety gaps because imported state or redundancy constraints are incomplete.")
                : "No mutation generated; no Revert required.",
            risks,
            errors,
            summary,
            resources,
            comparison,
            meta: { pair: true, authority, target, sourceName, targetName, changes },
            plan: { title: `Switch pair remediation ${sourceName} -> ${targetName}`, platform: "netgear", task: "redundancy", order: 25, mutating: changes > 0, deviceName: targetName }
        };
    }

    function generateMirroredNetgear(values, states, pairValues = {}) {
        const sw1Name = String(pairValues.rdSw1Name || "sw01");
        const sw2Name = String(pairValues.rdSw2Name || "sw02");
        const first = NCH.generators.netgear.generate(values, { currentState: states?.sw01 || null });
        const second = NCH.generators.netgear.generate(values, { currentState: states?.sw02 || null });
        const item1 = NCH.plan.createItem(first, { title: `${first.plan?.title || "NETGEAR change"} · ${sw1Name}`, platform: "netgear", order: first.plan?.order, mutating: first.plan?.mutating, deviceName: sw1Name });
        const item2 = NCH.plan.createItem(second, { title: `${second.plan?.title || "NETGEAR change"} · ${sw2Name}`, platform: "netgear", order: first.plan?.order, mutating: second.plan?.mutating, deviceName: sw2Name });
        const compiled = NCH.plan.compile([item1, item2]);
        compiled.meta = { ...(compiled.meta || {}), mirroredPair: true, pairName: pairValues.rdName || "access-pair-01", devices: [sw1Name, sw2Name] };
        compiled.plan = { title: `Mirrored NETGEAR change · ${pairValues.rdName || "access-pair-01"}`, platform: "netgear", task: "pair-mirror", order: first.plan?.order || 30, mutating: first.plan?.mutating || second.plan?.mutating, deviceName: pairValues.rdName || "access-pair-01" };
        compiled.risks.push({ level: "medium", code: "PAIR_MIRROR_CHANGE", message: `The same desired NETGEAR change will be applied independently to ${sw1Name} and ${sw2Name}. Verify each switch before continuing.` });
        return compiled;
    }

    return {
        PORTS,
        policyFromValues,
        compare,
        generateRemediation,
        generateMirroredNetgear,
        normaliseInterface,
        normaliseVlan
    };
})();
