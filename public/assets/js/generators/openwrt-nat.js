window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtNat = (() => {
    function validPort(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d+)(?:-(\d+))?$/);
        if (!match) return false;
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : start;
        return start >= 1 && start <= 65535 && end >= start && end <= 65535;
    }

    function currentZoneMasq(context, section) {
        const current = NCH.importer.getUciSection(context?.currentState, "firewall", section);
        if (!current || current.type !== "zone") return { known: false, value: undefined };
        return { known: true, value: current.options?.masq };
    }

    function generate(values, context = {}) {
        const utils = NCH.utils;
        const commands = [];
        const rollbackCommands = [];
        const summary = [];
        const risks = [];
        const errors = [];
        const resources = [];

        const mode = ["port-forward", "masquerade", "snat", "zone-masq"].includes(values.nMode) ? values.nMode : "port-forward";
        const section = utils.uciSection(values.nSection, "nch_nat");
        const name = String(values.nName || "Network Command Helper NAT").trim();
        const src = utils.uciSection(values.nSrcZone, "wan");
        const dest = utils.uciSection(values.nDestZone, "lan");
        const srcIp = String(values.nSrcIp || "").trim();
        const srcPort = String(values.nSrcPort || "").trim();
        const destIp = String(values.nDestIp || "").trim();
        const destPort = String(values.nDestPort || "").trim();
        const requestedProto = String(values.nProto || "tcp");
        const proto = ["tcp", "udp", "tcp udp"].includes(requestedProto) ? requestedProto : "tcp";
        const sourceCidr = String(values.nSourceCidr || "").trim();
        const snatIp = String(values.nSnatIp || "").trim();
        const device = String(values.nDevice || "").trim();
        const zoneSection = utils.safeToken(values.nZoneSection, "wan");
        const apply = values.nApply !== false;
        const verify = values.nVerify !== false;
        let rollbackExact = true;
        let rollbackNote = "Exact Revert: named NAT/redirect section is collision-checked before Apply.";

        commands.push("#!/bin/sh", "", `# NAT operation: ${mode}`, "");

        if (mode === "port-forward") {
            if (!["tcp", "udp", "tcp udp"].includes(requestedProto)) errors.push("Port forwarding protocol must be TCP, UDP, or TCP + UDP when port translation is configured.");
            if (srcIp && !utils.validIPv4(srcIp) && !utils.validCIDR(srcIp)) errors.push("Port-forward source IP must be IPv4 or CIDR.");
            if (!srcPort || !validPort(srcPort)) errors.push("External/source port must be a valid port or range.");
            if (!utils.validIPv4(destIp)) errors.push("Internal destination must be a valid IPv4 address.");
            if (!destPort || !validPort(destPort)) errors.push("Internal destination port must be a valid port or range.");

            commands.push(
                "# PRE-FLIGHT - SAFE ADDITIVE MODE", "",
                `if uci -q get firewall.${section} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: firewall.${section} already exists; refusing overwrite so Revert remains exact.`)}`,
                "    exit 1",
                "fi", "",
                "# DNAT / PORT FORWARD", "",
                `uci set firewall.${section}='redirect'`,
                `uci set firewall.${section}.name=${utils.shellSingleQuote(name)}`,
                `uci set firewall.${section}.src='${src}'`,
                `uci set firewall.${section}.src_dport=${utils.shellSingleQuote(srcPort)}`,
                `uci set firewall.${section}.dest='${dest}'`,
                `uci set firewall.${section}.dest_ip='${destIp}'`,
                `uci set firewall.${section}.dest_port=${utils.shellSingleQuote(destPort)}`,
                `uci set firewall.${section}.proto=${utils.shellSingleQuote(proto)}`,
                `uci set firewall.${section}.family='ipv4'`,
                `uci set firewall.${section}.target='DNAT'`
            );
            if (srcIp) commands.push(`uci set firewall.${section}.src_ip=${utils.shellSingleQuote(srcIp)}`);
            commands.push("");
            resources.push({ kind: "uci-section", platform: "openwrt", package: "firewall", section, type: "redirect", options: { name, src, ...(srcIp ? { src_ip: srcIp } : {}), src_dport: srcPort, dest, dest_ip: destIp, dest_port: destPort, proto, family: "ipv4", target: "DNAT" } });
            summary.push(`${src}:${srcPort} -> ${destIp}:${destPort}`);
            risks.push({ level: src === "wan" ? "high" : "medium", code: "PORT_FORWARD", message: `DNAT exposes ${destIp}:${destPort} from ${src}${src === "wan" ? "/WAN" : ""}.` });
        }

        if (mode === "masquerade" || mode === "snat") {
            if (!sourceCidr || !utils.validCIDR(sourceCidr)) errors.push("Selective NAT source must be a valid IPv4 CIDR.");
            if (mode === "snat" && !utils.validIPv4(snatIp)) errors.push("SNAT requires a valid translated IPv4 address.");
            commands.push(
                "# PRE-FLIGHT - SAFE ADDITIVE MODE", "",
                `if uci -q get firewall.${section} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: firewall.${section} already exists; refusing overwrite so Revert remains exact.`)}`,
                "    exit 1",
                "fi", "",
                mode === "masquerade" ? "# SELECTIVE MASQUERADE" : "# SOURCE NAT", "",
                `uci set firewall.${section}='nat'`,
                `uci set firewall.${section}.name=${utils.shellSingleQuote(name)}`,
                `uci set firewall.${section}.family='ipv4'`,
                `uci set firewall.${section}.proto='all'`,
                `uci set firewall.${section}.src='${src}'`,
                `uci set firewall.${section}.src_ip=${utils.shellSingleQuote(sourceCidr)}`,
                `uci set firewall.${section}.target='${mode === "masquerade" ? "MASQUERADE" : "SNAT"}'`
            );
            if (device) commands.push(`uci set firewall.${section}.device=${utils.shellSingleQuote(device)}`);
            if (mode === "snat") commands.push(`uci set firewall.${section}.snat_ip='${snatIp}'`);
            commands.push("");
            const options = { name, family: "ipv4", proto: "all", src, src_ip: sourceCidr, target: mode === "masquerade" ? "MASQUERADE" : "SNAT" };
            if (device) options.device = device;
            if (mode === "snat") options.snat_ip = snatIp;
            resources.push({ kind: "uci-section", platform: "openwrt", package: "firewall", section, type: "nat", options });
            summary.push(mode === "masquerade" ? `${sourceCidr} masqueraded via ${src}` : `${sourceCidr} SNAT -> ${snatIp}`);
            risks.push({ level: "medium", code: mode === "masquerade" ? "SELECTIVE_MASQ" : "SNAT", message: `${mode === "masquerade" ? "Masquerades" : "Source-NATs"} traffic from ${sourceCidr}.` });
        }

        if (mode === "zone-masq") {
            const current = currentZoneMasq(context, zoneSection);
            const sectionState = NCH.importer.getUciSection(context?.currentState, "firewall", zoneSection);
            if (context.currentState && (!sectionState || sectionState.type !== "zone")) errors.push(`Imported state does not contain firewall.${zoneSection} as a zone.`);
            commands.push(
                "# ZONE MASQUERADE", "",
                `if ! uci -q get firewall.${zoneSection} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: firewall.${zoneSection} does not exist.`)}`,
                "    exit 1",
                "fi",
                `uci set firewall.${zoneSection}.masq='1'`, ""
            );
            resources.push({ kind: "uci-section", platform: "openwrt", package: "firewall", section: zoneSection, type: "zone", options: { masq: "1" } });
            summary.push(`Enable masquerading on firewall.${zoneSection}`);
            risks.push({ level: "medium", code: "ZONE_MASQ", message: `Enables masquerading for forwarded IPv4 traffic using firewall zone ${zoneSection}.` });
            if (current.known) {
                rollbackCommands.push("#!/bin/sh", "", `# State-aware Revert for firewall.${zoneSection}.masq`);
                if (current.value === undefined) rollbackCommands.push(`uci -q delete firewall.${zoneSection}.masq || true`);
                else rollbackCommands.push(`uci set firewall.${zoneSection}.masq=${utils.shellSingleQuote(Array.isArray(current.value) ? current.value[0] : current.value)}`);
                rollbackCommands.push("uci commit firewall", "fw4 print >/dev/null || exit 1", "/etc/init.d/firewall reload", "", "echo 'PASS: previous zone masquerade state restored'");
                rollbackNote = "Exact Revert derived from imported OpenWrt current state.";
            } else {
                rollbackExact = false;
                rollbackNote = "Import current OpenWrt 'uci show firewall' state to generate an exact Revert for an existing zone option.";
            }
        }

        if (apply) {
            commands.push(
                "# COMMIT / VALIDATE / APPLY", "",
                "uci commit firewall",
                "fw4 print >/dev/null || {",
                "    echo \"ERROR: firewall configuration validation failed\"",
                "    exit 1",
                "}",
                "/etc/init.d/firewall reload", ""
            );
        }
        if (verify) {
            commands.push("# VERIFY", "");
            if (mode === "zone-masq") commands.push(`uci show firewall.${zoneSection}`);
            else commands.push(`uci show firewall.${section}`);
            commands.push("fw4 print", "nft list ruleset", "");
        }

        if (mode !== "zone-masq") {
            rollbackCommands.push(
                "#!/bin/sh", "",
                `# Exact Revert for firewall.${section}`,
                `uci -q delete firewall.${section} || true`,
                "uci commit firewall",
                "fw4 print >/dev/null || {",
                "    echo \"ERROR: firewall configuration validation failed after Revert\"",
                "    exit 1",
                "}",
                "/etc/init.d/firewall reload", "",
                `echo ${utils.shellSingleQuote(`PASS: firewall.${section} removed`)}`
            );
        }

        return {
            commands, rollbackCommands, rollbackExact,
            rollbackNote,
            summary, risks, errors, resources,
            meta: { mode, section, name, src, dest, srcIp, srcPort, destIp, destPort, proto, sourceCidr, snatIp, device, zoneSection },
            plan: { title: mode === "port-forward" ? `OpenWrt port forward ${srcPort} -> ${destIp}:${destPort}` : `OpenWrt NAT ${mode}`, platform: "openwrt", task: "nat", order: 50, mutating: true }
        };
    }

    return { generate };
})();
