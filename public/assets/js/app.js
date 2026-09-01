window.NCH = window.NCH || {};

NCH.app = (() => {
    const $ = (id) => document.getElementById(id);
    const DEFAULTS = NCH.config.defaults;

    let appState = { ...DEFAULTS.app };
    let currentState = null;
    let pairStates = { sw01: null, sw02: null };
    let planItems = [];

    function collect(defaults) {
        const values = {};
        Object.keys(defaults).forEach((id) => {
            const element = $(id);
            if (!element) return;
            values[id] = element.type === "checkbox" ? element.checked : element.value;
        });
        return values;
    }

    function applyValues(values) {
        Object.entries(values || {}).forEach(([id, value]) => {
            const element = $(id);
            if (!element) return;
            if (element.type === "checkbox") element.checked = Boolean(value);
            else element.value = value;
        });
    }

    function currentSnapshot() {
        return {
            app: { ...appState, preset: $("owPreset").value },
            networkIntent: collect(DEFAULTS.networkIntent),
            openwrtVlan: collect(DEFAULTS.openwrtVlan),
            openwrtFirewall: collect(DEFAULTS.openwrtFirewall),
            openwrtDhcpDns: collect(DEFAULTS.openwrtDhcpDns),
            openwrtWireless: collect(DEFAULTS.openwrtWireless),
            openwrtRouting: collect(DEFAULTS.openwrtRouting),
            openwrtNat: collect(DEFAULTS.openwrtNat),
            netgear: collect(DEFAULTS.netgear),
            redundancy: collect(DEFAULTS.redundancy)
        };
    }

    function persist() { NCH.state.write(currentSnapshot()); }

    function restore() {
        const saved = NCH.state.read();
        const groups = ["networkIntent", "openwrtVlan", "openwrtFirewall", "openwrtDhcpDns", "openwrtWireless", "openwrtRouting", "openwrtNat", "netgear", "redundancy"];
        groups.forEach((group) => applyValues({ ...DEFAULTS[group], ...(saved?.[group] || {}) }));
        if (saved?.app) appState = { ...DEFAULTS.app, ...saved.app };
        $("owPreset").value = saved?.app?.preset || "custom";
        // Secrets and imported device configuration are deliberately never restored from localStorage.
        (NCH.config.secrets || []).forEach((id) => { if ($(id)) $(id).value = ""; });
    }

    function setLevel(level, shouldRender = true) {
        if (!NCH.config.levels.includes(level)) level = "simple";
        appState.level = level;
        document.body.classList.remove("level-simple", "level-advanced", "level-expert");
        document.body.classList.add(`level-${level}`);
        document.querySelectorAll("[data-level-button]").forEach((button) => button.classList.toggle("active", button.dataset.levelButton === level));
        if (shouldRender) render();
    }

    function setDevice(device, shouldRender = true) {
        appState.device = ["intent", "openwrt", "netgear", "redundancy"].includes(device) ? device : "intent";
        $("intentWorkspace").classList.toggle("hidden", appState.device !== "intent");
        $("openwrtWorkspace").classList.toggle("hidden", appState.device !== "openwrt");
        $("netgearWorkspace").classList.toggle("hidden", appState.device !== "netgear");
        $("redundancyWorkspace").classList.toggle("hidden", appState.device !== "redundancy");
        $("intentVisual").classList.toggle("hidden", appState.device !== "intent");
        $("openwrtVisual").classList.toggle("hidden", appState.device !== "openwrt");
        $("netgearVisual").classList.toggle("hidden", appState.device !== "netgear");
        $("redundancyVisual").classList.toggle("hidden", appState.device !== "redundancy");
        document.querySelectorAll("[data-device]").forEach((button) => button.classList.toggle("active", button.dataset.device === appState.device));
        if (appState.device === "intent") {
            $("formTitle").textContent = "Network Intent";
            $("formSubtitle").textContent = "Define one desired network and compile the device-specific implementation";
        } else if (appState.device === "openwrt") {
            $("formTitle").textContent = "OpenWrt";
            $("formSubtitle").textContent = "Network, security, services, routing and NAT generation";
        } else if (appState.device === "netgear") {
            $("formTitle").textContent = "NETGEAR GS108Tv3";
            $("formSubtitle").textContent = "VLAN, port, LAG/LACP, mirrored targets and diagnostics";
        } else {
            $("formTitle").textContent = "Switch Pair / Redundancy";
            $("formSubtitle").textContent = "Mirrored desired state, intentional exceptions, drift detection and remediation";
        }
        if (shouldRender) render();
    }

    function setOpenWrtTask(task, shouldRender = true) {
        const allowed = ["vlan", "firewall", "dhcpdns", "wireless", "routing", "nat"];
        appState.openwrtTask = allowed.includes(task) ? task : "vlan";
        const formMap = {
            vlan: "openwrtVlanForm",
            firewall: "openwrtFirewallForm",
            dhcpdns: "openwrtDhcpDnsForm",
            wireless: "openwrtWirelessForm",
            routing: "openwrtRoutingForm",
            nat: "openwrtNatForm"
        };
        Object.entries(formMap).forEach(([key, id]) => $(id).classList.toggle("hidden", appState.openwrtTask !== key));
        document.querySelectorAll("[data-openwrt-task]").forEach((button) => button.classList.toggle("active", button.dataset.openwrtTask === appState.openwrtTask));
        syncTaskFields();
        if (shouldRender) render();
    }

    function setOutputMode(mode, shouldRender = true) {
        appState.outputMode = mode === "rollback" ? "rollback" : "apply";
        if (shouldRender) render();
    }

    function setPreviewMode(mode, shouldRender = true) {
        appState.previewMode = mode === "plan" && planItems.length ? "plan" : "current";
        document.querySelectorAll("[data-preview-mode]").forEach((button) => button.classList.toggle("active", button.dataset.previewMode === appState.previewMode));
        if (shouldRender) render();
    }

    function syncWirelessMode() {
        const dynamic = $("wMode").value === "dynamic";
        $("wirelessStandardFields").classList.toggle("hidden", dynamic);
        $("wirelessDynamicFields").classList.toggle("hidden", !dynamic);
        $("wKeyField").classList.toggle("hidden", $("wEncryption").value === "none");
    }

    function syncFirewallMode() {
        const forwarding = $("fKind").value === "forwarding";
        $("firewallMatchFields").classList.toggle("hidden", forwarding);
        $("fNameField").classList.toggle("hidden", forwarding);
    }

    function syncDhcpDnsMode() {
        const mode = $("dMode").value;
        $("dhcpPoolFields").classList.toggle("hidden", mode !== "pool-options");
        $("dhcpLeaseFields").classList.toggle("hidden", mode !== "static-lease");
        $("dnsForwardFields").classList.toggle("hidden", mode !== "dns-forward");
        $("dnsHostFields").classList.toggle("hidden", mode !== "host-record");
    }

    function syncNatMode() {
        const mode = $("nMode").value;
        $("natPortForwardFields").classList.toggle("hidden", mode !== "port-forward");
        $("natSourceFields").classList.toggle("hidden", !["masquerade", "snat"].includes(mode));
        $("natZoneFields").classList.toggle("hidden", mode !== "zone-masq");
        $("nSnatIpField").classList.toggle("hidden", mode !== "snat");
        $("nSectionField").classList.toggle("hidden", mode === "zone-masq");
    }

    function syncNetgearMode() {
        const task = $("sTask").value;
        appState.netgearTask = task;
        $("netgearVlanFields").classList.toggle("hidden", !["trunk", "access", "vlans"].includes(task));
        $("netgearPortFields").classList.toggle("hidden", task !== "port");
        $("netgearLagFields").classList.toggle("hidden", task !== "lacp");
        $("netgearDiagFields").classList.toggle("hidden", task !== "diagnostics");
    }

    function syncTaskFields() {
        syncWirelessMode();
        syncFirewallMode();
        syncDhcpDnsMode();
        syncNatMode();
        syncNetgearMode();
    }

    function applyPreset(name) {
        if (name === "custom") { render(); return; }
        const preset = NCH.presets.openwrt.get(name);
        if (!preset) return;
        if (preset.vlan) applyValues(preset.vlan);
        if (preset.wireless) applyValues(preset.wireless);
        if (preset.task) setOpenWrtTask(preset.task, false);
        syncTaskFields();
        render();
    }

    function generatorContext() { return { currentState, pairStates, pairValues: collect(DEFAULTS.redundancy) }; }

    function currentResult() {
        if (appState.device === "intent") return NCH.intent.generateNetwork(collect(DEFAULTS.networkIntent), generatorContext());
        if (appState.device === "redundancy") {
            return NCH.redundancy.generateRemediation(pairStates, collect(DEFAULTS.redundancy));
        }
        if (appState.device === "netgear") {
            const values = collect(DEFAULTS.netgear);
            const target = values.sTarget || "single";
            if (target === "pair") return NCH.redundancy.generateMirroredNetgear(values, pairStates, collect(DEFAULTS.redundancy));
            const selectedState = target === "sw01" ? pairStates.sw01 : target === "sw02" ? pairStates.sw02 : currentState;
            return NCH.generators.netgear.generate(values, { currentState: selectedState });
        }
        if (appState.openwrtTask === "firewall") return NCH.generators.openwrtFirewall.generate(collect(DEFAULTS.openwrtFirewall), generatorContext());
        if (appState.openwrtTask === "dhcpdns") return NCH.generators.openwrtDhcpDns.generate(collect(DEFAULTS.openwrtDhcpDns), generatorContext());
        if (appState.openwrtTask === "wireless") return NCH.generators.openwrtWireless.generate(collect(DEFAULTS.openwrtWireless), generatorContext());
        if (appState.openwrtTask === "routing") return NCH.generators.openwrtRouting.generate(collect(DEFAULTS.openwrtRouting), generatorContext());
        if (appState.openwrtTask === "nat") return NCH.generators.openwrtNat.generate(collect(DEFAULTS.openwrtNat), generatorContext());
        return NCH.generators.openwrtVlan.generate(collect(DEFAULTS.openwrtVlan), generatorContext());
    }

    function displayResult() {
        if (appState.previewMode === "plan" && planItems.length) return NCH.plan.compile(planItems);
        return currentResult();
    }

    function pill(text, className) {
        const element = document.createElement("span");
        element.className = `pill ${className || ""}`.trim();
        element.textContent = text;
        return element;
    }

    function renderIntentVisual(result) {
        const meta = result.meta || {};
        $("intentVisualNetwork").textContent = `VLAN ${meta.vlan || "?"} / ${meta.name || "network"}`;
        $("intentVisualSubnet").textContent = `${meta.subnet || "subnet"}${meta.gateway ? ` · GW ${meta.gateway}` : ""}`;
        $("intentVisualSteps").textContent = `${meta.count || 0} target${meta.count === 1 ? "" : "s"}`;
        $("intentVisualDevices").textContent = (meta.devices || []).join(" + ") || "Choose target devices";
        const pills = $("intentVisualPills");
        pills.replaceChildren();
        pills.appendChild(pill(`${meta.count || 0} device steps`, meta.count ? "good" : "warn"));
        pills.appendChild(pill(result.rollbackExact ? "exact Revert" : "rollback gap", result.rollbackExact ? "good" : "warn"));
    }

    function renderOpenWrtVisual(result) {
        const pills = $("visualPills");
        pills.replaceChildren();
        const meta = result.meta || {};
        if (meta.plan) {
            $("visualSource").textContent = "Configuration Plan";
            $("visualSourceDetail").textContent = `${meta.count} dependency-ordered step${meta.count === 1 ? "" : "s"}`;
            $("visualLinkA").textContent = "desired state";
            $("visualLinkB").textContent = "runbook";
            $("visualTarget").textContent = "Multi-device change";
            $("visualTargetDetail").textContent = "Apply forward · Revert reverse";
            pills.appendChild(pill(`${meta.count} steps`, "good"));
            pills.appendChild(pill(result.rollbackExact ? "exact Revert" : "rollback gap", result.rollbackExact ? "good" : "warn"));
            return;
        }
        if (appState.openwrtTask === "routing") {
            $("visualSource").textContent = meta.target || "Static route";
            $("visualSourceDetail").textContent = `table ${meta.table || "main"} · metric ${meta.metric || "0"}`;
            $("visualLinkA").textContent = meta.iface || "interface";
            $("visualLinkB").textContent = meta.type || "route";
            $("visualTarget").textContent = meta.gateway || "link-scope";
            $("visualTargetDetail").textContent = "OpenWrt routing table";
            pills.appendChild(pill(meta.type || "unicast", meta.type === "unicast" ? "good" : "warn"));
            pills.appendChild(pill("exact additive Revert", "good"));
            return;
        }
        if (appState.openwrtTask === "nat") {
            $("visualSource").textContent = meta.mode === "port-forward" ? `${meta.src}:${meta.srcPort}` : (meta.sourceCidr || meta.zoneSection || "NAT");
            $("visualSourceDetail").textContent = meta.mode;
            $("visualLinkA").textContent = meta.proto || "all";
            $("visualLinkB").textContent = meta.mode === "port-forward" ? "DNAT" : "source NAT";
            $("visualTarget").textContent = meta.mode === "port-forward" ? `${meta.destIp}:${meta.destPort}` : (meta.snatIp || "translated source");
            $("visualTargetDetail").textContent = "firewall4 / nftables";
            pills.appendChild(pill(meta.mode, meta.mode === "port-forward" ? "warn" : "good"));
            return;
        }
        if (appState.openwrtTask === "firewall") {
            $("visualSource").textContent = meta.src || "OpenWrt";
            $("visualSourceDetail").textContent = meta.srcIp || "source zone / router";
            $("visualLinkA").textContent = meta.kind === "forwarding" ? "zone" : (meta.proto || "all");
            $("visualLinkB").textContent = meta.kind === "forwarding" ? "forwarding" : (meta.target || "rule");
            $("visualTarget").textContent = meta.dest || "OpenWrt";
            $("visualTargetDetail").textContent = meta.destIp || "destination zone / router";
            pills.appendChild(pill(meta.kind === "forwarding" ? "zone forwarding" : "traffic rule", "good"));
            if (meta.destPort) pills.appendChild(pill(`port ${meta.destPort}`, "warn"));
            pills.appendChild(pill("exact Revert", "good"));
            return;
        }
        if (appState.openwrtTask === "dhcpdns") {
            const labels = { "pool-options": "DHCP options", "static-lease": "Static lease", "dns-forward": "DNS forwarding", "host-record": "DNS host record" };
            $("visualSource").textContent = labels[meta.mode] || "DHCP / DNS";
            $("visualSourceDetail").textContent = result.summary?.[0] || "dnsmasq UCI";
            $("visualLinkA").textContent = "UCI";
            $("visualLinkB").textContent = "dnsmasq";
            $("visualTarget").textContent = "OpenWrt DHCP/DNS";
            $("visualTargetDetail").textContent = "collision-checked additive change";
            pills.appendChild(pill("exact Revert", "good"));
            pills.appendChild(pill("dnsmasq restart", "warn"));
            return;
        }
        if (appState.openwrtTask === "wireless") {
            $("visualSource").textContent = meta.ssid || "Wireless BSS";
            $("visualSourceDetail").textContent = meta.mode === "dynamic" ? "802.1X / RADIUS dynamic VLAN" : `Static network: ${meta.network}`;
            $("visualLinkA").textContent = meta.radio;
            $("visualLinkB").textContent = meta.mode === "dynamic" ? "dynamic VLAN" : "Wi-Fi BSS";
            $("visualTarget").textContent = "OpenWrt Wireless";
            $("visualTargetDetail").textContent = meta.mode === "dynamic" ? "RADIUS assigns client VLANs" : `${meta.encryption} -> ${meta.network}`;
            pills.appendChild(pill(meta.isolate ? "client isolated" : "client-to-client allowed", meta.isolate ? "good" : "warn"));
            pills.appendChild(pill(meta.bridgeIsolate ? "bridge isolated" : "bridge isolation off", meta.bridgeIsolate ? "good" : "warn"));
            return;
        }
        const values = collect(DEFAULTS.openwrtVlan);
        $("visualSource").textContent = `VLAN ${meta.vlan} / ${meta.name}`;
        $("visualSourceDetail").textContent = `${meta.subnet} · GW ${meta.gateway}`;
        $("visualLinkA").textContent = "802.1Q";
        $("visualLinkB").textContent = "firewall";
        $("visualTarget").textContent = "OpenWrt";
        $("visualTargetDetail").textContent = `${meta.vlanDevice} -> ${meta.bridge} -> ${meta.zone}`;
        pills.appendChild(pill(values.rWan ? "WAN allowed" : "WAN blocked", values.rWan ? "good" : "bad"));
        pills.appendChild(pill(`INPUT ${meta.inputPolicy}`, meta.inputPolicy === "ACCEPT" ? "bad" : "good"));
    }

    function renderNetgearVisual(result) {
        const meta = result.meta || {};
        if (meta.mirroredPair) {
            $("switchVisualPort").textContent = `NETGEAR ${meta.pairName || "switch pair"}`;
            $("switchVisualNative").textContent = (meta.devices || []).join(" + ") || "two switches";
            $("switchVisualTagged").textContent = "same desired change";
            $("switchVisualTask").textContent = "mirrored pair target";
            return;
        }
        if (meta.plan) {
            $("switchVisualPort").textContent = "NETGEAR plan";
            $("switchVisualNative").textContent = `${meta.count || 0} steps`;
            $("switchVisualTagged").textContent = "multi-device runbook";
            $("switchVisualTask").textContent = "configuration plan";
            return;
        }
        $("switchVisualPort").textContent = meta.task === "lacp" ? `NETGEAR LAG ${meta.lagId}` : `NETGEAR ${meta.port || "GS108Tv3"}`;
        $("switchVisualNative").textContent = meta.task === "diagnostics" ? `${meta.diagMode || "overview"} diagnostics` : `Native VLAN ${meta.native ?? "-"}`;
        $("switchVisualTagged").textContent = meta.task === "lacp" ? `members ${meta.lagMembers}` : meta.taggedRaw ? `tagged ${meta.taggedRaw}` : "configuration";
        $("switchVisualTask").textContent = meta.task || "switch task";
    }

    function renderRedundancyVisual(result) {
        const values = collect(DEFAULTS.redundancy);
        const comparison = result.comparison || NCH.redundancy.compare(pairStates, values);
        $("pairVisualSw1").textContent = values.rdSw1Name || "sw01";
        $("pairVisualSw1Detail").textContent = values.rdSw1Mgmt || "management IP";
        $("pairVisualSw2").textContent = values.rdSw2Name || "sw02";
        $("pairVisualSw2Detail").textContent = values.rdSw2Mgmt || "management IP";
        $("pairVisualDrift").textContent = comparison.available ? `${comparison.counts.drift} drift · ${comparison.counts.ignored} ignored` : "drift unknown";
        const pills = $("pairVisualPills");
        pills.replaceChildren();
        if (!comparison.available) {
            pills.appendChild(pill("import both configs", "warn"));
            return;
        }
        pills.appendChild(pill(comparison.counts.drift ? `${comparison.counts.drift} drift` : "pair aligned", comparison.counts.drift ? "bad" : "good"));
        pills.appendChild(pill(`${comparison.counts.ignored} ignored`, "warn"));
        const ready = NCH.redundancy.PORTS.filter((port) => values[`rd${port.toUpperCase()}Mode`] === "redundancy").length;
        if (ready) pills.appendChild(pill(`${ready} redundancy-ready`, "good"));
    }

    function renderPairDrift(result) {
        const comparison = result.comparison || NCH.redundancy.compare(pairStates, collect(DEFAULTS.redundancy));
        $("pairDriftSummary").textContent = comparison.message;
        const list = $("pairDriftList");
        list.replaceChildren();
        if (!comparison.items.length) {
            const item = document.createElement("li");
            item.textContent = comparison.warnings?.[0] || comparison.message;
            list.appendChild(item);
            return;
        }
        const interesting = comparison.items.filter((item) => item.status !== "match");
        const display = (interesting.length ? interesting : comparison.items).slice(0, 20);
        display.forEach((entry) => {
            const item = document.createElement("li");
            item.className = entry.status;
            item.textContent = `${entry.status.toUpperCase()}: ${entry.label} · ${entry.left} ↔ ${entry.right}${entry.detail ? ` · ${entry.detail}` : ""}`;
            list.appendChild(item);
        });
    }

    function renderRisk(result) {
        const assessment = NCH.risk.assess(result.risks);
        const badge = $("riskBadge");
        badge.className = `risk-badge ${assessment.level}`;
        badge.textContent = assessment.level.toUpperCase();
        $("riskTitle").textContent = assessment.title;
        const list = $("riskList");
        list.replaceChildren();
        assessment.reasons.slice(0, 6).forEach((reason) => {
            const item = document.createElement("li");
            item.textContent = reason.message;
            list.appendChild(item);
        });
    }

    function renderOutput(result) {
        const hasRollback = Array.isArray(result.rollbackCommands) && result.rollbackCommands.length > 0;
        $("rollbackOutput").disabled = !hasRollback;
        if (!hasRollback && appState.outputMode === "rollback") appState.outputMode = "apply";
        document.querySelectorAll("[data-output-mode]").forEach((button) => button.classList.toggle("active", button.dataset.outputMode === appState.outputMode));
        const rollback = appState.outputMode === "rollback";
        $("output").textContent = (rollback ? result.rollbackCommands : result.commands).join("\n");
        $("outputTitle").textContent = `${appState.previewMode === "plan" ? "Plan " : ""}${rollback ? "Revert" : "Apply"} commands`;
        if (hasRollback) {
            $("rollbackState").textContent = result.rollbackNote || "Revert commands available.";
            $("rollbackState").className = result.rollbackExact ? "rollback-note exact" : "rollback-note warn";
        } else {
            $("rollbackState").textContent = result.rollbackNote || "Import current state to generate a state-safe Revert for this mutation.";
            $("rollbackState").className = "rollback-note warn";
        }
    }

    function renderDiff(result) {
        if (appState.device === "intent") {
            const diff = result.intentDiff || { items: [], message: "No intent diff available." };
            $("diffSummary").textContent = diff.message;
            const list = $("diffList");
            list.replaceChildren();
            const interesting = (diff.items || []).filter((item) => item.status !== "match");
            const display = (interesting.length ? interesting : (diff.items || [])).slice(0, 12);
            display.forEach((entry) => {
                const item = document.createElement("li"); item.className = entry.status;
                item.textContent = `${entry.status.toUpperCase()}: ${entry.label} · ${entry.current} → ${entry.desired}`; list.appendChild(item);
            });
            if (!list.children.length) { const item = document.createElement("li"); item.textContent = diff.message; list.appendChild(item); }
            return;
        }
        if (appState.device === "redundancy") {
            const comparison = result.comparison || NCH.redundancy.compare(pairStates, collect(DEFAULTS.redundancy));
            $("diffSummary").textContent = comparison.message;
            const list = $("diffList");
            list.replaceChildren();
            const interesting = comparison.items.filter((item) => ["drift", "warning", "unknown"].includes(item.status));
            (interesting.length ? interesting : comparison.items.slice(0, 8)).slice(0, 8).forEach((entry) => {
                const item = document.createElement("li"); item.className = entry.status;
                item.textContent = `${entry.status.toUpperCase()}: ${entry.label} · ${entry.left} ↔ ${entry.right}`; list.appendChild(item);
            });
            if (!list.children.length) { const item = document.createElement("li"); item.textContent = comparison.message; list.appendChild(item); }
            return;
        }
        if (result.meta?.mirroredPair) {
            $("diffSummary").textContent = "Mirrored desired change targets both switch-pair members independently.";
            const list = $("diffList"); list.replaceChildren();
            const item = document.createElement("li"); item.textContent = "Use Switch Pair / Redundancy for pair-wide drift comparison; each mirrored target uses its own imported state for Revert."; list.appendChild(item);
            return;
        }
        const selectedState = appState.device === "netgear" && $("sTarget")?.value === "sw01" ? pairStates.sw01
            : appState.device === "netgear" && $("sTarget")?.value === "sw02" ? pairStates.sw02 : currentState;
        const diff = NCH.diff.compare(result.resources || [], selectedState);
        $("diffSummary").textContent = diff.message;
        const list = $("diffList");
        list.replaceChildren();
        if (!diff.items.length) {
            const item = document.createElement("li");
            item.textContent = diff.message;
            list.appendChild(item);
            return;
        }
        const interesting = diff.items.filter((item) => item.status !== "match");
        const display = (interesting.length ? interesting : diff.items).slice(0, 8);
        display.forEach((entry) => {
            const item = document.createElement("li");
            item.className = entry.status;
            item.textContent = `${entry.status.toUpperCase()}: ${entry.label} · ${entry.current} → ${entry.desired}`;
            list.appendChild(item);
        });
    }

    function renderPlanList() {
        const list = $("planList");
        list.replaceChildren();
        if (!planItems.length) {
            const empty = document.createElement("li");
            empty.className = "muted-item";
            empty.textContent = "No changes in plan.";
            list.appendChild(empty);
            $("planPreview").disabled = true;
            return;
        }
        $("planPreview").disabled = false;
        [...planItems].sort((a, b) => a.order - b.order).forEach((planItem, index) => {
            const item = document.createElement("li");
            const row = document.createElement("div");
            row.className = "plan-item-row";
            const text = document.createElement("span");
            text.textContent = `${index + 1}. ${planItem.title} · ${planItem.platform}${planItem.rollbackExact || !planItem.mutating ? " · Revert ✓" : " · Revert ⚠"}`;
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "plan-remove";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                planItems = planItems.filter((candidate) => candidate.id !== planItem.id);
                if (!planItems.length) appState.previewMode = "current";
                render();
            });
            row.append(text, remove);
            item.appendChild(row);
            list.appendChild(item);
        });
    }

    function render() {
        syncTaskFields();
        const current = currentResult();
        const result = displayResult();
        renderOutput(result);
        if (result.errors.length) {
            $("status").textContent = result.errors.join(" ");
            $("status").style.color = "var(--bad)";
        } else {
            $("status").textContent = appState.previewMode === "plan" ? `${planItems.length} plan step${planItems.length === 1 ? "" : "s"}` : appState.outputMode === "rollback" ? "Revert preview" : "Validated locally";
            $("status").style.color = "var(--muted)";
        }
        if (appState.previewMode === "plan") {
            $("intentVisual").classList.add("hidden");
            $("openwrtVisual").classList.remove("hidden");
            $("netgearVisual").classList.add("hidden");
            $("redundancyVisual").classList.add("hidden");
            renderOpenWrtVisual(result);
        } else if (appState.device === "intent") renderIntentVisual(current);
        else if (appState.device === "openwrt") renderOpenWrtVisual(current);
        else if (appState.device === "netgear") renderNetgearVisual(current);
        else renderRedundancyVisual(current);
        renderRisk(result);
        renderDiff(current);
        if (appState.device === "redundancy") renderPairDrift(current);
        renderPlanList();
        document.querySelectorAll("[data-preview-mode]").forEach((button) => button.classList.toggle("active", button.dataset.previewMode === appState.previewMode));
        persist();
    }

    async function copyCommands() {
        const text = $("output").textContent;
        let copied = false;
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); copied = true; }
        } catch (_) { copied = false; }
        if (!copied) {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "absolute";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();
            try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
            textarea.remove();
        }
        $("copy").textContent = copied ? "Copied" : "Select & copy";
        window.setTimeout(() => { $("copy").textContent = "Copy commands"; }, 1200);
    }

    function parseImport() {
        const parsed = NCH.importer.parse($("importConfig").value, $("importFormat").value);
        if (parsed.errors?.length) {
            currentState = null;
            $("importStatus").textContent = parsed.errors.join(" ");
            $("importStatus").style.color = "var(--bad)";
        } else {
            currentState = parsed;
            const count = parsed.platform === "openwrt"
                ? Object.values(parsed.packages || {}).reduce((sum, pkg) => sum + Object.keys(pkg).length, 0)
                : Object.keys(parsed.interfaces || {}).length + Object.keys(parsed.vlans || {}).length + Object.keys(parsed.lags || {}).length;
            $("importStatus").textContent = `Parsed ${parsed.platform} current state: ${count} recognised resource${count === 1 ? "" : "s"}. Memory-only.`;
            $("importStatus").style.color = "var(--good)";
        }
        render();
    }

    function parsePair() {
        const first = NCH.importer.parseNetgear($("rdSw1Config").value);
        const second = NCH.importer.parseNetgear($("rdSw2Config").value);
        if (first.errors?.length || second.errors?.length) {
            pairStates = { sw01: first.errors?.length ? null : first, sw02: second.errors?.length ? null : second };
            $("pairImportStatus").textContent = [...(first.errors || []).map((e) => `sw01: ${e}`), ...(second.errors || []).map((e) => `sw02: ${e}`)].join(" ");
            $("pairImportStatus").style.color = "var(--bad)";
        } else {
            pairStates = { sw01: first, sw02: second };
            const completeness = first.coverage?.full && second.coverage?.full ? "complete" : "partial";
            $("pairImportStatus").textContent = `Parsed both switches (${completeness} imports). Pair state is memory-only.`;
            $("pairImportStatus").style.color = first.coverage?.full && second.coverage?.full ? "var(--good)" : "var(--warn)";
        }
        render();
    }

    function clearPair() {
        pairStates = { sw01: null, sw02: null };
        $("rdSw1Config").value = "";
        $("rdSw2Config").value = "";
        $("pairImportStatus").textContent = "No pair state imported. Pair running-configs are never saved to localStorage.";
        $("pairImportStatus").style.color = "";
        render();
    }

    function clearImport() {
        currentState = null;
        $("importConfig").value = "";
        $("importStatus").textContent = "Nothing imported. Imported configuration is never saved to localStorage.";
        $("importStatus").style.color = "";
        render();
    }

    function addCurrentToPlan() {
        const result = currentResult();
        if (result.errors.length) {
            $("status").textContent = `Cannot add to plan: ${result.errors.join(" ")}`;
            $("status").style.color = "var(--bad)";
            return;
        }
        if (result.meta?.intent && Array.isArray(result.meta.ordered)) {
            planItems.push(...result.meta.ordered);
        } else {
            planItems.push(NCH.plan.createItem(result));
        }
        appState.previewMode = "plan";
        render();
    }

    function clearPlan() {
        planItems = [];
        appState.previewMode = "current";
        render();
    }

    function resetCurrent() {
        if (appState.device === "intent") applyValues(DEFAULTS.networkIntent);
        else if (appState.device === "redundancy") applyValues(DEFAULTS.redundancy);
        else if (appState.device === "netgear") applyValues(DEFAULTS.netgear);
        else if (appState.openwrtTask === "firewall") applyValues(DEFAULTS.openwrtFirewall);
        else if (appState.openwrtTask === "dhcpdns") applyValues(DEFAULTS.openwrtDhcpDns);
        else if (appState.openwrtTask === "wireless") applyValues(DEFAULTS.openwrtWireless);
        else if (appState.openwrtTask === "routing") applyValues(DEFAULTS.openwrtRouting);
        else if (appState.openwrtTask === "nat") applyValues(DEFAULTS.openwrtNat);
        else applyValues(DEFAULTS.openwrtVlan);
        $("owPreset").value = "custom";
        appState.outputMode = "apply";
        appState.previewMode = "current";
        syncTaskFields();
        render();
    }

    function bindEvents() {
        document.querySelectorAll("[data-level-button]").forEach((button) => button.addEventListener("click", () => setLevel(button.dataset.levelButton)));
        document.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => setDevice(button.dataset.device)));
        document.querySelectorAll("[data-openwrt-task]").forEach((button) => button.addEventListener("click", () => setOpenWrtTask(button.dataset.openwrtTask)));
        document.querySelectorAll("[data-output-mode]").forEach((button) => button.addEventListener("click", () => { if (!button.disabled) setOutputMode(button.dataset.outputMode); }));
        document.querySelectorAll("[data-preview-mode]").forEach((button) => button.addEventListener("click", () => { if (!button.disabled) setPreviewMode(button.dataset.previewMode); }));
        $("owPreset").addEventListener("change", () => applyPreset($("owPreset").value));
        ["wMode", "wEncryption", "fKind", "dMode", "nMode", "sTask"].forEach((id) => $(id).addEventListener("change", render));
        $("copy").addEventListener("click", copyCommands);
        $("reset").addEventListener("click", resetCurrent);
        $("parseImport").addEventListener("click", parseImport);
        $("clearImport").addEventListener("click", clearImport);
        $("parsePair").addEventListener("click", parsePair);
        $("clearPair").addEventListener("click", clearPair);
        $("addToPlan").addEventListener("click", addCurrentToPlan);
        $("previewPlan").addEventListener("click", () => setPreviewMode("plan"));
        $("clearPlan").addEventListener("click", clearPlan);
        document.querySelectorAll("input, select, textarea").forEach((element) => {
            if (["owPreset", "wMode", "wEncryption", "fKind", "dMode", "nMode", "sTask", "importConfig", "importFormat", "rdSw1Config", "rdSw2Config"].includes(element.id)) return;
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
        setOutputMode(appState.outputMode, false);
        appState.previewMode = "current"; // plans are intentionally memory-only
        syncTaskFields();
        render();
    }

    initialise();
    return { render, setLevel, setDevice, setOpenWrtTask, setOutputMode, setPreviewMode };
})();
