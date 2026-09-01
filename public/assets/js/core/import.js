window.NCH = window.NCH || {};

NCH.importer = (() => {
    function decodeUciValue(raw) {
        let value = String(raw ?? "").trim();
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }
        return value.replace(/'"'"'/g, "'");
    }

    function putOption(section, option, value) {
        if (!Object.prototype.hasOwnProperty.call(section.options, option)) {
            section.options[option] = value;
            return;
        }
        if (!Array.isArray(section.options[option])) section.options[option] = [section.options[option]];
        section.options[option].push(value);
    }

    function parseOpenWrt(text) {
        const state = {
            platform: "openwrt",
            format: "uci-show",
            packages: {},
            errors: [],
            warnings: [],
            raw: String(text || ""),
            coverage: { packages: [] }
        };

        const lines = state.raw.split(/\r?\n/);
        let parsed = 0;

        lines.forEach((original, index) => {
            const line = original.trim();
            if (!line || line.startsWith("#")) return;
            const match = line.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_@\[\]-]+)(?:\.([A-Za-z0-9_-]+))?=(.*)$/);
            if (!match) return;
            const [, pkg, sectionName, option, rawValue] = match;
            const value = decodeUciValue(rawValue);
            state.packages[pkg] = state.packages[pkg] || {};
            state.packages[pkg][sectionName] = state.packages[pkg][sectionName] || { type: "", options: {}, line: index + 1 };
            const section = state.packages[pkg][sectionName];
            if (!option) section.type = value;
            else putOption(section, option, value);
            parsed += 1;
        });

        state.coverage.packages = Object.keys(state.packages);
        if (!parsed) state.errors.push("No OpenWrt 'uci show' entries were recognised.");
        return state;
    }

    function ensureInterface(state, port) {
        state.interfaces[port] = state.interfaces[port] || {
            description: "",
            pvid: null,
            tagged: [],
            untagged: [],
            speed: "",
            flowcontrol: "",
            shutdown: false,
            lag: null,
            lagMode: ""
        };
        return state.interfaces[port];
    }

    function addVlans(list, values) {
        NCH.utils.parseVlanList(values).forEach((vlan) => list.push(vlan));
        return NCH.utils.unique(list).sort((a, b) => a - b);
    }

    function parseNetgear(text) {
        const state = {
            platform: "netgear",
            format: "running-config",
            global: {},
            vlans: {},
            interfaces: {},
            lags: {},
            errors: [],
            warnings: [],
            raw: String(text || ""),
            coverage: { full: false, interfaces: [], vlans: [], lags: [] }
        };

        state.coverage.full = /(^|\n)!\s*Model\s*:/i.test(state.raw);
        const lines = state.raw.split(/\r?\n/);
        let context = { type: "global", id: "" };
        let recognised = 0;

        lines.forEach((original) => {
            const line = original.trim();
            if (!line || line.startsWith("!") || /^[A-Za-z0-9_.-]+[>#]$/.test(line)) return;

            let match = line.match(/^vlan\s+(.+)$/i);
            if (match) {
                const vlans = NCH.utils.parseVlanList(match[1]);
                vlans.forEach((vlan) => { state.vlans[vlan] = state.vlans[vlan] || { name: "" }; });
                context = { type: "vlan", ids: vlans };
                recognised += 1;
                return;
            }

            match = line.match(/^interface\s+range\s+(.+)$/i);
            if (match) {
                const ports = NCH.utils.expandGigabitPorts(match[1], 52);
                ports.forEach((port) => ensureInterface(state, port));
                context = { type: "interfaces", ids: ports };
                recognised += 1;
                return;
            }

            match = line.match(/^interface\s+(?:GigabitEthernet\s*)?(g?\d+)$/i);
            if (match) {
                const port = `g${Number(match[1].replace(/^g/i, ""))}`;
                ensureInterface(state, port);
                context = { type: "interfaces", ids: [port] };
                recognised += 1;
                return;
            }

            match = line.match(/^interface\s+LAG\s+(\d+)$/i);
            if (match) {
                const lagId = Number(match[1]);
                state.lags[lagId] = state.lags[lagId] || { type: "", members: [] };
                context = { type: "lag", id: lagId };
                recognised += 1;
                return;
            }

            if (/^(exit|end)$/i.test(line)) {
                context = { type: "global", id: "" };
                return;
            }

            if (context.type === "vlan") {
                match = line.match(/^name\s+(.+)$/i);
                if (match) {
                    context.ids.forEach((vlan) => { state.vlans[vlan].name = match[1].replace(/^"|"$/g, ""); });
                    recognised += 1;
                    return;
                }
            }

            if (context.type === "interfaces") {
                const ports = context.ids;
                match = line.match(/^description\s+(.+)$/i);
                if (match) {
                    ports.forEach((port) => { ensureInterface(state, port).description = match[1].replace(/^"|"$/g, ""); });
                    recognised += 1;
                    return;
                }
                match = line.match(/^switchport\s+hybrid\s+pvid\s+(\d+)$/i);
                if (match) {
                    ports.forEach((port) => { ensureInterface(state, port).pvid = Number(match[1]); });
                    recognised += 1;
                    return;
                }
                match = line.match(/^switchport\s+hybrid\s+allowed\s+vlan\s+add\s+([^\s]+)(?:\s+(tagged|untagged))?$/i);
                if (match) {
                    const membership = (match[2] || "tagged").toLowerCase();
                    ports.forEach((port) => {
                        const iface = ensureInterface(state, port);
                        iface[membership] = addVlans(iface[membership], match[1]);
                    });
                    recognised += 1;
                    return;
                }
                match = line.match(/^speed\s+(.+)$/i);
                if (match) {
                    ports.forEach((port) => { ensureInterface(state, port).speed = match[1]; });
                    recognised += 1;
                    return;
                }
                match = line.match(/^flowcontrol\s+(auto|asymmetric|symmetric|off)$/i);
                if (match) {
                    ports.forEach((port) => { ensureInterface(state, port).flowcontrol = match[1].toLowerCase(); });
                    recognised += 1;
                    return;
                }
                if (/^shutdown$/i.test(line)) {
                    ports.forEach((port) => { ensureInterface(state, port).shutdown = true; });
                    recognised += 1;
                    return;
                }
                match = line.match(/^lag\s+(\d+)\s+mode\s+(static|active|passive)$/i);
                if (match) {
                    const lagId = Number(match[1]);
                    const mode = match[2].toLowerCase();
                    state.lags[lagId] = state.lags[lagId] || { type: mode === "static" ? "static" : "lacp", members: [] };
                    ports.forEach((port) => {
                        const iface = ensureInterface(state, port);
                        iface.lag = lagId;
                        iface.lagMode = mode;
                        if (!state.lags[lagId].members.includes(port)) state.lags[lagId].members.push(port);
                    });
                    recognised += 1;
                    return;
                }
            }

            if (context.type === "lag") {
                match = line.match(/^lag\s+type\s+(lacp|static)$/i);
                if (match) {
                    state.lags[context.id].type = match[1].toLowerCase();
                    recognised += 1;
                    return;
                }
            }

            match = line.match(/^management-vlan\s+vlan\s+(\d+)$/i);
            if (match) { state.global.managementVlan = Number(match[1]); recognised += 1; return; }
            match = line.match(/^ip\s+address\s+(\S+)\s+mask\s+(\S+)$/i);
            if (match) { state.global.ipAddress = match[1]; state.global.netmask = match[2]; recognised += 1; return; }
            match = line.match(/^ip\s+default-gateway\s+(\S+)$/i);
            if (match) { state.global.defaultGateway = match[1]; recognised += 1; return; }
            match = line.match(/^system\s+name\s+(.+)$/i);
            if (match) { state.global.systemName = match[1]; recognised += 1; }
        });

        if (!recognised) state.errors.push("No supported NETGEAR running-config lines were recognised.");
        state.coverage.interfaces = Object.keys(state.interfaces);
        state.coverage.vlans = Object.keys(state.vlans).map(Number);
        state.coverage.lags = Object.keys(state.lags).map(Number);
        Object.values(state.interfaces).forEach((iface) => {
            if (iface.pvid === null) iface.pvid = 1;
            if (!iface.speed) iface.speed = "auto 10/100/1000";
            if (!iface.flowcontrol) iface.flowcontrol = "off";
        });
        return state;
    }

    function detect(text) {
        const raw = String(text || "");
        if (/^(?:network|firewall|dhcp|wireless)\.[^=]+=/.test(raw.trim()) || /\n(?:network|firewall|dhcp|wireless)\.[^=]+=/.test(raw)) return "openwrt";
        if (/\binterface\s+(?:range\s+)?g\d+/i.test(raw) || /\bvlan\s+\d+/i.test(raw) || /\bshow running-config\b/i.test(raw)) return "netgear";
        return "unknown";
    }

    function parse(text, format = "auto") {
        const selected = format === "auto" ? detect(text) : format;
        if (selected === "openwrt" || selected === "openwrt-uci") return parseOpenWrt(text);
        if (selected === "netgear" || selected === "netgear-running") return parseNetgear(text);
        return { platform: "unknown", format: "unknown", errors: ["Could not detect configuration format."], warnings: [], raw: String(text || "") };
    }

    function getUciSection(state, pkg, section) {
        return state?.platform === "openwrt" ? state.packages?.[pkg]?.[section] || null : null;
    }

    return { parse, parseOpenWrt, parseNetgear, detect, getUciSection };
})();
