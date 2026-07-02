/* Minimal service worker. Primary purpose: make the app installable.
   Caching is conservative — we don't want stale Claude/GPT responses. */
const SHELL_CACHE = "ori-shell-v221";
const SHELL = ["/", "/index.html", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Notification click handler — used by the WHO-5 daily reminder.
// Focuses an existing app window if one is open; otherwise opens
// the app at the root. Tag-based so re-firing the same notification
// replaces it rather than stacking.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // In the iOS Capacitor WebView every asset request comes through with
  // the custom `Ori://` scheme. `new URL` on an unrecognized scheme
  // throws synchronously, the fetch handler exits abnormally, and the
  // SW ends up in a state where it never responds to subsequent
  // requests — the app's JS bundle never arrives and the WebView shows
  // a black screen. Bail out of the handler for anything we can't parse.
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Never cache API traffic.
  if (url.hostname.includes("anthropic.com") || url.hostname.includes("openai.com") ||
      url.hostname.includes("deepgram.com") || url.pathname.startsWith("/oura")) {
    return;
  }

  // Navigation fallback — serve the app shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets — cache-first with network refresh.
  if (["script", "style", "image", "font"].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => hit);
        return hit || fetching;
      })
    );
  }
});
