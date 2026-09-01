window.NCH = window.NCH || {};

NCH.rollback = (() => {
    function uciRestoreSection(state, pkg, section) {
        if (!state || state.platform !== "openwrt" || !state.packages?.[pkg]) return null;
        const current = NCH.importer.getUciSection(state, pkg, section);
        const key = `${pkg}.${section}`;
        const commands = [`uci -q delete ${key} || true`];
        if (!current) return commands;
        if (!current.type) return commands;
        commands.push(`uci set ${key}=${NCH.utils.shellSingleQuote(current.type)}`);
        Object.entries(current.options || {}).forEach(([option, value]) => {
            if (Array.isArray(value)) {
                value.forEach((entry) => commands.push(`uci add_list ${NCH.utils.shellSingleQuote(`${key}.${option}=${entry}`)}`));
            } else {
                commands.push(`uci set ${key}.${option}=${NCH.utils.shellSingleQuote(value)}`);
            }
        });
        return commands;
    }

    function restoreManyUci(state, resources) {
        if (!state || state.platform !== "openwrt") return null;
        const requiredPackages = new Set((resources || []).filter((resource) => resource.kind === "uci-section").map((resource) => resource.package));
        if ([...requiredPackages].some((pkg) => !state.packages?.[pkg])) return null;
        const seen = new Set();
        const commands = [];
        [...(resources || [])].reverse().forEach((resource) => {
            if (resource.kind !== "uci-section") return;
            const key = `${resource.package}.${resource.section}`;
            if (seen.has(key)) return;
            seen.add(key);
            const restore = uciRestoreSection(state, resource.package, resource.section);
            if (restore) commands.push(...restore, "");
        });
        return commands;
    }

    return { uciRestoreSection, restoreManyUci };
})();
