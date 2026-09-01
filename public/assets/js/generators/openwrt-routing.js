window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtRouting = (() => {
    function generate(values) {
        const utils = NCH.utils;
        const commands = [];
        const rollbackCommands = [];
        const summary = [];
        const risks = [];
        const errors = [];
        const resources = [];

        const section = utils.uciSection(values.rtSection, "nch_route");
        const iface = utils.uciSection(values.rtInterface, "lan");
        const target = String(values.rtTarget || "").trim();
        const gateway = String(values.rtGateway || "").trim();
        const metric = String(values.rtMetric || "").trim();
        const table = String(values.rtTable || "main").trim();
        const source = String(values.rtSource || "").trim();
        const type = ["unicast", "blackhole", "unreachable", "prohibit"].includes(values.rtType) ? values.rtType : "unicast";
        const mtu = String(values.rtMtu || "").trim();
        const onlink = Boolean(values.rtOnlink);
        const apply = values.rtApply !== false;
        const verify = values.rtVerify !== false;

        if (!target || !utils.validCIDR(target)) errors.push("Static route target must be a valid IPv4 CIDR.");
        if (gateway && !utils.validIPv4(gateway)) errors.push("Static route gateway must be a valid IPv4 address.");
        if (source && !utils.validIPv4(source)) errors.push("Preferred source must be a valid IPv4 address.");
        if (metric && (!/^\d+$/.test(metric) || Number(metric) > 4294967295)) errors.push("Route metric must be a non-negative integer.");
        if (table && !/^(?:\d{1,5}|[A-Za-z0-9_-]+)$/.test(table)) errors.push("Routing table must be a numeric ID or symbolic table name.");
        if (/^\d+$/.test(table) && Number(table) > 65535) errors.push("Numeric routing table ID must be between 0 and 65535.");
        if (mtu && (!/^\d+$/.test(mtu) || Number(mtu) < 68 || Number(mtu) > 65535)) errors.push("Route MTU must be between 68 and 65535.");
        if (type === "unicast" && !gateway) risks.push({ level: "medium", code: "LINK_SCOPE_ROUTE", message: "Unicast route has no explicit gateway; OpenWrt will derive a gateway or create a link-scope route." });

        const options = { interface: iface, target, table, type };
        if (gateway) options.gateway = gateway;
        if (metric) options.metric = metric;
        if (source) options.source = source;
        if (mtu) options.mtu = mtu;
        if (onlink) options.onlink = "1";

        commands.push(
            "#!/bin/sh", "",
            "# ============================================================",
            "# STATIC ROUTE",
            "# ============================================================", "",
            `# Section:   network.${section}`,
            `# Target:    ${target}`,
            `# Interface: ${iface}`,
            `# Gateway:   ${gateway || "derived/link-scope"}`,
            `# Metric:    ${metric || "0"}`,
            `# Table:     ${table}`,
            `# Type:      ${type}`, "",
            "# PRE-FLIGHT - SAFE ADDITIVE MODE", "",
            `if uci -q get network.${section} >/dev/null 2>&1; then`,
            `    echo ${utils.shellSingleQuote(`ERROR: network.${section} already exists; refusing overwrite so Revert remains exact.`)}`,
            "    exit 1",
            "fi", "",
            `uci set network.${section}='route'`,
            `uci set network.${section}.interface='${iface}'`,
            `uci set network.${section}.target=${utils.shellSingleQuote(target)}`
        );
        if (gateway) commands.push(`uci set network.${section}.gateway='${gateway}'`);
        if (metric) commands.push(`uci set network.${section}.metric='${metric}'`);
        if (table) commands.push(`uci set network.${section}.table=${utils.shellSingleQuote(table)}`);
        if (source) commands.push(`uci set network.${section}.source='${source}'`);
        if (type !== "unicast") commands.push(`uci set network.${section}.type='${type}'`);
        if (mtu) commands.push(`uci set network.${section}.mtu='${mtu}'`);
        if (onlink) commands.push(`uci set network.${section}.onlink='1'`);
        commands.push("");

        if (apply) {
            commands.push(
                "# COMMIT / APPLY", "",
                "uci commit network",
                "/etc/init.d/network reload", ""
            );
            risks.push({ level: "medium", code: "ROUTE_RELOAD", message: "Reloads OpenWrt networking after adding the static route." });
        }
        if (verify) {
            commands.push(
                "# VERIFY", "",
                `uci show network.${section}`,
                "ip route show table all",
                target && utils.validCIDR(target) ? `ip route get ${target.split("/")[0]}` : "ip route", ""
            );
        }

        rollbackCommands.push(
            "#!/bin/sh", "",
            `# Exact Revert for network.${section}`,
            `uci -q delete network.${section} || true`,
            "uci commit network",
            "/etc/init.d/network reload", "",
            `if uci -q get network.${section} >/dev/null 2>&1; then`,
            `    echo ${utils.shellSingleQuote(`ERROR: network.${section} still exists`)}`,
            "    exit 1",
            "fi",
            `echo ${utils.shellSingleQuote(`PASS: network.${section} removed`)}`
        );

        summary.push(`${target} via ${gateway || iface}`);
        risks.push({ level: type === "blackhole" || type === "unreachable" || type === "prohibit" ? "high" : "medium", code: "STATIC_ROUTE", message: `${type} route changes forwarding decisions for ${target}.` });
        resources.push({ kind: "uci-section", platform: "openwrt", package: "network", section, type: "route", options });

        return {
            commands, rollbackCommands, rollbackExact: true,
            rollbackNote: "Exact Revert: the named route section is collision-checked before Apply.",
            summary, risks, errors, resources,
            meta: { section, iface, target, gateway, metric, table, source, type, mtu, onlink },
            plan: { title: `OpenWrt route ${target}`, platform: "openwrt", task: "routing", order: 40, mutating: true }
        };
    }

    return { generate };
})();
