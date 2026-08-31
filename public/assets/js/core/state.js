window.NCH = window.NCH || {};

NCH.state = (() => {
    const STORAGE_KEY = "network-command-helper-v1.1";

    function read() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        } catch (_) {
            return null;
        }
    }

    function write(value) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
            return true;
        } catch (_) {
            return false;
        }
    }

    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Local storage is an optional enhancement.
        }
    }

    return {
        read,
        write,
        clear
    };
})();
