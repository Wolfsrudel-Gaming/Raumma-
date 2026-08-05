/*
 * Service Worker der RAUMWERK-App – macht sie installierbar (Android/iOS „zum
 * Startbildschirm") und offline-startbar.
 *
 * Der Scope ist /raumwerk/; die App holt aber auch Module aus dem Web-Wurzel-
 * verzeichnis (../geometrie.js, ../lib/three.module.min.js …). Das ist kein
 * Problem: Der Fetch-Handler sieht alle Anfragen der kontrollierten Seite,
 * unabhängig vom Pfad – deshalb lassen sich auch die ../-Module cachen.
 *
 * Strategie: App-Hülle beim Install vorladen, dann cache-first mit Netz-
 * Rückfall. Laufzeitdaten (Pipeline-API, Kamerabilder) werden nie abgefangen.
 */

const CACHE = "raumwerk-app-v2";

const HUELLE = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icon.svg",
  "./app.js", "./plan2d.js", "./gebaeude.js", "./store.js", "./report.js",
  "./wolke3d.js", "./verbindung.js", "./ar.js", "./native.js", "./scan.js",
  "../geometrie.js", "../symbole.js", "../komponenten.js", "../regelwerk.js",
  "../pruefung.js", "../normmasse.js", "../platzierung.js", "../modell3d.js",
  "../lib/three.module.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Einzeln hinzufügen: fehlt eine Datei, bricht nicht die ganze Installation.
      .then((c) => Promise.allSettled(HUELLE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((treffer) =>
      treffer || fetch(e.request).then((antwort) => {
        // Erfolgreiche Antworten nebenbei nachcachen (z. B. spät geladene Module).
        if (antwort && antwort.ok && antwort.type === "basic") {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      }).catch(() => treffer)
    )
  );
});
