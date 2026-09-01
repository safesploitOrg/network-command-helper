window.NCH = window.NCH || {};

NCH.plan = (() => {
    let counter = 0;

    function stripShebang(lines) {
        const copy = Array.isArray(lines) ? [...lines] : [];
        if (copy[0]?.trim() === "#!/bin/sh") copy.shift();
        while (copy.length && !copy[0].trim()) copy.shift();
        return copy;
    }

    function createItem(result, descriptor = {}) {
        counter += 1;
        return {
            id: `plan-${Date.now()}-${counter}`,
            title: descriptor.title || result.plan?.title || "Configuration change",
            platform: descriptor.platform || result.plan?.platform || "unknown",
            task: descriptor.task || result.plan?.task || "change",
            deviceName: descriptor.deviceName || result.plan?.deviceName || "",
            order: Number(descriptor.order ?? result.plan?.order ?? 50),
            mutating: descriptor.mutating ?? result.plan?.mutating ?? true,
            commands: [...(result.commands || [])],
            rollbackCommands: [...(result.rollbackCommands || [])],
            rollbackExact: Boolean(result.rollbackExact),
            rollbackNote: result.rollbackNote || "",
            risks: [...(result.risks || [])],
            errors: [...(result.errors || [])],
            summary: [...(result.summary || [])],
            resources: [...(result.resources || [])]
        };
    }

    function compile(items) {
        const ordered = [...(items || [])].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
        const commands = [
            "# NETWORK COMMAND HELPER - CONFIGURATION PLAN",
            "# Multi-device runbook: execute each device section in its own management session.",
            "# Steps are dependency-ordered; verify each step before continuing.",
            ""
        ];
        const rollbackCommands = [
            "# NETWORK COMMAND HELPER - REVERT PLAN",
            "# Revert runs in reverse dependency order.",
            "# Execute each device section in its own management session.",
            ""
        ];
        const risks = [];
        const errors = [];
        const summary = [];
        const resources = [];
        let rollbackExact = true;

        ordered.forEach((item, index) => {
            commands.push(
                "# ============================================================",
                `# STEP ${index + 1}: ${item.title}`,
                `# PLATFORM: ${item.platform}`,
                ...(item.deviceName ? [`# DEVICE: ${item.deviceName}`] : []),
                "# ============================================================",
                "",
                ...stripShebang(item.commands),
                ""
            );
            risks.push(...item.risks);
            errors.push(...item.errors.map((error) => `${item.title}: ${error}`));
            summary.push(`${index + 1}. ${item.title}`);
            resources.push(...item.resources);
            if (item.mutating && (!item.rollbackCommands.length || !item.rollbackExact)) rollbackExact = false;
        });

        if (ordered.some((item) => item.mutating && (!item.rollbackCommands.length || !item.rollbackExact))) {
            risks.push({
                level: "high",
                code: "ROLLBACK_GAP",
                message: "At least one mutating plan step lacks a provably exact state-aware Revert. Import current state or remove the step before treating rollback as complete."
            });
        }
        const distinctTargets = new Set(ordered.map((item) => item.deviceName || item.platform));
        if (new Set(ordered.map((item) => item.platform)).size > 1 || distinctTargets.size > 1) {
            risks.push({
                level: "medium",
                code: "MULTI_DEVICE_PLAN",
                message: "This plan spans multiple device sessions. Apply in dependency order and verify each device before continuing."
            });
        }

        [...ordered].reverse().forEach((item, reverseIndex) => {
            const originalIndex = ordered.indexOf(item) + 1;
            rollbackCommands.push(
                "# ============================================================",
                `# REVERT STEP ${reverseIndex + 1}: original step ${originalIndex} - ${item.title}`,
                `# PLATFORM: ${item.platform}`,
                ...(item.deviceName ? [`# DEVICE: ${item.deviceName}`] : []),
                "# ============================================================",
                ""
            );
            if (!item.mutating) rollbackCommands.push("# Read-only step: no Revert required.");
            else if (item.rollbackCommands.length) rollbackCommands.push(...stripShebang(item.rollbackCommands));
            else rollbackCommands.push("# WARNING: no state-safe Revert is available for this step.");
            rollbackCommands.push("");
        });

        return {
            commands,
            rollbackCommands,
            rollbackExact,
            rollbackNote: rollbackExact
                ? "Exact Revert available for every mutating plan step."
                : "Plan contains at least one mutating step without an exact state-aware Revert.",
            risks,
            errors,
            summary,
            resources,
            meta: { plan: true, count: ordered.length, ordered },
            plan: { title: "Configuration Plan", platform: "multi-device", task: "plan", order: 0, mutating: ordered.some((item) => item.mutating) }
        };
    }

    return { createItem, compile };
})();
