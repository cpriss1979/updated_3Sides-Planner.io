// sw.js
(() => {
    // If someone opens this file in a normal tab, do nothing.
    const isSW =
        typeof ServiceWorkerGlobalScope !== "undefined" &&
        self instanceof ServiceWorkerGlobalScope;
    if (!isSW) return;

    // ----- Versioned cache name derived from sw.js?v=NUMBER -----
    const regURL = new URL(self.location.href);
    const SWV = regURL.searchParams.get("v") || "0"; // e.g. "8" when sw.js?v=8
    const CACHE_PREFIX = "three-sides-v";
    const CACHE_NAME = `${CACHE_PREFIX}${SWV}`;

    // Scope-aware helper for absolute same-origin URLs
    const scope =
        (self.registration && self.registration.scope) ||
        self.location.origin + "/";
    const P = (p) => new URL(p, scope).toString();

    // ----- Precache: include your app shell and static assets here -----
    const CORE = [
        // HTML pages
        "index.html",
        "about.html",
        "theme.html",
        "wellness.html",
        "pet.html",
        "important-numbers.html",
        "toolkit-hub.html",
        "login.html",

        // Also linked from pet.html
        "journal.html",

        // CSS/JS
        "style.css",
        "mainTheme.css",
        "sw-register.js",
        "firebase-init.js",
        // Add "auth.js" here only if it actually exists and is used

        // Images / icons
        "relax.png",
        "favicon-16.png",
        "favicon-32.png",
        "icon-192.png",
        "icon-512.png",
        "icon-192-maskable.png",
        "icon-512-maskable.png",

        // Pet art used on this page
        "pet-baby.png",
        "pet-child.png",
        "pet-teen.png",
        "pet-adult.png",
        "forest.png",

        // Manifest (unversioned to avoid drift)
        "manifest.webmanifest",
    ].map(P);

    // Allow the page to tell us to activate immediately
    self.addEventListener("message", (event) => {
        if (event?.data?.type === "SKIP_WAITING") self.skipWaiting();
    });

    // ----- Install: precache essentials (best-effort; don't fail whole install) -----
    self.addEventListener("install", (event) => {
        event.waitUntil(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                await Promise.all(
                    CORE.map(async (url) => {
                        try {
                            // 'no-cache' bypasses HTTP caches when updating the SW
                            const res = await fetch(url, { cache: "no-cache" });
                            if (res.ok || res.type === "opaque") {
                                await cache.put(url, res.clone());
                            } else {
                                console.warn("[SW] Skipped (status)", res.status, url);
                            }
                        } catch (e) {
                            console.warn("[SW] Skipped (fetch)", url, e);
                        }
                    })
                );
                // Helps first update in some browsers; final control happens via SKIP_WAITING message
                self.skipWaiting();
            })()
        );
    });

    // ----- Activate: cleanup old caches + claim clients + enable nav preload -----
    self.addEventListener("activate", (event) => {
        event.waitUntil(
            (async () => {
                // Remove older versions
                const names = await caches.keys();
                await Promise.all(
                    names.map((n) =>
                        n !== CACHE_NAME && n.startsWith(CACHE_PREFIX)
                            ? caches.delete(n)
                            : Promise.resolve()
                    )
                );

                // (Chrome) Navigation preload can speed first-load
                if ("navigationPreload" in self.registration) {
                    try { await self.registration.navigationPreload.enable(); } catch { }
                }

                await self.clients.claim();
            })()
        );
    });

    // ----- Strategy helpers -----
    const isHTMLNav = (req) =>
        req.mode === "navigate" ||
        (req.method === "GET" &&
            (req.headers.get("accept") || "").includes("text/html"));

    async function networkFirstForPage(event) {
        const cache = await caches.open(CACHE_NAME);
        try {
            // Prefer the preloaded response if available
            const preload = await event.preloadResponse;
            if (preload) {
                cache.put(event.request, preload.clone());
                return preload;
            }

            const net = await fetch(event.request);
            if (net && net.ok) cache.put(event.request, net.clone());
            return net;
        } catch {
            // Offline / error → fallback to cached page or home
            return (
                (await cache.match(event.request)) ||
                (await caches.match(P("index.html"))) ||
                Response.error()
            );
        }
    }

    async function staleWhileRevalidate(event) {
        const req = event.request;
        const cache = await caches.open(CACHE_NAME);

        const cached = await cache.match(req);

        // ✅ Cache if OK *or* opaque (cross-origin)
        const fetchAndUpdate = fetch(req)
            .then((res) => {
                if (res && (res.ok || res.type === "opaque")) {
                    cache.put(req, res.clone());
                }
                return res;
            })
            .catch(() => null);

        if (cached) {
            // Return cache immediately; refresh in the background
            fetchAndUpdate.catch(() => { });
            return cached;
        }

        const net = await fetchAndUpdate;
        if (net) return net;
        return Response.error();
    }

    // ----- Fetch routing -----
    self.addEventListener("fetch", (event) => {
        const req = event.request;

        // Ignore non-GET & extension/browser-internal requests
        if (req.method !== "GET") return;
        if (
            req.url.startsWith("chrome-extension://") ||
            req.url.startsWith("safari-extension://")
        ) return;

        // 🔕 Skip caching for Firebase/Google infra traffic (long-poll, auth, analytics)
        try {
            const host = new URL(req.url).hostname;
            const BYPASS_HOSTS = [
                "googleapis.com",                        // firestore.googleapis.com, firebasestorage.googleapis.com
                "gstatic.com",
                "firebaseinstallations.googleapis.com",
                "googletagmanager.com",
                "analytics.google.com",
                "www.google-analytics.com"
            ];
            if (BYPASS_HOSTS.some(h => host === h || host.endsWith("." + h))) {
                return; // let the network handle it (don’t intercept/cache)
            }
        } catch { } // if URL parsing fails, just fall through

        // HTML navigations → network-first (with preload), fallback to cached or index.html
        if (isHTMLNav(req)) {
            event.respondWith(networkFirstForPage(event));
            return;
        }

        // Everything else → stale-while-revalidate
        event.respondWith(staleWhileRevalidate(event));
    });
})();
