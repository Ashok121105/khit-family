(function configureKhitApi() {
    const configuredBase = window.KHIT_API_BASE || window.__KHIT_API_BASE__;
    const base = configuredBase || window.location.origin;
    window.KHIT_API_BASE = String(base).replace(/\/$/, "");

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        if (typeof input === "string") {
            if (input.startsWith("/api/")) {
                return nativeFetch(`${window.KHIT_API_BASE}${input}`, init);
            }
            if (input.startsWith("http://localhost:5000")) {
                return nativeFetch(input.replace("http://localhost:5000", window.KHIT_API_BASE), init);
            }
        }
        return nativeFetch(input, init);
    };
})();