window.NCH = window.NCH || {};

NCH.state = (() => {
    const STORAGE_KEY = "network-command-helper-v2";
    const LEGACY_KEYS = ["network-command-helper-v1.8"];

    function scrub(value) {
        const secrets = new Set(NCH.config?.secrets || []);
        if (Array.isArray(value)) return value.map(scrub);
        if (!value || typeof value !== "object") return value;
        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
            result[key] = secrets.has(key) ? "" : scrub(entry);
        });
        return result;
    }

    function parseKey(key) {
        try { return JSON.parse(localStorage.getItem(key) || "null"); }
        catch (_) { return null; }
    }

    function read() {
        const current = parseKey(STORAGE_KEY);
        if (current) return current;
        for (const key of LEGACY_KEYS) {
            const legacy = parseKey(key);
            if (legacy) return legacy;
        }
        return null;
    }

    function write(value) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(scrub(value)));
            return true;
        } catch (_) { return false; }
    }

    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch (_) { /* optional enhancement */ }
    }

    return { read, write, clear };
})();
