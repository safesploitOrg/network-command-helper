window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtVlan = (() => {
    const U = () => NCH.utils;

    function generate(values) {
        const utils = U();
        const commands = [];
        const summary = [];
        const risks = [];
        const errors = [];

        const vlan = utils.clamp(values.rVlan, 1, 4094, 45);
        const name = utils.safeName(values.rName, `vlan${vlan}`);
        const section = utils.uciSection(name, `vlan${vlan}`);
        const zone = utils.uciSection(values.rZone || section, section);
        const parent = utils.safeToken(values.rParent, "eth2");
        const switchDevice = utils.safeToken(values.rSwitch, "switch0");
        const switchPorts = utils.safeToken(values.rCpu, "0t");
        const bridge = utils.safeToken(values.rBridge, `br-vlan${vlan}`);
        const vlanDevice = `${parent}.${vlan}`;
        const subnet = String(values.rSubnet || "").trim();
        const gateway = String(values.rGw || "").trim();
        const dhcpStart = utils.clamp(values.rStart, 1, 254, 100);
        const dhcpLimit = utils.clamp(values.rLimit, 1, 253, 100);
        const lease = utils.safeToken(values.rLease, "12h");
        const inputPolicy = ["REJECT", "DROP", "ACCEPT"].includes(values.rInputPolicy) ? values.rInputPolicy : "REJECT";

        const rawAllow = utils.cidrList(values.rAllow);
        const rawDeny = utils.cidrList(values.rDeny);
        const allowCidrs = rawAllow.filter(utils.validCIDR);
        const denyCidrs = rawDeny.filter(utils.validCIDR);

        rawAllow.filter((cidr) => !utils.validCIDR(cidr)).forEach((cidr) => errors.push(`Invalid allowed CIDR: ${cidr}`));
        rawDeny.filter((cidr) => !utils.validCIDR(cidr)).forEach((cidr) => errors.push(`Invalid denied CIDR: ${cidr}`));

        if (!utils.validCIDR(subnet)) {
            errors.push("Invalid subnet CIDR.");
        }
        if (!utils.validIPv4(gateway)) {
            errors.push("Invalid gateway IPv4 address.");
        }

        const prefix = utils.validCIDR(subnet) ? subnet.split("/")[1] : "24";
        const netmask = utils.prefixToMask(prefix);

        summary.push(`VLAN ${vlan} / ${name}`);
        summary.push(`${subnet} via ${gateway}`);

        risks.push({
            level: "low",
            code: "CREATE_VLAN",
            message: `Creates/updates VLAN ${vlan} and its OpenWrt bridge/interface.`
        });

        if (vlan === 1) {
            risks.push({
                level: "high",
                code: "VLAN1_CHANGE",
                message: "VLAN 1 is commonly a native or management VLAN; changing it can interrupt connectivity."
            });
        }

        if (inputPolicy === "ACCEPT") {
            risks.push({
                level: "high",
                code: "ROUTER_INPUT_ACCEPT",
                message: `The ${zone} zone allows clients to reach OpenWrt services unless separately restricted.`
            });
        }

        if (values.rLan) {
            risks.push({
                level: "medium",
                code: "LAN_FORWARDING",
                message: `Allows ${zone} to initiate forwarding into the LAN zone.`
            });
        }

        if (allowCidrs.some((cidr) => Number(cidr.split("/")[1]) <= 16)) {
            risks.push({
                level: "medium",
                code: "BROAD_CIDR_ALLOW",
                message: "At least one broad internal CIDR allow rule is being generated."
            });
        }

        if (values.rApply) {
            risks.push({
                level: "medium",
                code: "NETWORK_RELOAD",
                message: "Commits UCI changes and reloads OpenWrt networking/firewall services."
            });
        }

        commands.push(
            "#!/bin/sh",
            "",
            `# VLAN ID:       ${vlan}`,
            `# Name:          ${name}`,
            `# Subnet:        ${subnet}`,
            `# Gateway:       ${gateway}`,
            `# DHCP:          start ${dhcpStart}, limit ${dhcpLimit}`,
            "",
            `# ${name} -> Internet               ${values.rWan ? "ALLOW" : "BLOCK"}`,
            `# ${name} -> LAN zone               ${values.rLan ? "ALLOW" : "BLOCK"}`,
            `# ${name} -> OpenWrt input          ${inputPolicy}`
        );

        allowCidrs.forEach((cidr) => commands.push(`# ${name} -> ${cidr.padEnd(25)} ALLOW`));
        denyCidrs.forEach((cidr) => commands.push(`# ${name} -> ${cidr.padEnd(25)} REJECT`));
        commands.push("");

        commands.push(
            "# ============================================================",
            "# SWITCH VLAN",
            "# ============================================================",
            "",
            `uci set network.vlan${vlan}_switch='switch_vlan'`,
            `uci set network.vlan${vlan}_switch.device='${switchDevice}'`,
            `uci set network.vlan${vlan}_switch.vlan='${vlan}'`,
            `uci set network.vlan${vlan}_switch.description=${utils.shellSingleQuote(name)}`,
            `uci set network.vlan${vlan}_switch.ports='${switchPorts}'`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# 802.1Q VLAN DEVICE",
            "# ============================================================",
            "",
            `uci set network.vlan${vlan}_dev='device'`,
            `uci set network.vlan${vlan}_dev.type='8021q'`,
            `uci set network.vlan${vlan}_dev.ifname='${parent}'`,
            `uci set network.vlan${vlan}_dev.vid='${vlan}'`,
            `uci set network.vlan${vlan}_dev.name='${vlanDevice}'`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# BRIDGE",
            "# ============================================================",
            "",
            `uci set network.br_vlan${vlan}_dev='device'`,
            `uci set network.br_vlan${vlan}_dev.type='bridge'`,
            `uci set network.br_vlan${vlan}_dev.name='${bridge}'`,
            `uci set network.br_vlan${vlan}_dev.bridge_empty='1'`,
            `uci -q delete network.br_vlan${vlan}_dev.ports || true`,
            `uci add_list network.br_vlan${vlan}_dev.ports='${vlanDevice}'`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# L3 INTERFACE",
            "# ============================================================",
            "",
            `uci set network.${section}='interface'`,
            `uci set network.${section}.proto='static'`,
            `uci set network.${section}.device='${bridge}'`,
            `uci set network.${section}.ipaddr='${gateway}'`,
            `uci set network.${section}.netmask='${netmask}'`,
            `uci -q delete network.${section}.gateway || true`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# DHCP",
            "# ============================================================",
            "",
            `uci set dhcp.${section}='dhcp'`,
            `uci set dhcp.${section}.interface='${section}'`,
            `uci set dhcp.${section}.start='${dhcpStart}'`,
            `uci set dhcp.${section}.limit='${dhcpLimit}'`,
            `uci set dhcp.${section}.leasetime='${lease}'`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# FIREWALL ZONE",
            "# ============================================================",
            "",
            `uci set firewall.${zone}='zone'`,
            `uci set firewall.${zone}.name='${zone}'`,
            `uci set firewall.${zone}.input='${inputPolicy}'`,
            `uci set firewall.${zone}.output='ACCEPT'`,
            `uci set firewall.${zone}.forward='REJECT'`,
            `uci -q delete firewall.${zone}.network || true`,
            `uci add_list firewall.${zone}.network='${section}'`,
            ""
        );

        commands.push(
            "# ============================================================",
            "# REMOVE PREVIOUS GENERATED RULES",
            "# ============================================================",
            "",
            `uci -q delete firewall.${zone}_wan || true`,
            `uci -q delete firewall.${zone}_lan || true`
        );

        for (let index = 1; index <= 12; index += 1) {
            commands.push(
                `uci -q delete firewall.${zone}_deny_${index} || true`,
                `uci -q delete firewall.${zone}_allow_${index} || true`
            );
        }

        commands.push(
            `uci -q delete firewall.${zone}_dhcp || true`,
            `uci -q delete firewall.${zone}_dns || true`,
            `uci -q delete firewall.${zone}_ping || true`,
            ""
        );

        if (denyCidrs.length) {
            commands.push(
                "# ============================================================",
                "# DENY CIDRS - emitted before broader allow rules",
                "# ============================================================",
                ""
            );

            denyCidrs.forEach((cidr, index) => {
                const rule = index + 1;
                commands.push(
                    `uci set firewall.${zone}_deny_${rule}='rule'`,
                    `uci set firewall.${zone}_deny_${rule}.name=${utils.shellSingleQuote(`Block-${name}-${cidr}`)}`,
                    `uci set firewall.${zone}_deny_${rule}.src='${zone}'`,
                    `uci set firewall.${zone}_deny_${rule}.dest='*'`,
                    `uci set firewall.${zone}_deny_${rule}.dest_ip='${cidr}'`,
                    `uci set firewall.${zone}_deny_${rule}.family='ipv4'`,
                    `uci set firewall.${zone}_deny_${rule}.proto='all'`,
                    `uci set firewall.${zone}_deny_${rule}.target='REJECT'`,
                    ""
                );
            });
        }

        if (allowCidrs.length) {
            commands.push(
                "# ============================================================",
                "# ALLOW CIDRS",
                "# ============================================================",
                ""
            );

            allowCidrs.forEach((cidr, index) => {
                const rule = index + 1;
                commands.push(
                    `uci set firewall.${zone}_allow_${rule}='rule'`,
                    `uci set firewall.${zone}_allow_${rule}.name=${utils.shellSingleQuote(`Allow-${name}-${cidr}`)}`,
                    `uci set firewall.${zone}_allow_${rule}.src='${zone}'`,
                    `uci set firewall.${zone}_allow_${rule}.dest='*'`,
                    `uci set firewall.${zone}_allow_${rule}.dest_ip='${cidr}'`,
                    `uci set firewall.${zone}_allow_${rule}.family='ipv4'`,
                    `uci set firewall.${zone}_allow_${rule}.proto='all'`,
                    `uci set firewall.${zone}_allow_${rule}.target='ACCEPT'`,
                    ""
                );
            });
        }

        if (values.rWan) {
            commands.push(
                "# ============================================================",
                "# ALLOW ZONE -> WAN",
                "# ============================================================",
                "",
                `uci set firewall.${zone}_wan='forwarding'`,
                `uci set firewall.${zone}_wan.src='${zone}'`,
                `uci set firewall.${zone}_wan.dest='wan'`,
                ""
            );
        }

        if (values.rLan) {
            commands.push(
                "# ============================================================",
                "# ALLOW ZONE -> LAN",
                "# ============================================================",
                "",
                `uci set firewall.${zone}_lan='forwarding'`,
                `uci set firewall.${zone}_lan.src='${zone}'`,
                `uci set firewall.${zone}_lan.dest='lan'`,
                ""
            );
        }

        if (values.rDhcp) {
            commands.push(
                "# ============================================================",
                "# ALLOW DHCP TO OPENWRT",
                "# ============================================================",
                "",
                `uci set firewall.${zone}_dhcp='rule'`,
                `uci set firewall.${zone}_dhcp.name=${utils.shellSingleQuote(`Allow-DHCP-${name}`)}`,
                `uci set firewall.${zone}_dhcp.src='${zone}'`,
                `uci set firewall.${zone}_dhcp.family='ipv4'`,
                `uci set firewall.${zone}_dhcp.proto='udp'`,
                `uci set firewall.${zone}_dhcp.dest_port='67'`,
                `uci set firewall.${zone}_dhcp.target='ACCEPT'`,
                ""
            );
        }

        if (values.rDns) {
            commands.push(
                "# ============================================================",
                "# ALLOW DNS TO OPENWRT",
                "# ============================================================",
                "",
                `uci set firewall.${zone}_dns='rule'`,
                `uci set firewall.${zone}_dns.name=${utils.shellSingleQuote(`Allow-DNS-${name}`)}`,
                `uci set firewall.${zone}_dns.src='${zone}'`,
                `uci set firewall.${zone}_dns.family='ipv4'`,
                `uci set firewall.${zone}_dns.proto='tcp udp'`,
                `uci set firewall.${zone}_dns.dest_port='53'`,
                `uci set firewall.${zone}_dns.target='ACCEPT'`,
                ""
            );
        }

        if (values.rPing) {
            commands.push(
                "# ============================================================",
                "# ALLOW ICMP/PING TO OPENWRT GATEWAY",
                "# ============================================================",
                "",
                `uci set firewall.${zone}_ping='rule'`,
                `uci set firewall.${zone}_ping.name=${utils.shellSingleQuote(`Allow-Ping-${name}`)}`,
                `uci set firewall.${zone}_ping.src='${zone}'`,
                `uci set firewall.${zone}_ping.family='ipv4'`,
                `uci set firewall.${zone}_ping.proto='icmp'`,
                `uci set firewall.${zone}_ping.icmp_type='echo-request'`,
                `uci set firewall.${zone}_ping.target='ACCEPT'`,
                ""
            );
        }

        if (values.rApply) {
            commands.push(
                "# ============================================================",
                "# COMMIT / VALIDATE / APPLY",
                "# ============================================================",
                "",
                "uci commit network",
                "uci commit dhcp",
                "uci commit firewall",
                "",
                "fw4 print >/dev/null || {",
                "    echo \"ERROR: firewall configuration validation failed\"",
                "    exit 1",
                "}",
                "",
                "/etc/init.d/network reload",
                "/etc/init.d/dnsmasq restart",
                "/etc/init.d/firewall reload",
                ""
            );
        }

        if (values.rVerify) {
            commands.push(
                "# ============================================================",
                "# VERIFY",
                "# ============================================================",
                "",
                `uci show network.${section}`,
                `uci show network.vlan${vlan}_dev`,
                `uci show network.br_vlan${vlan}_dev`,
                `uci show dhcp.${section}`,
                `uci show firewall.${zone}`
            );

            denyCidrs.forEach((_, index) => commands.push(`uci show firewall.${zone}_deny_${index + 1}`));
            allowCidrs.forEach((_, index) => commands.push(`uci show firewall.${zone}_allow_${index + 1}`));

            if (values.rWan) {
                commands.push(`uci show firewall.${zone}_wan`);
            }
            if (values.rLan) {
                commands.push(`uci show firewall.${zone}_lan`);
            }

            commands.push(
                "",
                `fw4 print | grep -i -C 4 ${utils.shellSingleQuote(name)}`,
                `nft list ruleset | grep -i -C 4 ${utils.shellSingleQuote(name)}`
            );
        }

        return {
            commands,
            summary,
            risks,
            errors,
            meta: {
                vlan,
                name,
                subnet,
                gateway,
                section,
                zone,
                parent,
                vlanDevice,
                bridge,
                inputPolicy,
                allowCidrs,
                denyCidrs
            }
        };
    }

    return { generate };
})();
