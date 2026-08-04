/*
 * Kopiert die Web-App (../../web) in das Capacitor-Verzeichnis www/.
 *
 * So bleibt die Web-App die eine Quelle: Weboberfläche und native Apps zeigen
 * exakt dasselbe. Vor jedem `cap sync` ausführen (macht `npm run sync`).
 *
 * Tests werden ausgelassen; sonst wird alles übernommen (inkl. lib/three und
 * der Aufnahme-PWA unter web/aufnahme).
 */
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const webDir = join(hier, "..", "..", "web");
const zielDir = join(hier, "..", "www");

if (!existsSync(webDir)) {
  console.error("web/ nicht gefunden unter", webDir);
  process.exit(1);
}

await rm(zielDir, { recursive: true, force: true });
await mkdir(zielDir, { recursive: true });
await cp(webDir, zielDir, {
  recursive: true,
  filter: (quelle) => !quelle.includes(`${join("web", "tests")}`) && !quelle.endsWith(".DS_Store"),
});

// Capacitor erwartet die Start-Seite als index.html im www-Wurzelverzeichnis.
// Die RAUMWERK-App liegt unter web/raumwerk/ – eine Weiterleitung an die Wurzel.
const weiterleitung = `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./raumwerk/index.html">
<title>RAUMWERK</title><a href="./raumwerk/index.html">RAUMWERK öffnen</a>`;
await (await import("node:fs/promises")).writeFile(join(zielDir, "index.html"), weiterleitung);

console.log("Web-App nach www/ kopiert.");
