/*
 * Service Worker – macht die Aufnahme-App installierbar und offline-startbar.
 *
 * Nur die App-Hülle wird gecacht (cache-first). Kamera und Upload brauchen
 * naturgemäß Gerät bzw. Netz; die App startet aber auch im Keller ohne Netz,
 * damit vor Ort erfasst werden kann – gesendet wird, sobald wieder Netz da ist.
 */

const CACHE = "raumwerk-aufnahme-v1";
const HUELLE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Nur GETs der eigenen Hülle bedienen; POSTs an die Pipeline nie abfangen.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((treffer) => treffer || fetch(e.request).catch(() => treffer))
  );
});
