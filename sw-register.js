// sw-register.js
(() => {
    if (!("serviceWorker" in navigator)) return;

    // Only run on http/https (works on localhost too)
    if (!/^https?:$/.test(location.protocol)) {
        console.log("[SW] Not registering on non-HTTP(S) origin.");
        return;
    }

    // Bump this whenever sw.js changes
    const SW_VERSION = 27;

    // Compute the repo base robustly:
    // - On GitHub Pages project sites: always "/<repo>/"
    // - Else: fall back to current directory ("/" on localhost)
    function computeBase() {
        const { hostname, pathname } = location;
        if (hostname.endsWith("github.io")) {
            const seg = pathname.split("/").filter(Boolean)[0]; // repo name
            return seg ? `/${seg}/` : "/";
        }
        // Non-GitHub hosts: current folder
        return new URL(".", location).pathname;
    }

    const BASE = computeBase();            // e.g. "/three-sides.io/"
    const SW_URL = `${BASE}sw.js?v=${SW_VERSION}`;
    const SCOPE = BASE;

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });

    function track(reg) {
        if (!reg) return;

        // If an updated worker is already waiting, activate it now
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

        // Watch for new updates
        reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
                if (nw.state === "installed") {
                    if (navigator.serviceWorker.controller) {
                        console.log("[SW] Update installed; activating…");
                        (reg.waiting || nw).postMessage({ type: "SKIP_WAITING" });
                    } else {
                        console.log("[SW] First install complete; offline ready.");
                    }
                }
            });
        });

        // Check for updates when tab becomes visible (helps Safari)
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update().catch(() => { });
        });

        // If the page is restored from BFCache, also check for updates
        window.addEventListener("pageshow", (e) => {
            if (e.persisted) reg.update().catch(() => { });
        });

        // Periodic background check (hourly)
        setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000);
    }

    // Register after load so it never blocks first paint
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(SW_URL, { scope: SCOPE })
            .then((reg) => {
                console.log("[SW] Registered at", reg.scope);
                track(reg);
                return navigator.serviceWorker.ready;
            })
            .catch((err) => console.error("[SW] Register error", err));
    });
})();
