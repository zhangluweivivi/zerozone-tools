/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration.unregister();
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!newHeaders.get("Cross-Origin-Opener-Policy")) {
                        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    }

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });
} else {
    (() => {
        const coi = {
            shouldRegister: () => true,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            doReload: () => window.location.hostname !== 'localhost', 
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        if (coi.shouldDeregister() && n.serviceWorker && n.serviceWorker.controller) {
            n.serviceWorker.controller.postMessage({ type: "deregister" });
        }

        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!n.serviceWorker) {
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                if (coi.quiet === false) console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    if (coi.quiet === false) console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    if (coi.doReload()) window.location.reload();
                });

                if (registration.active && !n.serviceWorker.controller) {
                    if (coi.quiet === false) console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    if (coi.doReload()) window.location.reload();
                }
            },
            (err) => {
                if (coi.quiet === false) console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
        
        if (coi.coepCredentialless()) {
             n.serviceWorker.ready.then((registration) => {
                 registration.active.postMessage({
                     type: "coepCredentialless",
                     value: true
                 });
             });
        }
    })();
}
