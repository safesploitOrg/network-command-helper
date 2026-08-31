window.NCH = window.NCH || {};

NCH.app = (() => {
    const $ = (id) => document.getElementById(id);
    const DEFAULTS = NCH.config.defaults;

    let appState = {
        ...DEFAULTS.app
    };

    function collect(defaults) {
        const values = {};

        Object.keys(defaults).forEach((id) => {
            const element = $(id);
            if (!element) {
                return;
            }
            values[id] = element.type === "checkbox" ? element.checked : element.value;
        });

        return values;
    }

    function applyValues(values) {
        Object.entries(values || {}).forEach(([id, value]) => {
            const element = $(id);
            if (!element) {
                return;
            }

            if (element.type === "checkbox") {
                element.checked = Boolean(value);
            } else {
                element.value = value;
            }
        });
    }

    function currentSnapshot() {
        return {
            app: {
                ...appState,
                preset: $("owPreset").value
            },
            openwrtVlan: collect(DEFAULTS.openwrtVlan),
            openwrtWireless: collect(DEFAULTS.openwrtWireless),
            netgear: collect(DEFAULTS.netgear)
        };
    }

    function persist() {
        NCH.state.write(currentSnapshot());
    }

    function restore() {
        const saved = NCH.state.read();
        if (!saved) {
            applyValues(DEFAULTS.openwrtVlan);
            applyValues(DEFAULTS.openwrtWireless);
            applyValues(DEFAULTS.netgear);
            return;
        }

        appState = {
            ...DEFAULTS.app,
            ...(saved.app || {})
        };

        applyValues({ ...DEFAULTS.openwrtVlan, ...(saved.openwrtVlan || {}) });
        applyValues({ ...DEFAULTS.openwrtWireless, ...(saved.openwrtWireless || {}) });
        applyValues({ ...DEFAULTS.netgear, ...(saved.netgear || {}) });

        $("owPreset").value = saved.app?.preset || "custom";
    }

    function setLevel(level, shouldRender = true) {
        if (!NCH.config.levels.includes(level)) {
            level = "simple";
        }

        appState.level = level;
        document.body.classList.remove("level-simple", "level-advanced", "level-expert");
        document.body.classList.add(`level-${level}`);

        document.querySelectorAll("[data-level-button]").forEach((button) => {
            button.classList.toggle("active", button.dataset.levelButton === level);
        });

        if (shouldRender) {
            render();
        }
    }

    function setDevice(device, shouldRender = true) {
        appState.device = device === "netgear" ? "netgear" : "openwrt";

        $("openwrtWorkspace").classList.toggle("hidden", appState.device !== "openwrt");
        $("netgearWorkspace").classList.toggle("hidden", appState.device !== "netgear");
        $("openwrtVisual").classList.toggle("hidden", appState.device !== "openwrt");
        $("netgearVisual").classList.toggle("hidden", appState.device !== "netgear");

        document.querySelectorAll("[data-device]").forEach((button) => {
            button.classList.toggle("active", button.dataset.device === appState.device);
        });

        if (appState.device === "openwrt") {
            $("formTitle").textContent = "OpenWrt";
            $("formSubtitle").textContent = "VLAN, firewall, DHCP and wireless generation";
        } else {
            $("formTitle").textContent = "NETGEAR Switch";
            $("formSubtitle").textContent = "VLAN, access-port and hybrid/trunk generation";
        }

        if (shouldRender) {
            render();
        }
    }

    function setOpenWrtTask(task, shouldRender = true) {
        appState.openwrtTask = task === "wireless" ? "wireless" : "vlan";

        $("openwrtVlanForm").classList.toggle("hidden", appState.openwrtTask !== "vlan");
        $("openwrtWirelessForm").classList.toggle("hidden", appState.openwrtTask !== "wireless");

        document.querySelectorAll("[data-openwrt-task]").forEach((button) => {
            button.classList.toggle("active", button.dataset.openwrtTask === appState.openwrtTask);
        });

        if (shouldRender) {
            render();
        }
    }

    function syncWirelessMode() {
        const dynamic = $("wMode").value === "dynamic";
        $("wirelessStandardFields").classList.toggle("hidden", dynamic);
        $("wirelessDynamicFields").classList.toggle("hidden", !dynamic);

        const encryption = $("wEncryption").value;
        $("wKeyField").classList.toggle("hidden", encryption === "none");
    }

    function applyPreset(name) {
        if (name === "custom") {
            render();
            return;
        }

        const preset = NCH.presets.openwrt.get(name);
        if (!preset) {
            return;
        }

        if (preset.vlan) {
            applyValues(preset.vlan);
        }
        if (preset.wireless) {
            applyValues(preset.wireless);
        }
        if (preset.task) {
            setOpenWrtTask(preset.task, false);
        }

        syncWirelessMode();
        render();
    }

    function currentResult() {
        if (appState.device === "netgear") {
            return NCH.generators.netgear.generate(collect(DEFAULTS.netgear));
        }

        if (appState.openwrtTask === "wireless") {
            return NCH.generators.openwrtWireless.generate(collect(DEFAULTS.openwrtWireless));
        }

        return NCH.generators.openwrtVlan.generate(collect(DEFAULTS.openwrtVlan));
    }

    function pill(text, className) {
        const element = document.createElement("span");
        element.className = `pill ${className || ""}`.trim();
        element.textContent = text;
        return element;
    }

    function renderOpenWrtVisual(result) {
        const pills = $("visualPills");
        pills.replaceChildren();

        if (appState.openwrtTask === "wireless") {
            const meta = result.meta;
            $("visualSource").textContent = meta.ssid || "Wireless BSS";
            $("visualSourceDetail").textContent = meta.mode === "dynamic" ? "802.1X / RADIUS dynamic VLAN" : `Static network: ${meta.network}`;
            $("visualLinkA").textContent = meta.radio;
            $("visualLinkB").textContent = meta.mode === "dynamic" ? "dynamic VLAN" : "Wi-Fi BSS";
            $("visualTarget").textContent = "OpenWrt Wireless";
            $("visualTargetDetail").textContent = meta.mode === "dynamic" ? "RADIUS assigns client VLANs" : `${meta.encryption} → ${meta.network}`;

            pills.appendChild(pill(meta.isolate ? "client isolated" : "client-to-client allowed", meta.isolate ? "good" : "warn"));
            pills.appendChild(pill(meta.bridgeIsolate ? "bridge isolated" : "bridge isolation off", meta.bridgeIsolate ? "good" : "warn"));
            pills.appendChild(pill(meta.mode === "dynamic" ? "802.1X" : meta.encryption, "good"));
            return;
        }

        const meta = result.meta;
        const values = collect(DEFAULTS.openwrtVlan);
        $("visualSource").textContent = `VLAN ${meta.vlan} / ${meta.name}`;
        $("visualSourceDetail").textContent = `${meta.subnet} · GW ${meta.gateway}`;
        $("visualLinkA").textContent = "802.1Q";
        $("visualLinkB").textContent = "firewall";
        $("visualTarget").textContent = "OpenWrt";
        $("visualTargetDetail").textContent = `${meta.vlanDevice} → ${meta.bridge} → ${meta.zone}`;

        pills.appendChild(pill(values.rWan ? "WAN allowed" : "WAN blocked", values.rWan ? "good" : "bad"));
        pills.appendChild(pill(values.rLan ? "LAN allowed" : "LAN blocked", values.rLan ? "warn" : "good"));
        pills.appendChild(pill(`INPUT ${meta.inputPolicy}`, meta.inputPolicy === "ACCEPT" ? "bad" : "good"));
        meta.denyCidrs.slice(0, 2).forEach((cidr) => pills.appendChild(pill(`${cidr} blocked`, "bad")));
        meta.allowCidrs.slice(0, 2).forEach((cidr) => pills.appendChild(pill(`${cidr} allowed`, "good")));
    }

    function renderNetgearVisual(result) {
        $("switchVisualPort").textContent = `NETGEAR ${result.meta.port}`;
        $("switchVisualNative").textContent = `Native VLAN ${result.meta.native}`;
        $("switchVisualTagged").textContent = result.meta.taggedRaw ? `tagged ${result.meta.taggedRaw}` : "no tagged VLANs";
        $("switchVisualTask").textContent = result.meta.task === "trunk" ? "Hybrid/trunk" : result.meta.task === "access" ? "Access port" : "VLAN definitions only";
    }

    function renderRisk(result) {
        const assessment = NCH.risk.assess(result.risks);
        const badge = $("riskBadge");

        badge.className = `risk-badge ${assessment.level}`;
        badge.textContent = assessment.level.toUpperCase();
        $("riskTitle").textContent = assessment.title;

        const list = $("riskList");
        list.replaceChildren();
        assessment.reasons.slice(0, 5).forEach((reason) => {
            const item = document.createElement("li");
            item.textContent = reason.message;
            list.appendChild(item);
        });
    }

    function render() {
        syncWirelessMode();
        const result = currentResult();

        $("output").textContent = result.commands.join("\n");

        if (result.errors.length) {
            $("status").textContent = result.errors.join(" ");
            $("status").style.color = "var(--bad)";
        } else {
            $("status").textContent = "Validated locally";
            $("status").style.color = "var(--muted)";
        }

        if (appState.device === "openwrt") {
            renderOpenWrtVisual(result);
        } else {
            renderNetgearVisual(result);
        }

        renderRisk(result);
        persist();
    }

    async function copyCommands() {
        const text = $("output").textContent;
        let copied = false;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                copied = true;
            }
        } catch (_) {
            copied = false;
        }

        if (!copied) {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "absolute";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();

            try {
                copied = document.execCommand("copy");
            } catch (_) {
                copied = false;
            }

            textarea.remove();
        }

        $("copy").textContent = copied ? "Copied" : "Select & copy";
        window.setTimeout(() => {
            $("copy").textContent = "Copy commands";
        }, 1200);
    }

    function resetCurrent() {
        if (appState.device === "netgear") {
            applyValues(DEFAULTS.netgear);
        } else if (appState.openwrtTask === "wireless") {
            applyValues(DEFAULTS.openwrtWireless);
        } else {
            applyValues(DEFAULTS.openwrtVlan);
        }

        $("owPreset").value = "custom";
        syncWirelessMode();
        render();
    }

    function bindEvents() {
        document.querySelectorAll("[data-level-button]").forEach((button) => {
            button.addEventListener("click", () => setLevel(button.dataset.levelButton));
        });

        document.querySelectorAll("[data-device]").forEach((button) => {
            button.addEventListener("click", () => setDevice(button.dataset.device));
        });

        document.querySelectorAll("[data-openwrt-task]").forEach((button) => {
            button.addEventListener("click", () => setOpenWrtTask(button.dataset.openwrtTask));
        });

        $("owPreset").addEventListener("change", () => applyPreset($("owPreset").value));
        $("wMode").addEventListener("change", render);
        $("wEncryption").addEventListener("change", render);
        $("copy").addEventListener("click", copyCommands);
        $("reset").addEventListener("click", resetCurrent);

        document.querySelectorAll("input, select, textarea").forEach((element) => {
            if (["owPreset", "wMode", "wEncryption"].includes(element.id)) {
                return;
            }
            element.addEventListener("input", render);
            element.addEventListener("change", render);
        });
    }

    function initialise() {
        restore();
        bindEvents();
        setLevel(appState.level, false);
        setDevice(appState.device, false);
        setOpenWrtTask(appState.openwrtTask, false);
        syncWirelessMode();
        render();
    }

    initialise();

    return {
        render,
        setLevel,
        setDevice,
        setOpenWrtTask
    };
})();
