// Offline support. App files load from the network first so updates show up, with the cache as a fallback.
// The OCR engine, language data and the Excel library are cached the first time they're used.
const VERSION = "listsnap-v10";
const SHELL = [
  "./", "index.html", "style.css", "config.js", "load.js", "parse.js", "ocr.js", "ai.js", "excel.js", "drive.js", "app.js",
  "manifest.json", "icons/icon-192.png", "icons/icon-512.png",
];
const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "tessdata.projectnaptha.com", "unpkg.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // "no-cache" makes the browser ask the server whether the file changed, so an edited app.js is never stale.
    // (A page navigation can't be re-made with options, and the browser checks those anyway.)
    const fresh = req.mode === "navigate" ? fetch(req) : fetch(req.url, { cache: "no-cache" });
    e.respondWith(
      fresh.then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
  }
});
