window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtDhcpDns = (() => {
    function csvIPv4(value, errors, label) {
        const entries = String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
        entries.filter((ip) => !NCH.utils.validIPv4(ip)).forEach((ip) => errors.push(`Invalid ${label} IPv4 address: ${ip}`));
        return entries.filter(NCH.utils.validIPv4);
    }

    function validMac(value) {
        return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(String(value || "").trim());
    }

    function addListApply(commands, key, value, label) {
        const utils = NCH.utils;
        const expr = `${key}=${value}`;
        commands.push(
            `if uci -q show ${utils.shellSingleQuote(key)} | grep -Fq -- ${utils.shellSingleQuote(value)}; then`,
            `    echo ${utils.shellSingleQuote(`ERROR: ${label} already exists; refusing duplicate so Revert remains exact.`)}`,
            "    exit 1",
            "fi",
            `uci add_list ${utils.shellSingleQuote(expr)}`
        );
    }

    function generate(values) {
        const utils = NCH.utils;
        const commands = [];
        const rollbackCommands = [];
        const summary = [];
        const risks = [];
        const errors = [];
        const resources = [];
        const mode = ["pool-options", "static-lease", "dns-forward", "host-record"].includes(values.dMode) ? values.dMode : "pool-options";
        const apply = values.dApply !== false;
        const verify = values.dVerify !== false;
        const rollbackList = [];
        let verifyTarget = "";

        commands.push("#!/bin/sh", "", `# DHCP / DNS operation: ${mode}`, "");

        if (mode === "pool-options") {
            const pool = utils.uciSection(values.dPool, "lan");
            const gateway = String(values.dGateway || "").trim();
            const dns = csvIPv4(values.dDnsServers, errors, "DNS");
            const ntp = csvIPv4(values.dNtpServers, errors, "NTP");
            const options = [];
            if (gateway) {
                if (!utils.validIPv4(gateway)) errors.push("Invalid DHCP gateway IPv4 address.");
                else options.push(`3,${gateway}`);
            }
            if (dns.length) options.push(`6,${dns.join(",")}`);
            if (ntp.length) options.push(`42,${ntp.join(",")}`);
            if (!options.length) errors.push("Provide at least one DHCP option: gateway, DNS or NTP.");

            commands.push(
                "# ============================================================",
                "# PRE-FLIGHT",
                "# ============================================================", "",
                `if ! uci -q get dhcp.${pool} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: DHCP pool dhcp.${pool} does not exist.`)}`,
                "    exit 1",
                "fi", "",
                "# ============================================================",
                "# DHCP OPTIONS",
                "# Option 3 = default gateway, 6 = DNS, 42 = NTP",
                "# ============================================================", ""
            );
            options.forEach((option) => {
                addListApply(commands, `dhcp.${pool}.dhcp_option`, option, `DHCP option ${option}`);
                rollbackList.push({ key: `dhcp.${pool}.dhcp_option`, value: option });
            });
            resources.push({ kind: "uci-list", platform: "openwrt", package: "dhcp", section: pool, option: "dhcp_option", values: options });
            commands.push("");
            summary.push(`DHCP options on ${pool}`);
            risks.push({ level: "medium", code: "DHCP_OPTIONS", message: `Changes client-advertised network settings on DHCP pool ${pool}.` });
            verifyTarget = `uci show dhcp.${pool}`;
        }

        if (mode === "static-lease") {
            const section = utils.uciSection(values.dLeaseSection, "nch_static_lease");
            const host = String(values.dHostName || "").trim();
            const mac = String(values.dMac || "").trim();
            const ip = String(values.dLeaseIp || "").trim();
            if (!host) errors.push("Static lease hostname is required.");
            if (!validMac(mac)) errors.push("Static lease requires a valid MAC address.");
            if (!utils.validIPv4(ip)) errors.push("Static lease requires a valid IPv4 address.");
            commands.push(
                "# ============================================================",
                "# PRE-FLIGHT - SAFE ADDITIVE MODE",
                "# ============================================================", "",
                `if uci -q get dhcp.${section} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: dhcp.${section} already exists; refusing overwrite so Revert remains exact.`)}`,
                "    exit 1",
                "fi", "",
                "# ============================================================",
                "# STATIC LEASE",
                "# ============================================================", "",
                `uci set dhcp.${section}='host'`,
                `uci set dhcp.${section}.name=${utils.shellSingleQuote(host)}`,
                `uci set dhcp.${section}.mac=${utils.shellSingleQuote(mac)}`,
                `uci set dhcp.${section}.ip=${utils.shellSingleQuote(ip)}`
            );
            if (values.dLeaseDns) commands.push(`uci set dhcp.${section}.dns='1'`);
            commands.push("");
            rollbackList.push({ section: `dhcp.${section}` });
            resources.push({ kind: "uci-section", platform: "openwrt", package: "dhcp", section, type: "host", options: { name: host, mac, ip, ...(values.dLeaseDns ? { dns: "1" } : {}) } });
            summary.push(`${host} -> ${ip}`);
            risks.push({ level: "low", code: "STATIC_LEASE", message: `Adds a named static DHCP lease for ${host}.` });
            verifyTarget = `uci show dhcp.${section}`;
        }

        if (mode === "dns-forward") {
            const dnsmasq = String(values.dDnsmasq || "@dnsmasq[0]").trim();
            const domain = String(values.dForwardDomain || "").trim().replace(/^\/+|\/+$/g, "");
            const servers = csvIPv4(values.dForwardServers, errors, "forwarder");
            if (!servers.length) errors.push("At least one DNS forwarder is required.");
            const entries = servers.map((server) => domain ? `/${domain}/${server}` : server);
            commands.push(
                "# ============================================================",
                "# PRE-FLIGHT",
                "# ============================================================", "",
                `if ! uci -q get ${utils.shellSingleQuote(`dhcp.${dnsmasq}`)} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: dnsmasq section dhcp.${dnsmasq} does not exist.`)}`,
                "    exit 1",
                "fi", "",
                "# ============================================================",
                domain ? `# CONDITIONAL DNS FORWARDING: ${domain}` : "# DNS FORWARDING",
                "# ============================================================", ""
            );
            entries.forEach((entry) => {
                addListApply(commands, `dhcp.${dnsmasq}.server`, entry, `DNS forwarder ${entry}`);
                rollbackList.push({ key: `dhcp.${dnsmasq}.server`, value: entry });
            });
            resources.push({ kind: "uci-list", platform: "openwrt", package: "dhcp", section: dnsmasq, option: "server", values: entries });
            commands.push("");
            summary.push(domain ? `${domain} -> ${servers.join(", ")}` : `DNS -> ${servers.join(", ")}`);
            risks.push({ level: "medium", code: "DNS_FORWARDING", message: domain ? `Changes DNS resolution for ${domain}.` : "Adds global DNS forwarders." });
            verifyTarget = `uci show ${utils.shellSingleQuote(`dhcp.${dnsmasq}`)}`;
        }

        if (mode === "host-record") {
            const section = utils.uciSection(values.dRecordSection, "nch_host_record");
            const host = String(values.dRecordName || "").trim();
            const ip = String(values.dRecordIp || "").trim();
            if (!host) errors.push("DNS host record name is required.");
            if (!utils.validIPv4(ip)) errors.push("DNS host record requires a valid IPv4 address.");
            commands.push(
                "# ============================================================",
                "# PRE-FLIGHT - SAFE ADDITIVE MODE",
                "# ============================================================", "",
                `if uci -q get dhcp.${section} >/dev/null 2>&1; then`,
                `    echo ${utils.shellSingleQuote(`ERROR: dhcp.${section} already exists; refusing overwrite so Revert remains exact.`)}`,
                "    exit 1",
                "fi", "",
                "# ============================================================",
                "# LOCAL DNS HOST RECORD",
                "# ============================================================", "",
                `uci set dhcp.${section}='hostrecord'`,
                `uci set dhcp.${section}.name=${utils.shellSingleQuote(host)}`,
                `uci set dhcp.${section}.ip=${utils.shellSingleQuote(ip)}`, ""
            );
            rollbackList.push({ section: `dhcp.${section}` });
            resources.push({ kind: "uci-section", platform: "openwrt", package: "dhcp", section, type: "hostrecord", options: { name: host, ip } });
            summary.push(`${host} -> ${ip}`);
            risks.push({ level: "low", code: "HOST_RECORD", message: `Adds a local DNS host record for ${host}.` });
            verifyTarget = `uci show dhcp.${section}`;
        }

        if (apply) {
            commands.push(
                "# ============================================================",
                "# COMMIT / APPLY",
                "# ============================================================", "",
                "uci commit dhcp",
                "/etc/init.d/dnsmasq restart", ""
            );
            risks.push({ level: "medium", code: "DNSMASQ_RESTART", message: "Restarts dnsmasq to apply DHCP/DNS changes." });
        }
        if (verify && verifyTarget) {
            commands.push("# ============================================================", "# VERIFY", "# ============================================================", "", verifyTarget, "");
        }

        rollbackCommands.push(
            "#!/bin/sh", "",
            "# Exact Revert for this Network Command Helper DHCP/DNS change.",
            "# Apply pre-flights collisions/duplicates so these inverse operations",
            "# remove only values or named sections introduced by this plan.", ""
        );
        rollbackList.slice().reverse().forEach((item) => {
            if (item.section) rollbackCommands.push(`uci -q delete ${item.section} || true`);
            if (item.key) rollbackCommands.push(`uci -q del_list ${utils.shellSingleQuote(`${item.key}=${item.value}`)} || true`);
        });
        rollbackCommands.push("", "uci commit dhcp", "/etc/init.d/dnsmasq restart", "", "echo 'PASS: DHCP/DNS Revert applied'");

        return {
            commands, rollbackCommands, rollbackExact: true,
            rollbackNote: "Exact Revert: named sections and list values are collision-checked before Apply.",
            summary, risks, errors, resources,
            meta: { mode },
            plan: { title: `OpenWrt DHCP/DNS ${mode}`, platform: "openwrt", task: "dhcpdns", order: 60, mutating: true }
        };
    }

    return { generate };
})();
