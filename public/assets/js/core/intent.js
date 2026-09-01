window.NCH = window.NCH || {};

NCH.intent = (() => {
    function annotateDiff(diff, deviceName) {
        return (diff?.items || []).map((item) => ({ ...item, label: `${deviceName}: ${item.label}` }));
    }

    function combineDiff(parts) {
        const items = parts.flatMap((part) => part.items || []);
        const counts = { add: 0, change: 0, match: 0, unknown: 0 };
        items.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
        const unavailable = parts.filter((part) => !part.available).length;
        const suffix = unavailable ? ` · ${unavailable} target${unavailable === 1 ? "" : "s"} without imported state` : "";
        return {
            available: parts.some((part) => part.available),
            compatible: parts.every((part) => part.compatible !== false),
            items,
            counts,
            message: `${counts.add} add · ${counts.change} change · ${counts.match} match · ${counts.unknown} unknown${suffix}`
        };
    }

    function normaliseState(state, platform) {
        return state?.platform === platform ? state : null;
    }

    function generateNetwork(values, context = {}) {
        const utils = NCH.utils;
        const errors = [];
        const risks = [];
        const summary = [];
        const items = [];
        const diffParts = [];

        const rawVlan = String(values.iVlan || "").trim();
        const vlan = Number(rawVlan);
        const name = utils.safeName(values.iName, `vlan${Number.isInteger(vlan) ? vlan : "network"}`);
        const section = utils.uciSection(values.iZone || name, name);
        const subnet = String(values.iSubnet || "").trim();
        const gateway = String(values.iGateway || "").trim();
        const sw1Name = String(context.pairValues?.rdSw1Name || values.iSw1Name || "sw01").trim() || "sw01";
        const sw2Name = String(context.pairValues?.rdSw2Name || values.iSw2Name || "sw02").trim() || "sw02";
        const targets = {
            openwrt: Boolean(values.iTargetOpenwrt),
            sw01: Boolean(values.iTargetSw01),
            sw02: Boolean(values.iTargetSw02)
        };

        if (!/^\d+$/.test(rawVlan) || !Number.isInteger(vlan) || vlan < 1 || vlan > 4094) errors.push("VLAN ID must be between 1 and 4094.");
        if (!utils.validCIDR(subnet)) errors.push("Network intent requires a valid IPv4 subnet CIDR.");
        if (!utils.validIPv4(gateway)) errors.push("Network intent requires a valid IPv4 gateway.");
        if (utils.validCIDR(subnet) && utils.validIPv4(gateway) && !utils.ipInCidr(gateway, subnet)) errors.push("Gateway must be inside the requested subnet.");
        if (!Object.values(targets).some(Boolean)) errors.push("Choose at least one target device.");
        if (targets.openwrt && vlan === 1) risks.push({ level: "high", code: "INTENT_VLAN1", message: "Cross-device intent includes VLAN 1, which may be native/management traffic." });

        if (errors.length) {
            return {
                commands: ["# NETWORK INTENT INVALID", ...errors.map((error) => `# ERROR: ${error}`)],
                rollbackCommands: [], rollbackExact: false,
                rollbackNote: "Fix validation errors before generating a network intent.",
                summary: [], risks, errors, resources: [], intentDiff: combineDiff([]),
                meta: { intent: true, vlan: rawVlan, name, subnet, gateway, targets, count: 0 },
                plan: { title: `Network intent VLAN ${rawVlan || "?"} / ${name}`, platform: "multi-device", task: "network-intent", order: 0, mutating: true }
            };
        }

        const switchBase = {
            ...NCH.config.defaults.netgear,
            sTask: "trunk",
            sNative: String(values.iNativeVlan || "1"),
            sTagged: String(vlan),
            sNames: `${vlan}=${name}`,
            sNativeTouch: false,
            sVerify: values.iVerify !== false,
            sSave: values.iSaveSwitches !== false
        };

        if (targets.sw01) {
            const sw01Values = { ...switchBase, sPort: NCH.utils.safeToken(values.iSw1Port, "g8") };
            const result = NCH.generators.netgear.generate(sw01Values, { currentState: normaliseState(context.pairStates?.sw01, "netgear") });
            items.push(NCH.plan.createItem(result, { title: `Prepare VLAN ${vlan} on ${sw1Name}`, platform: "netgear", deviceName: sw1Name, order: 10, mutating: true }));
            const diff = NCH.diff.compare(result.resources || [], normaliseState(context.pairStates?.sw01, "netgear"));
            diffParts.push({ ...diff, items: annotateDiff(diff, sw1Name) });
        }

        if (targets.sw02) {
            const sw02Values = { ...switchBase, sPort: NCH.utils.safeToken(values.iSw2Port, "g8") };
            const result = NCH.generators.netgear.generate(sw02Values, { currentState: normaliseState(context.pairStates?.sw02, "netgear") });
            items.push(NCH.plan.createItem(result, { title: `Prepare VLAN ${vlan} on ${sw2Name}`, platform: "netgear", deviceName: sw2Name, order: 11, mutating: true }));
            const diff = NCH.diff.compare(result.resources || [], normaliseState(context.pairStates?.sw02, "netgear"));
            diffParts.push({ ...diff, items: annotateDiff(diff, sw2Name) });
        }

        if (targets.openwrt) {
            const routerValues = {
                ...NCH.config.defaults.openwrtVlan,
                rVlan: String(vlan),
                rName: name,
                rSubnet: subnet,
                rGw: gateway,
                rStart: String(values.iDhcpStart || "100"),
                rLimit: String(values.iDhcpLimit || "100"),
                rLease: String(values.iLease || "12h"),
                rInputPolicy: values.iInputPolicy || "REJECT",
                rZone: section,
                rAllow: String(values.iAllow || ""),
                rDeny: String(values.iDeny || ""),
                rWan: Boolean(values.iWan),
                rLan: Boolean(values.iLan),
                rDhcp: values.iDhcp !== false,
                rDns: values.iDns !== false,
                rPing: values.iPing !== false,
                rApply: values.iApplyRouter !== false,
                rVerify: values.iVerify !== false,
                rParent: NCH.utils.safeToken(values.iParent, "eth2"),
                rSwitch: NCH.utils.safeToken(values.iSwitch, "switch0"),
                rCpu: NCH.utils.safeToken(values.iCpu, "0t"),
                rBridge: NCH.utils.safeToken(values.iBridge, `br-vlan${vlan}`)
            };
            const result = NCH.generators.openwrtVlan.generate(routerValues, { currentState: normaliseState(context.currentState, "openwrt") });
            items.push(NCH.plan.createItem(result, { title: `Create routed VLAN ${vlan} on OpenWrt`, platform: "openwrt", deviceName: String(values.iRouterName || "OpenWrt"), order: 20, mutating: true }));
            const diff = NCH.diff.compare(result.resources || [], normaliseState(context.currentState, "openwrt"));
            diffParts.push({ ...diff, items: annotateDiff(diff, String(values.iRouterName || "OpenWrt")) });
        }

        const compiled = NCH.plan.compile(items);
        compiled.commands.unshift(
            `# INTENT: create network ${name}`,
            `# VLAN: ${vlan}`,
            `# SUBNET: ${subnet}`,
            `# GATEWAY: ${gateway}`,
            `# TARGETS: ${[targets.openwrt ? (values.iRouterName || "OpenWrt") : "", targets.sw01 ? sw1Name : "", targets.sw02 ? sw2Name : ""].filter(Boolean).join(", ")}`,
            ""
        );
        compiled.rollbackCommands.unshift(
            `# INTENT REVERT: network ${name} / VLAN ${vlan}`,
            "# Revert remains dependency-safe and runs in reverse device order.",
            ""
        );
        compiled.summary.unshift(`Network intent: ${name} / VLAN ${vlan} / ${subnet}`);
        compiled.risks.unshift({ level: "medium", code: "CROSS_DEVICE_INTENT", message: `One desired network definition expands into ${items.length} independently verified device change${items.length === 1 ? "" : "s"}.` });
        summary.push(`Network ${name}`, `VLAN ${vlan}`, subnet, `${items.length} target${items.length === 1 ? "" : "s"}`);
        compiled.intentDiff = combineDiff(diffParts);
        compiled.meta = {
            ...(compiled.meta || {}), intent: true, vlan, name, subnet, gateway, section, targets,
            devices: items.map((item) => item.deviceName || item.platform), count: items.length
        };
        compiled.plan = { title: `Network intent VLAN ${vlan} / ${name}`, platform: "multi-device", task: "network-intent", order: 0, mutating: true, deviceName: "network-intent" };
        return compiled;
    }

    return { generateNetwork };
})();
