window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.netgear = (() => {
    function safeDescription(value) {
        const text = String(value || "").trim().replace(/["'?]/g, "").slice(0, 64);
        if (!text) return "";
        return /\s/.test(text) ? `"${text}"` : text;
    }

    function importedInterface(context, port) {
        return context?.currentState?.platform === "netgear" ? context.currentState.interfaces?.[port] || null : null;
    }

    function rollbackVlans(commands, state, create, names) {
        let exact = true;
        [...create].sort((a, b) => b - a).forEach((vlan) => {
            const current = state?.vlans?.[vlan];
            if (!current) {
                if (state?.coverage?.full) commands.push(`no vlan ${vlan}`);
                else {
                    exact = false;
                    commands.push(`! WARNING: VLAN ${vlan} was not present in the partial import; absence is not proven, so it is not removed automatically.`);
                }
            } else if (names.has(vlan) && current.name !== names.get(vlan)) {
                commands.push(`vlan ${vlan}`);
                if (current.name) commands.push(`name ${current.name}`);
                else commands.push(`no name ${names.get(vlan)}`);
                commands.push("exit");
            }
        });
        return exact;
    }

    function diagnosticCommands(mode, port, vlan, target) {
        if (mode === "port") return [
            `show interfaces ${port}`,
            `show interfaces ${port} status`,
            `show interfaces switchport ${port}`,
            `show spanning-tree interfaces ${port}`,
            `show cable-diag interfaces ${port}`
        ];
        if (mode === "vlan") return [
            `show vlan ${vlan}`,
            "show mac address-table",
            `show ip interface vlan ${vlan}`,
            "show arp"
        ];
        if (mode === "topology") return [
            "show lldp neighbor",
            `show lldp interfaces ${port} local-device`,
            "show lldp statistics",
            "show spanning-tree"
        ];
        if (mode === "security") return [
            "show users",
            "show ip ssh",
            "show storm-control",
            "show logging buffered"
        ];
        if (mode === "troubleshooting") return [
            "show logging buffered",
            `show interfaces ${port}`,
            `show interfaces switchport ${port}`,
            `show cable-diag interfaces ${port}`,
            "show mac address-table",
            "show arp",
            "show ip route",
            `ping ${target} count 4`,
            "show tech-support"
        ];
        return [
            "show info",
            "show version",
            "show cpu status",
            "show ip",
            `show interfaces ${port} status`,
            `show interfaces switchport ${port}`,
            `show vlan ${vlan}`,
            "show lag"
        ];
    }

    function generate(values, context = {}) {
        const utils = NCH.utils;
        const commands = [];
        const rollbackCommands = [];
        const summary = [];
        const risks = [];
        const errors = [];
        const resources = [];

        const task = ["trunk", "access", "vlans", "port", "lacp", "diagnostics"].includes(values.sTask) ? values.sTask : "trunk";
        const port = utils.safeToken(values.sPort, "g8").toLowerCase();
        const native = utils.clamp(values.sNative, 1, 4094, 1);
        const taggedRaw = String(values.sTagged || "").trim();
        const tagged = utils.parseVlanList(taggedRaw);
        const names = utils.parseVlanNames(values.sNames);
        const create = new Set([...tagged, ...names.keys()]);
        const currentState = context.currentState?.platform === "netgear" ? context.currentState : null;
        const currentPort = importedInterface(context, port);
        let rollbackExact = false;
        let rollbackNote = "Import NETGEAR 'show running-config' state to generate an exact Revert for switch mutations.";
        let mutating = task !== "diagnostics";

        if (!/^g[1-8]$/i.test(port)) errors.push("GS108Tv3 physical interfaces are g1-g8.");
        if (task === "access") create.add(native);
        if (taggedRaw && !tagged.length && task === "trunk") errors.push("Tagged VLAN list could not be parsed.");
        if (tagged.includes(native)) errors.push(`Native VLAN ${native} also appears in the tagged VLAN list.`);

        if (["trunk", "access", "vlans"].includes(task)) {
            commands.push("configure", "");
            if (create.size) {
                commands.push("! Create/update VLAN definitions");
                [...create].sort((a, b) => a - b).forEach((vlan) => {
                    commands.push(`vlan ${vlan}`);
                    if (names.has(vlan)) commands.push(`name ${names.get(vlan)}`);
                    commands.push("exit", "");
                    resources.push({ kind: "netgear-vlan", platform: "netgear", vlan, name: names.get(vlan) || "" });
                });
            }

            if (task === "trunk") {
                commands.push(`interface ${port}`);
                if (values.sNativeTouch) {
                    commands.push(`switchport hybrid pvid ${native}`, `switchport hybrid allowed vlan add ${native} untagged`);
                    risks.push({ level: "high", code: "NATIVE_VLAN_CHANGE", message: `Reasserts/changes native VLAN and PVID ${native} on ${port}; this can interrupt management connectivity.` });
                } else commands.push(`! Native VLAN ${native} / PVID left unchanged`);
                if (taggedRaw) {
                    commands.push(`switchport hybrid allowed vlan add ${taggedRaw} tagged`);
                    risks.push({ level: "low", code: "ADD_TAGGED_VLANS", message: `Adds tagged VLAN membership to ${port} without changing the native VLAN.` });
                }
                commands.push("exit", "");
                const options = {};
                if (values.sNativeTouch) { options.pvid = native; options.untagged = [native]; }
                if (tagged.length) options.tagged = tagged;
                resources.push({ kind: "netgear-interface", platform: "netgear", port, options });
                summary.push(`${port}: native ${native}; tagged ${taggedRaw || "none"}`);
            }

            if (task === "access") {
                commands.push(`interface ${port}`, `switchport hybrid pvid ${native}`, `switchport hybrid allowed vlan add ${native} untagged`, "exit", "");
                resources.push({ kind: "netgear-interface", platform: "netgear", port, options: { pvid: native, untagged: [native] } });
                risks.push({ level: "high", code: "ACCESS_PORT_PVID", message: `Changes ${port} PVID/native membership to VLAN ${native}.` });
                summary.push(`${port}: access/native VLAN ${native}`);
            }

            if (task === "vlans") {
                risks.push({ level: "low", code: "CREATE_SWITCH_VLANS", message: "Creates VLAN definitions without changing port membership." });
                summary.push(`Create VLANs: ${[...create].sort((a, b) => a - b).join(", ") || "none"}`);
            }
            commands.push("exit");

            if (currentState) {
                rollbackCommands.push("! State-aware Revert generated from imported NETGEAR running configuration", "configure", "");
                if (task === "trunk" || task === "access") {
                    if (!currentPort) errors.push(`Imported state does not contain ${port}; exact port Revert cannot be proven.`);
                    else {
                        rollbackCommands.push(`interface ${port}`);
                        tagged.filter((vlan) => !(currentPort.tagged || []).includes(vlan)).forEach((vlan) => rollbackCommands.push(`switchport hybrid allowed vlan remove ${vlan}`));
                        if (task === "access" || values.sNativeTouch) {
                            rollbackCommands.push(`switchport hybrid pvid ${currentPort.pvid || 1}`);
                            if (!(currentPort.untagged || []).includes(native)) rollbackCommands.push(`switchport hybrid allowed vlan remove ${native}`);
                        }
                        rollbackCommands.push("exit", "");
                    }
                }
                const vlanRollbackExact = rollbackVlans(rollbackCommands, currentState, create, names);
                rollbackCommands.push("exit", "", "show vlan 1", `show interfaces switchport ${port}`);
                rollbackExact = !errors.some((error) => error.includes("exact port Revert")) && vlanRollbackExact;
                rollbackNote = rollbackExact
                    ? "Exact Revert derived from imported NETGEAR current state."
                    : "Partial Revert generated. Import the complete NETGEAR 'show running-config' output (including the ! Model header) before treating VLAN absence as proven.";
            }
        }

        if (task === "port") {
            const description = safeDescription(values.sPortDescription);
            const admin = ["unchanged", "enabled", "disabled"].includes(values.sPortAdmin) ? values.sPortAdmin : "unchanged";
            const speed = ["unchanged", "auto", "10", "100", "1000"].includes(values.sPortSpeed) ? values.sPortSpeed : "unchanged";
            const flow = ["unchanged", "off", "auto", "asymmetric", "symmetric"].includes(values.sPortFlow) ? values.sPortFlow : "unchanged";
            if (!description && admin === "unchanged" && speed === "unchanged" && flow === "unchanged" && !values.sClearCounters) errors.push("Choose at least one port setting or counter operation.");
            commands.push("configure", `interface ${port}`);
            const options = {};
            if (description) { commands.push(`description ${description}`); options.description = description.replace(/^"|"$/g, ""); }
            if (admin === "disabled") { commands.push("shutdown"); options.shutdown = true; risks.push({ level: "high", code: "PORT_SHUTDOWN", message: `Administratively shuts down ${port}.` }); }
            if (admin === "enabled") { commands.push("no shutdown"); options.shutdown = false; risks.push({ level: "medium", code: "PORT_ENABLE", message: `Administratively enables ${port}.` }); }
            if (speed !== "unchanged") { commands.push(speed === "auto" ? "speed auto 10/100/1000" : `speed ${speed}`); options.speed = speed === "auto" ? "auto 10/100/1000" : speed; risks.push({ level: "medium", code: "PORT_SPEED", message: `Changes ${port} speed configuration.` }); }
            if (flow !== "unchanged") { commands.push(`flowcontrol ${flow}`); options.flowcontrol = flow; }
            commands.push("exit", "exit");
            if (values.sClearCounters) {
                commands.push("", `clear interfaces ${port} counters`);
                risks.push({ level: "medium", code: "CLEAR_COUNTERS", message: `Clears historical interface counters on ${port}; counter history cannot be restored.` });
            }
            resources.push({ kind: "netgear-interface", platform: "netgear", port, options });
            summary.push(`Manage ${port}`);
            if (currentPort) {
                rollbackCommands.push("! State-aware port Revert", "configure", `interface ${port}`);
                if (description) rollbackCommands.push(currentPort.description ? `description ${safeDescription(currentPort.description)}` : "no description");
                if (admin !== "unchanged") rollbackCommands.push(currentPort.shutdown ? "shutdown" : "no shutdown");
                if (speed !== "unchanged") rollbackCommands.push(`speed ${currentPort.speed || "auto 10/100/1000"}`);
                if (flow !== "unchanged") rollbackCommands.push(`flowcontrol ${currentPort.flowcontrol || "off"}`);
                rollbackCommands.push("exit", "exit", "", `show running-config interfaces ${port}`);
                rollbackExact = !values.sClearCounters;
                rollbackNote = values.sClearCounters ? "Configuration can be restored from imported state, but cleared counters are irreversible." : "Exact Revert derived from imported NETGEAR current state.";
            }
        }

        if (task === "lacp") {
            const membersRaw = String(values.sLagMembers || "").trim();
            const members = utils.expandGigabitPorts(membersRaw, 8);
            const lagId = utils.clamp(values.sLagId, 1, 4094, 1);
            const mode = ["static", "active", "passive"].includes(values.sLagMode) ? values.sLagMode : "active";
            if (members.length < 2) errors.push("LAG requires at least two valid GS108Tv3 member ports.");
            commands.push("configure", `interface range ${membersRaw}`, `lag ${lagId} mode ${mode}`, "exit", "exit");
            resources.push({ kind: "netgear-lag", platform: "netgear", lagId, mode, members });
            members.forEach((member) => resources.push({ kind: "netgear-interface", platform: "netgear", port: member, options: { lag: lagId, lagMode: mode } }));
            summary.push(`LAG ${lagId}: ${members.join(", ")} (${mode})`);
            risks.push({ level: "high", code: "LAG_MEMBERSHIP", message: `Changes link aggregation membership for ${members.join(", ")}; links may reconverge.` });

            if (currentState && members.every((member) => currentState.interfaces?.[member])) {
                rollbackCommands.push("! State-aware LAG Revert", "configure");
                members.forEach((member) => {
                    const previous = currentState.interfaces[member];
                    rollbackCommands.push(`interface ${member}`);
                    if (previous.lag) rollbackCommands.push(`lag ${previous.lag} mode ${previous.lagMode || "active"}`);
                    else rollbackCommands.push("no lag");
                    rollbackCommands.push("exit");
                });
                rollbackCommands.push("exit", "", "show lag");
                rollbackExact = true;
                rollbackNote = "Exact LAG Revert derived from imported NETGEAR current state.";
            }
        }

        if (task === "diagnostics") {
            const mode = ["overview", "port", "vlan", "topology", "security", "troubleshooting"].includes(values.sDiagMode) ? values.sDiagMode : "overview";
            const vlan = utils.clamp(values.sDiagVlan, 1, 4094, 1);
            const target = utils.safeToken(values.sDiagTarget, "172.16.0.1");
            commands.push(...diagnosticCommands(mode, port, vlan, target));
            rollbackCommands.push("! Read-only diagnostic bundle: no Revert required.");
            rollbackExact = true;
            rollbackNote = "Read-only diagnostics do not change configuration.";
            mutating = false;
            summary.push(`NETGEAR ${mode} diagnostics`);
            risks.push({ level: "low", code: "READ_ONLY_DIAGNOSTICS", message: "Diagnostic commands are read-only; tech-support output may contain configuration details." });
        }

        if (task !== "diagnostics" && values.sVerify) {
            commands.push("", "! Verify before saving");
            if (["trunk", "access", "port"].includes(task)) commands.push(`show interfaces ${port} status`, `show interfaces switchport ${port}`);
            if (task === "port") commands.push(`show running-config interfaces ${port}`);
            if (task === "lacp") commands.push("show lag");
            [...create].sort((a, b) => a - b).forEach((vlan) => commands.push(`show vlan ${vlan}`));
        }
        if (task !== "diagnostics" && values.sSave) commands.push("", "! Save only after verification", "copy running-config startup-config");
        if (rollbackCommands.length && task !== "diagnostics" && values.sSave) rollbackCommands.push("", "! Save Revert only after verification", "copy running-config startup-config");

        return {
            commands, rollbackCommands, rollbackExact, rollbackNote,
            summary, risks, errors, resources,
            meta: {
                task, port, native, taggedRaw, tagged, vlanNames: names,
                lagId: values.sLagId, lagMembers: values.sLagMembers, lagMode: values.sLagMode,
                diagMode: values.sDiagMode
            },
            plan: { title: task === "diagnostics" ? `NETGEAR ${values.sDiagMode || "overview"} diagnostics` : `NETGEAR ${task} ${task === "lacp" ? `LAG ${values.sLagId}` : port}`, platform: "netgear", task, order: task === "vlans" ? 10 : task === "diagnostics" ? 90 : 30, mutating }
        };
    }

    return { generate };
})();
