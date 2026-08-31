window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.netgear = (() => {
    function generate(values) {
        const utils = NCH.utils;
        const commands = [];
        const summary = [];
        const risks = [];
        const errors = [];

        const task = ["trunk", "access", "vlans"].includes(values.sTask) ? values.sTask : "trunk";
        const port = utils.safeToken(values.sPort, "g8");
        const native = utils.clamp(values.sNative, 1, 4094, 1);
        const taggedRaw = String(values.sTagged || "").trim();
        const tagged = utils.parseVlanList(taggedRaw);
        const names = utils.parseVlanNames(values.sNames);
        const create = new Set([...tagged, ...names.keys()]);

        if (task === "access") {
            create.add(native);
        }

        if (!/^g\d+$/i.test(port)) {
            errors.push("GS108Tv3 interfaces normally look like g1-g8.");
        }

        if (taggedRaw && !tagged.length && task === "trunk") {
            errors.push("Tagged VLAN list could not be parsed.");
        }

        if (tagged.includes(native)) {
            errors.push(`Native VLAN ${native} also appears in the tagged VLAN list.`);
        }

        commands.push("configure", "");

        if (create.size) {
            commands.push("! Create/update VLAN definitions");
            [...create].sort((a, b) => a - b).forEach((vlan) => {
                commands.push(`vlan ${vlan}`);
                if (names.has(vlan)) {
                    commands.push(`name ${names.get(vlan)}`);
                }
                commands.push("exit", "");
            });
        }

        if (task === "trunk") {
            commands.push(`interface ${port}`);

            if (values.sNativeTouch) {
                commands.push(
                    `switchport hybrid pvid ${native}`,
                    `switchport hybrid allowed vlan add ${native} untagged`
                );
                risks.push({
                    level: "high",
                    code: "NATIVE_VLAN_CHANGE",
                    message: `Reasserts/changes native VLAN and PVID ${native} on ${port}; this can interrupt management connectivity.`
                });
            } else {
                commands.push(`! Native VLAN ${native} / PVID left unchanged`);
            }

            if (taggedRaw) {
                commands.push(`switchport hybrid allowed vlan add ${taggedRaw} tagged`);
                risks.push({
                    level: "low",
                    code: "ADD_TAGGED_VLANS",
                    message: `Adds tagged VLAN membership to ${port} without changing the native VLAN.`
                });
            }

            commands.push("exit", "");
            summary.push(`${port}: native ${native}; tagged ${taggedRaw || "none"}`);
        }

        if (task === "access") {
            commands.push(
                `interface ${port}`,
                `switchport hybrid pvid ${native}`,
                `switchport hybrid allowed vlan add ${native} untagged`,
                "exit",
                ""
            );

            risks.push({
                level: "high",
                code: "ACCESS_PORT_PVID",
                message: `Changes ${port} PVID/native membership to VLAN ${native}.`
            });
            summary.push(`${port}: access/native VLAN ${native}`);
        }

        if (task === "vlans") {
            risks.push({
                level: "low",
                code: "CREATE_SWITCH_VLANS",
                message: "Creates VLAN definitions without changing port membership."
            });
            summary.push(`Create VLANs: ${[...create].sort((a, b) => a - b).join(", ") || "none"}`);
        }

        commands.push("exit");

        if (values.sVerify) {
            commands.push("", "! Verify before saving");
            if (task !== "vlans") {
                commands.push(`show interfaces switchport ${port}`);
            }
            [...create].sort((a, b) => a - b).forEach((vlan) => commands.push(`show vlan ${vlan}`));
        }

        if (values.sSave) {
            commands.push("", "! Save only after verification", "copy running-config startup-config");
        }

        return {
            commands,
            summary,
            risks,
            errors,
            meta: {
                task,
                port,
                native,
                taggedRaw,
                tagged,
                vlanNames: names
            }
        };
    }

    return { generate };
})();
