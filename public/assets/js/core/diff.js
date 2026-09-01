window.NCH = window.NCH || {};

NCH.diff = (() => {
    function asArray(value) {
        if (value === undefined || value === null || value === "") return [];
        return Array.isArray(value) ? value.map(String) : [String(value)];
    }

    function equalValue(current, desired) {
        const left = asArray(current).sort();
        const right = asArray(desired).sort();
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    function compareUciSection(resource, state) {
        if (!state?.packages?.[resource.package]) {
            return [{ status: "unknown", label: `${resource.package}.${resource.section}`, current: "package not present in import", desired: resource.type || "section" }];
        }
        const current = NCH.importer.getUciSection(state, resource.package, resource.section);
        if (!current) {
            return [{ status: "add", label: `${resource.package}.${resource.section}`, current: "absent", desired: resource.type || "section" }];
        }
        const items = [];
        if (resource.type && current.type && resource.type !== current.type) {
            items.push({ status: "change", label: `${resource.package}.${resource.section} type`, current: current.type, desired: resource.type });
        }
        Object.entries(resource.options || {}).forEach(([option, desired]) => {
            const currentValue = current.options?.[option];
            if (!equalValue(currentValue, desired)) {
                items.push({
                    status: currentValue === undefined ? "add" : "change",
                    label: `${resource.package}.${resource.section}.${option}`,
                    current: currentValue === undefined ? "unset" : asArray(currentValue).join(", "),
                    desired: asArray(desired).join(", ")
                });
            } else {
                items.push({ status: "match", label: `${resource.package}.${resource.section}.${option}`, current: asArray(currentValue).join(", "), desired: asArray(desired).join(", ") });
            }
        });
        return items.length ? items : [{ status: "match", label: `${resource.package}.${resource.section}`, current: "present", desired: "present" }];
    }

    function compareUciList(resource, state) {
        if (!state?.packages?.[resource.package]) {
            return (resource.values || []).map((value) => ({ status: "unknown", label: `${resource.package}.${resource.section}.${resource.option}`, current: "package not present in import", desired: String(value) }));
        }
        const current = NCH.importer.getUciSection(state, resource.package, resource.section);
        const values = asArray(current?.options?.[resource.option]);
        return (resource.values || []).map((value) => ({
            status: values.includes(String(value)) ? "match" : "add",
            label: `${resource.package}.${resource.section}.${resource.option}`,
            current: values.join(", ") || "unset",
            desired: String(value)
        }));
    }

    function compareNetgearVlan(resource, state) {
        const current = state?.vlans?.[resource.vlan];
        if (!current && !state?.coverage?.full) return [{ status: "unknown", label: `VLAN ${resource.vlan}`, current: "not present in partial import", desired: resource.name || "present" }];
        if (!current) return [{ status: "add", label: `VLAN ${resource.vlan}`, current: "absent", desired: resource.name || "present" }];
        if (resource.name && current.name !== resource.name) {
            return [{ status: "change", label: `VLAN ${resource.vlan} name`, current: current.name || "default", desired: resource.name }];
        }
        return [{ status: "match", label: `VLAN ${resource.vlan}`, current: current.name || "present", desired: resource.name || "present" }];
    }

    function compareNetgearInterface(resource, state) {
        const current = state?.interfaces?.[resource.port];
        if (!current) return [{ status: "unknown", label: `Interface ${resource.port}`, current: "not present in import", desired: "configuration change" }];
        const items = [];
        Object.entries(resource.options || {}).forEach(([option, desired]) => {
            const currentValue = current[option];
            const equal = Array.isArray(desired)
                ? equalValue(currentValue || [], desired)
                : String(currentValue ?? "") === String(desired ?? "");
            items.push({
                status: equal ? "match" : "change",
                label: `${resource.port}.${option}`,
                current: Array.isArray(currentValue) ? currentValue.join(", ") : String(currentValue ?? "unset"),
                desired: Array.isArray(desired) ? desired.join(", ") : String(desired ?? "")
            });
        });
        return items;
    }

    function compareNetgearLag(resource, state) {
        const current = state?.lags?.[resource.lagId];
        if (!current) return [{ status: "add", label: `LAG ${resource.lagId}`, current: "absent", desired: `${resource.mode}: ${(resource.members || []).join(", ")}` }];
        const items = [];
        if (resource.mode) {
            const expectedType = resource.mode === "static" ? "static" : "lacp";
            items.push({ status: current.type === expectedType ? "match" : "change", label: `LAG ${resource.lagId} type`, current: current.type || "unknown", desired: expectedType });
        }
        if (resource.members?.length) {
            const equal = equalValue(current.members || [], resource.members);
            items.push({ status: equal ? "match" : "change", label: `LAG ${resource.lagId} members`, current: (current.members || []).join(", ") || "none", desired: resource.members.join(", ") });
        }
        return items;
    }

    function compare(resources, state) {
        const items = [];
        const list = Array.isArray(resources) ? resources : [];
        if (!state) return { available: false, compatible: false, items: [], counts: { add: 0, change: 0, match: 0, unknown: 0 }, message: "No current configuration imported." };
        if (!list.length) return { available: true, compatible: true, items: [], counts: { add: 0, change: 0, match: 0, unknown: 0 }, message: "This task does not declare comparable desired-state resources." };

        const platform = list[0].platform || (list[0].kind?.startsWith("netgear") ? "netgear" : "openwrt");
        if (state.platform !== platform) {
            return { available: true, compatible: false, items: [], counts: { add: 0, change: 0, match: 0, unknown: 0 }, message: `Imported ${state.platform} state does not match this ${platform} task.` };
        }

        list.forEach((resource) => {
            if (resource.kind === "uci-section") items.push(...compareUciSection(resource, state));
            else if (resource.kind === "uci-list") items.push(...compareUciList(resource, state));
            else if (resource.kind === "netgear-vlan") items.push(...compareNetgearVlan(resource, state));
            else if (resource.kind === "netgear-interface") items.push(...compareNetgearInterface(resource, state));
            else if (resource.kind === "netgear-lag") items.push(...compareNetgearLag(resource, state));
        });

        const counts = { add: 0, change: 0, match: 0, unknown: 0 };
        items.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
        return { available: true, compatible: true, items, counts, message: `${counts.add} add · ${counts.change} change · ${counts.match} match · ${counts.unknown} unknown` };
    }

    return { compare };
})();
