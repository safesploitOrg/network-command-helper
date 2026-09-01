window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtFirewall = (() => {
    function normalisePortSpec(value) {
        const raw = String(value || "").trim().replace(/,/g, " ").replace(/\s+/g, " ");
        if (!raw) return "";
        const tokens = raw.split(" ");
        for (const token of tokens) {
            const match = token.match(/^(\d+)(?:-(\d+))?$/);
            if (!match) return null;
            const start = Number(match[1]);
            const end = match[2] ? Number(match[2]) : start;
            if (start < 1 || start > 65535 || end < 1 || end > 65535 || start > end) return null;
        }
        return raw;
    }

    function validIPv4OrCIDR(value) {
        const text = String(value || "").trim();
        return !text || NCH.utils.validIPv4(text) || NCH.utils.validCIDR(text);
    }

    function generate(values) {
        const utils = NCH.utils;
        const commands = [];
        const rollbackCommands = [];
        const summary = [];
        const risks = [];
        const errors = [];
        const resources = [];

        const kind = values.fKind === "forwarding" ? "forwarding" : "rule";
        const section = utils.uciSection(values.fSection, "nch_firewall_rule");
        const name = String(values.fName || "Network Command Helper rule").trim();
        const src = String(values.fSrcZone || "").trim() ? utils.uciSection(values.fSrcZone, "") : "";
        const dest = String(values.fDestZone || "").trim() ? utils.uciSection(values.fDestZone, "") : "";
        const srcIp = String(values.fSrcIp || "").trim();
        const destIp = String(values.fDestIp || "").trim();
        const srcPort = normalisePortSpec(values.fSrcPort);
        const destPort = normalisePortSpec(values.fDestPort);
        const proto = ["all", "tcp", "udp", "tcp udp", "icmp"].includes(values.fProto) ? values.fProto : "all";
        const target = ["ACCEPT", "REJECT", "DROP"].includes(values.fTarget) ? values.fTarget : "ACCEPT";
        const enabled = values.fEnabled !== false;
        const apply = values.fApply !== false;
        const verify = values.fVerify !== false;

        if (!section) errors.push("A UCI section name is required.");
        if (kind === "forwarding" && (!src || !dest)) errors.push("Zone forwarding requires both a source and destination zone.");
        if (kind === "rule" && !src && !dest) errors.push("A traffic rule requires at least a source or destination zone.");
        if (!validIPv4OrCIDR(srcIp)) errors.push("Invalid source IPv4/CIDR.");
        if (!validIPv4OrCIDR(destIp)) errors.push("Invalid destination IPv4/CIDR.");
        if (srcPort === null) errors.push("Invalid source port/range.");
        if (destPort === null) errors.push("Invalid destination port/range.");
        if (kind === "forwarding" && (srcIp || destIp || srcPort || destPort)) {
            errors.push("Zone forwarding does not use IP/port match fields. Use a traffic rule instead.");
        }

        commands.push(
            "#!/bin/sh", "",
            `# Firewall operation: ${kind === "forwarding" ? "zone forwarding" : "traffic rule"}`,
            `# UCI section:        ${section}`,
            `# Source zone:        ${src || "router/output"}`,
            `# Destination zone:   ${dest || "router/input"}`,
            "",
            "# ============================================================",
            "# PRE-FLIGHT - SAFE ADDITIVE MODE",
            "# ============================================================", "",
            `if uci -q get firewall.${section} >/dev/null 2>&1; then`,
            `    echo ${utils.shellSingleQuote(`ERROR: firewall.${section} already exists; refusing to overwrite it so Revert remains exact.`)}`,
            "    exit 1",
            "fi", ""
        );

        if (kind === "forwarding") {
            commands.push(
                "# ============================================================",
                "# ZONE FORWARDING",
                "# ============================================================", "",
                `uci set firewall.${section}='forwarding'`,
                `uci set firewall.${section}.src='${src}'`,
                `uci set firewall.${section}.dest='${dest}'`, ""
            );
            summary.push(`${src} -> ${dest}`);
            risks.push({ level: "medium", code: "ZONE_FORWARDING", message: `Allows forwarding from ${src} to ${dest}.` });
        } else {
            commands.push(
                "# ============================================================",
                "# TRAFFIC RULE",
                "# ============================================================", "",
                `uci set firewall.${section}='rule'`,
                `uci set firewall.${section}.name=${utils.shellSingleQuote(name)}`
            );
            if (src) commands.push(`uci set firewall.${section}.src='${src}'`);
            if (dest) commands.push(`uci set firewall.${section}.dest='${dest}'`);
            if (srcIp) commands.push(`uci set firewall.${section}.src_ip=${utils.shellSingleQuote(srcIp)}`);
            if (destIp) commands.push(`uci set firewall.${section}.dest_ip=${utils.shellSingleQuote(destIp)}`);
            if (srcPort) commands.push(`uci set firewall.${section}.src_port=${utils.shellSingleQuote(srcPort)}`);
            if (destPort) commands.push(`uci set firewall.${section}.dest_port=${utils.shellSingleQuote(destPort)}`);
            commands.push(
                `uci set firewall.${section}.proto=${utils.shellSingleQuote(proto)}`,
                `uci set firewall.${section}.family='ipv4'`,
                `uci set firewall.${section}.target='${target}'`,
                `uci set firewall.${section}.enabled='${enabled ? "1" : "0"}'`, ""
            );

            const direction = src && dest ? `${src} -> ${dest}` : src ? `${src} -> router` : `router -> ${dest}`;
            summary.push(`${target}: ${direction}`);
            if (target === "ACCEPT" && src === "wan") {
                risks.push({ level: "high", code: "WAN_ACCEPT", message: "Allows new WAN-originated traffic; verify ports and destination carefully." });
            } else if (target === "ACCEPT") {
                risks.push({ level: "medium", code: "TRAFFIC_ACCEPT", message: `Adds an ACCEPT rule for ${direction}.` });
            } else {
                risks.push({ level: "low", code: "TRAFFIC_RESTRICT", message: `Adds a ${target} rule for ${direction}.` });
            }
        }

        const desiredOptions = kind === "forwarding"
            ? { src, dest }
            : {
                name,
                ...(src ? { src } : {}),
                ...(dest ? { dest } : {}),
                ...(srcIp ? { src_ip: srcIp } : {}),
                ...(destIp ? { dest_ip: destIp } : {}),
                ...(srcPort ? { src_port: srcPort } : {}),
                ...(destPort ? { dest_port: destPort } : {}),
                proto, family: "ipv4", target, enabled: enabled ? "1" : "0"
            };
        resources.push({ kind: "uci-section", platform: "openwrt", package: "firewall", section, type: kind, options: desiredOptions });

        if (apply) {
            commands.push(
                "# ============================================================",
                "# COMMIT / VALIDATE / APPLY",
                "# ============================================================", "",
                "uci commit firewall", "",
                "fw4 print >/dev/null || {",
                "    echo \"ERROR: firewall configuration validation failed\"",
                "    exit 1",
                "}", "",
                "/etc/init.d/firewall reload", ""
            );
        }
        if (verify) {
            commands.push(
                "# ============================================================",
                "# VERIFY",
                "# ============================================================", "",
                `uci show firewall.${section}`,
                `fw4 print | grep -i -C 4 ${utils.shellSingleQuote(name || section)}`,
                ""
            );
        }

        rollbackCommands.push(
            "#!/bin/sh", "",
            `# Exact Revert for firewall.${section}`,
            "# Safe because Apply refuses to overwrite a pre-existing named section.", "",
            `uci -q delete firewall.${section} || true`,
            "uci commit firewall", "",
            "fw4 print >/dev/null || {",
            "    echo \"ERROR: firewall configuration validation failed after Revert\"",
            "    exit 1",
            "}",
            "/etc/init.d/firewall reload", "",
            `if uci -q get firewall.${section} >/dev/null 2>&1; then`,
            `    echo ${utils.shellSingleQuote(`ERROR: firewall.${section} still exists`)}`,
            "    exit 1",
            "fi",
            `echo ${utils.shellSingleQuote(`PASS: firewall.${section} removed`)}`
        );

        return {
            commands, rollbackCommands, rollbackExact: true,
            rollbackNote: "Exact Revert: Apply refuses to overwrite an existing named firewall section.",
            summary, risks, errors, resources,
            meta: { kind, section, name, src, dest, srcIp, destIp, srcPort: srcPort || "", destPort: destPort || "", proto, target },
            plan: { title: `OpenWrt firewall ${name || section}`, platform: "openwrt", task: "firewall", order: 50, mutating: true }
        };
    }

    return { generate };
})();
