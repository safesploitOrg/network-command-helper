window.NCH = window.NCH || {};
NCH.generators = NCH.generators || {};

NCH.generators.openwrtWireless = (() => {
    function validPsk(key) {
        const value = String(key || "");
        return (value.length >= 8 && value.length <= 63) || /^[0-9A-Fa-f]{64}$/.test(value);
    }

    function generate(values) {
        const utils = NCH.utils;
        const commands = [];
        const summary = [];
        const risks = [];
        const errors = [];

        const section = utils.uciSection(values.wSection, "wifi_network");
        const ssid = String(values.wSsid || "").trim();
        const mode = values.wMode === "dynamic" ? "dynamic" : "standard";
        const radio = utils.safeToken(values.wRadio, "radio1");
        const network = utils.uciSection(values.wNetwork, "lan");
        const encryption = ["psk2", "sae", "sae-mixed", "none"].includes(values.wEncryption) ? values.wEncryption : "psk2";
        const key = String(values.wKey || "");
        const hidden = Boolean(values.wHidden);
        const isolate = Boolean(values.wIsolate);
        const bridgeIsolate = Boolean(values.wBridgeIsolate);

        if (!ssid) {
            errors.push("SSID is required.");
        }

        commands.push(
            "#!/bin/sh",
            "",
            `# Wireless section: ${section}`,
            `# SSID:             ${ssid}`,
            `# Radio:            ${radio}`,
            `# Mode:             ${mode === "dynamic" ? "802.1X dynamic VLAN" : "static network BSS"}`,
            `# Client isolation: ${isolate ? "enabled" : "disabled"}`,
            `# Bridge isolation: ${bridgeIsolate ? "enabled" : "disabled"}`,
            "",
            "# ============================================================",
            "# WIRELESS BSS",
            "# ============================================================",
            "",
            `uci set wireless.${section}='wifi-iface'`,
            `uci set wireless.${section}.device='${radio}'`,
            `uci set wireless.${section}.mode='ap'`,
            `uci set wireless.${section}.ssid=${utils.shellSingleQuote(ssid)}`
        );

        if (mode === "standard") {
            commands.push(
                `uci set wireless.${section}.network='${network}'`,
                `uci set wireless.${section}.encryption='${encryption}'`
            );

            if (encryption === "none") {
                commands.push(`uci -q delete wireless.${section}.key || true`);
                risks.push({
                    level: "high",
                    code: "OPEN_WIFI",
                    message: "Creates an unencrypted/open wireless network."
                });
            } else {
                if (!validPsk(key)) {
                    errors.push("WPA2/WPA3 Personal requires an 8-63 character passphrase or a 64-character hexadecimal key.");
                }
                commands.push(`uci set wireless.${section}.key=${utils.shellSingleQuote(key)}`);
            }

            summary.push(`${ssid} -> ${network}`);
            risks.push({
                level: "low",
                code: "WIRELESS_BSS",
                message: `Creates/updates the ${ssid} wireless BSS.`
            });
        } else {
            const radiusServer = String(values.wRadiusServer || "").trim();
            const radiusPort = utils.clamp(values.wRadiusPort, 1, 65535, 1812);
            const radiusSecret = String(values.wRadiusSecret || "");
            const dynamicMode = ["1", "2"].includes(String(values.wDynamicMode)) ? String(values.wDynamicMode) : "1";
            const taggedInterface = utils.safeToken(values.wTaggedInterface, "eth2");
            const vlanBridge = utils.safeToken(values.wVlanBridge, "br-vlan");
            const vlanNaming = utils.safeToken(values.wVlanNaming, "0");

            if (!utils.validIPv4(radiusServer)) {
                errors.push("A valid IPv4 RADIUS server is required for dynamic VLAN mode.");
            }
            if (!radiusSecret) {
                errors.push("A RADIUS shared secret is required for dynamic VLAN mode.");
            }

            commands.push(
                `uci -q delete wireless.${section}.network || true`,
                `uci set wireless.${section}.encryption='wpa2'`,
                `uci set wireless.${section}.server=${utils.shellSingleQuote(radiusServer)}`,
                `uci set wireless.${section}.port='${radiusPort}'`,
                `uci set wireless.${section}.key=${utils.shellSingleQuote(radiusSecret)}`,
                `uci set wireless.${section}.dynamic_vlan='${dynamicMode}'`,
                `uci set wireless.${section}.vlan_tagged_interface='${taggedInterface}'`,
                `uci set wireless.${section}.vlan_bridge='${vlanBridge}'`,
                `uci set wireless.${section}.vlan_naming='${vlanNaming}'`
            );

            summary.push(`${ssid} -> RADIUS dynamic VLANs on ${taggedInterface}`);
            risks.push({
                level: "medium",
                code: "DYNAMIC_VLAN",
                message: "Enables RADIUS-driven dynamic VLAN assignment for the wireless BSS."
            });
        }

        commands.push(
            "",
            "# ============================================================",
            "# WIRELESS ISOLATION / VISIBILITY",
            "# ============================================================",
            "",
            `uci set wireless.${section}.isolate='${isolate ? "1" : "0"}'`,
            `uci set wireless.${section}.bridge_isolate='${bridgeIsolate ? "1" : "0"}'`,
            `uci set wireless.${section}.hidden='${hidden ? "1" : "0"}'`,
            ""
        );

        if (isolate) {
            risks.push({
                level: "low",
                code: "CLIENT_ISOLATION",
                message: "Wireless client isolation is enabled for this BSS."
            });
        }

        if (bridgeIsolate) {
            risks.push({
                level: "low",
                code: "BRIDGE_ISOLATION",
                message: "Bridge-wide wireless client isolation is enabled."
            });
        }

        if (values.wApply) {
            commands.push(
                "# ============================================================",
                "# COMMIT / APPLY",
                "# ============================================================",
                "",
                "uci commit wireless",
                "wifi reload",
                ""
            );

            risks.push({
                level: "medium",
                code: "WIFI_RELOAD",
                message: "Reloading Wi-Fi may briefly disconnect associated clients."
            });
        }

        if (values.wVerify) {
            commands.push(
                "# ============================================================",
                "# VERIFY",
                "# ============================================================",
                "",
                `uci show wireless.${section}`,
                "wifi status"
            );
        }

        return {
            commands,
            summary,
            risks,
            errors,
            meta: {
                section,
                ssid,
                mode,
                radio,
                network,
                encryption,
                isolate,
                bridgeIsolate
            }
        };
    }

    return { generate };
})();
