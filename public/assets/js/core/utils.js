window.NCH = window.NCH || {};

NCH.utils = (() => {
    function clamp(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, number));
    }

    function safeToken(value, fallback = "value") {
        const candidate = String(value || "").trim();
        return /^[A-Za-z0-9_.:@\[\]-]+$/.test(candidate) ? candidate : fallback;
    }

    function safeName(value, fallback = "section") {
        const candidate = String(value || "")
            .trim()
            .replace(/[^A-Za-z0-9_-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return candidate || fallback;
    }

    function uciSection(value, fallback = "section") {
        return safeName(value, fallback).replace(/-/g, "_");
    }

    function shellSingleQuote(value) {
        return `'${String(value ?? "").replace(/'/g, `'"'"'`)}'`;
    }

    function validIPv4(value) {
        const parts = String(value || "").trim().split(".");
        return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
    }

    function ipv4ToInt(value) {
        if (!validIPv4(value)) return null;
        return String(value).split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;
    }

    function validCIDR(value) {
        const parts = String(value || "").trim().split("/");
        if (parts.length !== 2) return false;
        return validIPv4(parts[0]) && /^\d+$/.test(parts[1]) && Number(parts[1]) >= 0 && Number(parts[1]) <= 32;
    }

    function cidrParts(value) {
        if (!validCIDR(value)) return null;
        const [address, prefixText] = String(value).trim().split("/");
        const prefix = Number(prefixText);
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const addressInt = ipv4ToInt(address);
        const networkInt = (addressInt & mask) >>> 0;
        const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
        return { address, prefix, mask, addressInt, networkInt, broadcastInt };
    }

    function intToIPv4(value) {
        const number = Number(value) >>> 0;
        return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join(".");
    }

    function ipInCidr(ip, cidr) {
        const ipInt = ipv4ToInt(ip);
        const parts = cidrParts(cidr);
        if (ipInt === null || !parts) return false;
        return ipInt >= parts.networkInt && ipInt <= parts.broadcastInt;
    }

    function cidrList(value, max = 12) {
        return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, max);
    }

    function prefixToMask(prefix) {
        const bits = clamp(prefix, 0, 32, 24);
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join(".");
    }

    function parseVlanList(specification) {
        const result = new Set();
        const parts = String(specification || "").split(",").map((part) => part.trim()).filter(Boolean);
        for (const part of parts) {
            if (/^\d+$/.test(part)) {
                const vlan = Number(part);
                if (vlan >= 1 && vlan <= 4094) result.add(vlan);
                continue;
            }
            if (/^\d+-\d+$/.test(part)) {
                let [start, end] = part.split("-").map(Number);
                if (start > end) [start, end] = [end, start];
                if (end - start > 255) continue;
                for (let vlan = Math.max(1, start); vlan <= Math.min(4094, end); vlan += 1) result.add(vlan);
            }
        }
        return [...result].sort((a, b) => a - b);
    }

    function parseVlanNames(text) {
        const result = new Map();
        String(text || "").split(/\r?\n/).slice(0, 100).forEach((line) => {
            const match = line.trim().match(/^(\d+)\s*=\s*([A-Za-z0-9_-]+)$/);
            if (!match) return;
            const vlan = Number(match[1]);
            if (vlan >= 1 && vlan <= 4094) result.set(vlan, match[2]);
        });
        return result;
    }

    function expandGigabitPorts(specification, maxPort = 52) {
        const result = new Set();
        const raw = String(specification || "").trim().toLowerCase().replace(/^gigabitethernet\s*/i, "g");
        if (!raw) return [];
        raw.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
            let match = part.match(/^g?(\d+)$/);
            if (match) {
                const port = Number(match[1]);
                if (port >= 1 && port <= maxPort) result.add(`g${port}`);
                return;
            }
            match = part.match(/^g?(\d+)-(?:(?:g)?)(\d+)$/);
            if (!match) return;
            let start = Number(match[1]);
            let end = Number(match[2]);
            if (start > end) [start, end] = [end, start];
            if (end - start > maxPort) return;
            for (let port = Math.max(1, start); port <= Math.min(maxPort, end); port += 1) result.add(`g${port}`);
        });
        return [...result].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    }

    function unique(items) {
        return [...new Set(items)];
    }

    return {
        clamp,
        safeToken,
        safeName,
        uciSection,
        shellSingleQuote,
        validIPv4,
        ipv4ToInt,
        intToIPv4,
        validCIDR,
        cidrParts,
        ipInCidr,
        cidrList,
        prefixToMask,
        parseVlanList,
        parseVlanNames,
        expandGigabitPorts,
        unique
    };
})();
