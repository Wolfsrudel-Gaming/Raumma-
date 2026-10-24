/*
 * Service Worker der RAUMWERK-App – macht sie installierbar (Android/iOS „zum
 * Startbildschirm") und offline-startbar.
 *
 * Der Scope ist /raumwerk/ (PC-Oberfläche und mobil/); die App holt aber auch
 * Module aus dem Web-Wurzelverzeichnis (../geometrie.js, ../lib/three.module.min.js
 * …). Das ist kein Problem: Der Fetch-Handler sieht alle Anfragen der
 * kontrollierten Seite, unabhängig vom Pfad – deshalb lassen sich auch die
 * ../-Module cachen.
 *
 * Strategie:
 *  · Seiten, Skripte, Stylesheets (Code): **Netz zuerst**, mit Revalidierung
 *    am HTTP-Cache vorbei – so kommen Korrekturen sofort an. Offline gilt der
 *    zuletzt gecachte Stand.
 *  · Übriges (Schriften, Bilder): Cache zuerst, Netz als Rückfall.
 * Laufzeitdaten (Pipeline-API, Kamerabilder, andere Hosts) werden nie
 * abgefangen. Neuer Cache-Name je Version: alte Stände werden beim Aktivieren
 * gelöscht.
 */

const CACHE = "raumwerk-app-v4";

// Alle Module, die PC- und Mobil-Seite laden – auch die erst per import()
// nachgeladenen (AR, Assistent, Scan, 3D) samt deren Importen. Fehlt eines,
// startet die Funktion offline nicht. Geprüft in web/tests/report.test.mjs.
const HUELLE = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icon.svg",
  "./app.js", "./plan2d.js", "./gebaeude.js", "./store.js", "./report.js",
  "./wolke3d.js", "./verbindung.js", "./ar.js", "./native.js", "./scan.js",
  "./assistent.js", "./uebernahme.js",
  "./skins/ziegel.css", "./skins/werk.css",
  "./mobil/", "./mobil/index.html", "./mobil/mobil.js", "./mobil/mobil.css",
  "../geometrie.js", "../symbole.js", "../komponenten.js", "../regelwerk.js",
  "../pruefung.js", "../normmasse.js", "../platzierung.js", "../modell3d.js",
  "../zielen.js", "../ausrichten.js", "../raumaufnahme.js",
  "../lib/three.module.min.js",
  "../lib/fonts/zillaslab-600.woff2", "../lib/fonts/zillaslab-700.woff2",
  "../lib/fonts/sourcesans-var.woff2", "../lib/fonts/plexmono-500.woff2", "../lib/fonts/plexmono-600.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Einzeln und frisch vom Server: fehlt eine Datei, bricht nicht die ganze Installation.
      .then((c) => Promise.allSettled(HUELLE.map((u) =>
        fetch(new Request(u, { cache: "reload" })).then((a) => (a.ok ? c.put(u, a) : null)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith("raumwerk-app-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Code = alles, was sich mit einer Korrektur ändert: Seiten, Skripte, Stile, Manifest. */
function istCode(req, url) {
  return req.mode === "navigate" || req.destination === "document" || req.destination === "script"
    || req.destination === "style" || req.destination === "manifest"
    || /\.(html?|m?js|css|json|webmanifest)$/i.test(url.pathname) || url.pathname.endsWith("/");
}

function nachcachen(req, antwort) {
  if (antwort && antwort.ok && antwort.type === "basic") {
    const kopie = antwort.clone();
    caches.open(CACHE).then((c) => c.put(req, kopie)).catch(() => {});
  }
  return antwort;
}

/** Netz zuerst (HTTP-Cache nur nach Rückfrage beim Server), offline aus dem Cache. */
function netzZuerst(req) {
  let frisch;
  try { frisch = new Request(req, { cache: "no-cache" }); } catch (_) { frisch = req; }
  return fetch(frisch)
    .then((antwort) => nachcachen(req, antwort))
    .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
      .then((treffer) => treffer || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
      .then((treffer) => treffer || Response.error()));
}

function cacheZuerst(req) {
  return caches.match(req).then((treffer) =>
    treffer || fetch(req).then((antwort) => nachcachen(req, antwort)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(istCode(req, url) ? netzZuerst(req) : cacheZuerst(req));
});
