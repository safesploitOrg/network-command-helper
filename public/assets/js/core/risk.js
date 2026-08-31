window.NCH = window.NCH || {};

NCH.risk = (() => {
    const ORDER = {
        low: 1,
        medium: 2,
        high: 3
    };

    function normaliseLevel(level) {
        return Object.prototype.hasOwnProperty.call(ORDER, level) ? level : "low";
    }

    function assess(facts) {
        const seen = new Set();
        const reasons = [];
        let level = "low";

        (facts || []).forEach((fact) => {
            const factLevel = normaliseLevel(fact.level);
            if (ORDER[factLevel] > ORDER[level]) {
                level = factLevel;
            }

            const key = fact.code || fact.message;
            if (key && !seen.has(key)) {
                seen.add(key);
                reasons.push({
                    level: factLevel,
                    code: fact.code || "RISK",
                    message: fact.message || "Configuration change"
                });
            }
        });

        if (!reasons.length) {
            reasons.push({
                level: "low",
                code: "ADDITIVE",
                message: "Additive configuration with no obvious native-management change."
            });
        }

        return {
            level,
            title: `${level.charAt(0).toUpperCase()}${level.slice(1)} change risk`,
            reasons
        };
    }

    return {
        assess
    };
})();
