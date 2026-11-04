/* MHZALY service worker — instant loads + offline resilience.
   Only same-origin assets are cached; AI APIs are never intercepted. */
const CACHE = "mhzaly-v4";
const CORE = [
  "/",
  "/index.html",
  "/mhzaly-ar.html",
  "/app.js",
  "/styles.css",
  "/mhzaly-ar.css",
  "/fonts.css",
  "/vendor/three.module.js",
  "/vendor/addons/loaders/GLTFLoader.js",
  "/vendor/addons/environments/RoomEnvironment.js",
  "/vendor/addons/exporters/GLTFExporter.js",
  "/vendor/addons/utils/BufferGeometryUtils.js",
  "/vendor/addons/utils/TextureUtils.js",
  "/hero-look.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE).catch(() => null)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch AI endpoints

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        }
        return res;
      });
    })
  );
});
