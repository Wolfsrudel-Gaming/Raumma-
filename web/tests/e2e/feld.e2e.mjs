/*
 * Ende-zu-Ende-Nachweis: Funktioniert die Feld-App wirklich?
 *
 * Ein echter Browser (Playwright/Chromium, Handy-Viewport, Fake-Kamera) spielt
 * den Ablauf vor Ort durch – ohne Referenzwürfel:
 *
 *   1. Neuer Raum → „Mit dem Handy zielen“ → sechs Bodenecken eines L-Raums,
 *      Kontrollschuss, Raumhöhe, Tür, Fenster, Steckdose anzielen. Die Lage
 *      kommt als synthetische deviceorientation-Ereignisse – genau die Winkel
 *      eines Handys, das 32 cm vor der Körperachse gehalten wird (Linse 1,38 m
 *      hoch, 0,4° Neigungsfehler). Angenommen sind 1,50 m (falsch).
 *   2. Zwei Bandmaße (5,00 / 4,00 m) setzen den Maßstab → Klasse AUFMASS.
 *   3. Nachmessen im Raumblatt, Tür im Raumblatt bearbeiten.
 *   4. Zweiter Raum Wand für Wand mit dem Bandmaß (letzte Wand ergibt sich).
 *   5. Report (alle Räume) als HTML erzeugen, PC-Oberfläche lädt fehlerfrei.
 *
 * Aufruf: node web/tests/e2e/feld.e2e.mjs   (braucht das npm-Paket playwright
 * samt Chromium; Exitcode != 0 bei Fehler). Startet seinen eigenen Datei-Server.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const WEB = normalize(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const TYPEN = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

let ok = 0, fail = 0;
const pruefe = (name, bed, info = "") => {
  if (bed) { ok++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name} ${info}`); }
};
const nah = (name, ist, soll, tol) => pruefe(`${name} (${Number(ist).toFixed(3)} ≈ ${soll})`, Number.isFinite(ist) && Math.abs(ist - soll) <= tol);

// ------------------------------------------------------------ Datei-Server
const server = createServer(async (req, res) => {
  try {
    let pfad = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pfad.endsWith("/")) pfad += "index.html";
    const datei = normalize(join(WEB, pfad));
    if (!datei.startsWith(WEB)) { res.writeHead(403).end(); return; }
    const inhalt = await readFile(datei);
    res.writeHead(200, { "content-type": TYPEN[extname(datei)] || "application/octet-stream" }).end(inhalt);
  } catch (_) { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASIS = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------ Szene
// Wahrer L-Raum in Weltkoordinaten (x Ost, y Nord), 17 m², 2,62 m hoch.
const L = [[0, 4], [5, 4], [5, 0], [2, 0], [2, 1.5], [0, 1.5]];
const STAND = [2.9, 2.5], H_RAUM = 2.62;
// Haltung: Drehpunkt der Hand 1,30 m, Linse 8 cm darüber, Handy 32 cm vor der Achse.
const HAND = { hw: 1.30, r: 0.32, L: 0.08, biasGrad: 0.4 };
const lage = (p, biasGrad = HAND.biasGrad) => {
  const dx = p[0] - STAND[0], dy = p[1] - STAND[1], D = Math.hypot(dx, dy), zT = p[2] ?? 0;
  let th = 0.3;   // Neigung, unter der die Linse (vor der Achse) genau auf p schaut
  for (let k = 0; k < 60; k++) th = Math.atan2(HAND.hw + HAND.L * Math.cos(th) - zT, D - (HAND.r + HAND.L * Math.sin(th)));
  th += biasGrad * Math.PI / 180;
  const v = [Math.sin(Math.atan2(dx, dy)) * Math.cos(th), Math.cos(Math.atan2(dx, dy)) * Math.cos(th), -Math.sin(th)];
  return { alpha: Math.atan2(-v[0], v[1]) * 180 / Math.PI, beta: Math.acos(-v[2]) * 180 / Math.PI, gamma: 0 };
};

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const fehler = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "de-DE", serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => fehler.push(`pageerror: ${e.message}`));
  p.on("console", m => { if (m.type() === "error") fehler.push(`console: ${m.text()}`); });
  p.on("dialog", d => d.accept());

  /** Hält das „Handy“ auf einen Punkt und löst aus. */
  const ziele = async (pt, ausloesen = true, biasGrad) => {
    const o = lage(pt, biasGrad);
    for (let i = 0; i < 16; i++) {
      await p.evaluate(o => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", o)), o);
      await p.waitForTimeout(30);
    }
    if (ausloesen) await p.click("#asAus");
  };
  const projekt = () => p.evaluate(() => JSON.parse(localStorage.getItem("raumwerk.projekt.v1")));

  console.log("1. Raum per Handy anzielen");
  await p.goto(`${BASIS}/raumwerk/mobil/`);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.click("#fabRaum");
  await p.click("text=Freistehend aufnehmen");
  await p.click('[data-weg="zielen"]');
  await p.fill("#asH", "1,50");
  // Der neue Raum erbt vom Beispielraum 6 cm noch fehlenden Estrich: Die App
  // fragt, ob der Rohboden im Bild ist (vorausgewählt) – dann zählen alle
  // gezielten Höhen ab Rohboden und werden auf den Fertigfußboden umgerechnet.
  const estrich = await p.isChecked("#asRoh").catch(() => false);
  // Einmal je Gerät: Neigung kalibrieren – ein fernes Ziel (Flur, Fenster) normal
  // und mit dem Handy auf dem Kopf anzielen; der Neigungsfehler wechselt dabei
  // das Vorzeichen. Ein zweites Paar bestätigt das erste.
  await p.click("#asKalib");
  const marke = [3.5, 15, 1.4];
  for (let paar = 0; paar < 2; paar++) {
    await ziele(marke, true, HAND.biasGrad);
    await ziele(marke, true, -HAND.biasGrad);
  }
  const geraet = await p.evaluate(() => JSON.parse(localStorage.getItem("raumwerk.geraet")));
  nah("Neigungsfehler kalibriert 0,4°", geraet && geraet.neigungsfehlerGrad, HAND.biasGrad, 0.02);
  for (const ecke of L) await ziele(ecke);
  pruefe("sechs Ecken gesetzt", (await p.textContent("#asKrume")).includes("6 GESETZT"));
  await p.click("#asWeiter");                                   // → Kontrollschuss
  pruefe("Kontrollschuss wird angeboten", (await p.textContent("#asTitel")).includes("Ecke 1"));
  await ziele(L[0]);                                            // → Raumhöhe
  await ziele(L[1]); await ziele([...L[1], H_RAUM]);
  await ziele([3.4, 4, 0]); await ziele([4.285, 4, 2.01]);      // Tür
  await p.click('[data-oeff="FENSTER"]');
  await ziele([5, 3.0, 0.9]); await ziele([5, 1.8, 2.2]);       // Fenster
  await p.click("#asWeiter");                                   // → Installation
  await ziele([0, 2.5, 0.3]);                                   // Steckdose
  await p.click("#asWeiter");                                   // → Prüfen
  pruefe("ohne Maßstab: Klasse SKIZZE", (await p.textContent(".as-klasse")).includes("SKIZZE"));
  const laengen = async () => (await p.$$eval(".as-zeile [data-band]", els => els.map(e => e.closest(".as-zeile").querySelector("b").textContent)))
    .map(t => parseFloat(t.replace(",", ".")));
  const naechste = (ls, soll) => ls.reduce((b, x, i) => Math.abs(x - soll) < Math.abs(ls[b] - soll) ? i : b, 0);
  let ls = await laengen();
  const i5 = naechste(ls, 5.2);
  pruefe(`lange Wand vor dem Maßstab ${ls[i5]} m (Höhe falsch geschätzt)`, ls[i5] > 5.05, ls.join(" | "));
  await p.fill(`[data-band="${i5}"]`, "5,00");
  await p.press(`[data-band="${i5}"]`, "Tab");
  await p.waitForTimeout(200);
  ls = await laengen();
  const i4 = naechste(ls, 4.0);
  await p.fill(`[data-band="${i4}"]`, "4,00");
  await p.press(`[data-band="${i4}"]`, "Tab");
  await p.waitForSelector(".as-massstab.ok");
  pruefe("zwei Bandmaße: Klasse AUFMASS", (await p.textContent(".as-klasse")).includes("AUFMASS"));
  await p.click("#asOk");
  await p.waitForSelector('.screen[data-screen="plan"].aktiv');

  let pr = await projekt();
  const raum1 = pr.raeume.find(r => r.aufmass && r.aufmass.methode === "zielen");
  pruefe("Raum mit Aufmaß gespeichert", !!raum1);
  const ecken = JSON.parse(raum1.umriss);
  let flaeche = 0;
  ecken.forEach((a, i) => { const b = ecken[(i + 1) % ecken.length]; flaeche += a[0] * b[1] - b[0] * a[1]; });
  nah("Fläche 17 m²", Math.abs(flaeche) / 2, 17, 0.1);
  const ab = estrich ? Number(raum1.aufbauM) || 0 : 0;   // Höhen ab Fertigfußboden
  pruefe(`Estrich berücksichtigt (${ab * 100} cm)`, !estrich || ab > 0);
  nah("Raumhöhe ab FFB", raum1.hoeheM, H_RAUM - ab, 0.02);
  pruefe("Maßstab gesetzt, Klasse AUFMASS gespeichert", raum1.aufmass.kalibriert === true && raum1.aufmass.klasse === "AUFMASS");
  const oe = pr.oeffnungen.filter(o => o.raumId === raum1.id);
  const tuer = oe.find(o => o.art === "TUER"), fenster = oe.find(o => o.art === "FENSTER");
  nah("Tür 0,885 breit", tuer && tuer.breiteM, 0.885, 0.02);
  nah("Tür ab FFB", tuer && tuer.hoeheM, 2.01 - ab, 0.02);
  nah("Fenster-Brüstung ab FFB", fenster && fenster.bruestungM, 0.9 - ab, 0.02);
  const dose = pr.einbauten.find(e => e.raumId === raum1.id && e.art === "STECKDOSE");
  nah("Steckdose ab FFB", dose && dose.hoeheM, 0.3 - ab, 0.02);
  pruefe("Plan zeigt den Raum", (await p.$$("#planSvg .wand line, #planSvg line")).length > 0);

  console.log("2. Nachmessen im Raumblatt");
  await p.click("#kopfTitel");                                  // → Projekte
  await p.click(`.stein >> text=${raum1.name}`);
  await p.waitForSelector(".wandliste");
  const wandZeilen = await p.$$(".wandliste .wand-stein");
  pruefe("Wandliste mit 6 Wänden", wandZeilen.length === 6, String(wandZeilen.length));
  pruefe("Wand mit Bandmaß gekennzeichnet", (await p.textContent(".wandliste")).includes("BANDMASS"));
  const i3 = (await p.$$eval(".wandliste .wand-laenge", els => els.map(e => e.textContent))).findIndex(t => /^(2,9|3,0)/.test(t));
  pruefe("3-m-Wand in der Liste", i3 >= 0);
  const eingabe = (await p.$$(".wandliste .wand-stein input"))[i3];
  await eingabe.fill("3,01");
  await eingabe.press("Enter");
  await p.waitForTimeout(300);
  pr = await projekt();
  const r1b = pr.raeume.find(r => r.id === raum1.id);
  pruefe("drittes Bandmaß übernommen", r1b.aufnahme && Object.keys(r1b.aufnahme.bandmasse).length === 3);
  pruefe("Tür bleibt erhalten", pr.oeffnungen.filter(o => o.raumId === raum1.id).length === 2);

  console.log("3. Zweiter Raum mit dem Bandmaß");
  await p.evaluate(() => document.querySelector(".sheet-zu")?.click());
  await p.waitForTimeout(300);
  await p.click("#kopfTitel");
  await p.click("#fabRaum");
  await p.click("text=Freistehend aufnehmen");
  await p.click('[data-weg="band"]');
  // 5,00 ↱ 4,00 ↱ 3,00 ↱ 2,50 ↰ 2,00 ↱ (letzte Länge ergibt sich)
  const zug = [[5, 90], [4, 90], [3, 90], [2.5, -90], [2, 90], [null, 90]];
  while ((await p.$$("[data-l]")).length < zug.length) await p.click("#asPlus");
  for (let i = 0; i < zug.length; i++) {
    const [l, d] = zug[i];
    if (l != null) { await p.fill(`[data-l="${i}"]`, String(l).replace(".", ",")); await p.press(`[data-l="${i}"]`, "Tab"); }
    if (d === -90) await p.click(`[data-d="${i}"][data-w="-90"]`);
  }
  pruefe("Zug schließt", (await p.textContent(".as-massstab")).includes("Schließt"));
  await p.click("#asOk");
  await p.waitForSelector('.screen[data-screen="plan"].aktiv');
  pr = await projekt();
  const raum2 = pr.raeume.find(r => r.aufmass && r.aufmass.methode === "band");
  const e2 = JSON.parse(raum2.umriss);
  let f2 = 0;
  e2.forEach((a, i) => { const b = e2[(i + 1) % e2.length]; f2 += a[0] * b[1] - b[0] * a[1]; });
  nah("Bandmaß-L-Raum 15 m²", Math.abs(f2) / 2, 15, 0.01);
  const ueberlapp = (Number(raum2.xM) || 0) >= (Number(raum1.xM) || 0) + Math.max(...ecken.map(q => q[0])) - 0.001;
  pruefe("freistehender Raum überlappt nicht", ueberlapp);

  console.log("4. Tür im Raumblatt bearbeiten");
  await p.click("#kopfTitel");
  await p.click(`.stein >> text=${raum2.name}`);
  await p.click("text=+ Fenster");
  await p.click(".presets .preset >> nth=1");                   // Wand 2
  const felder = await p.$$(".sheet .feld input");
  await felder[0].fill("0,50"); await felder[0].press("Tab");
  await p.click("text=Speichern");
  await p.waitForTimeout(300);
  pr = await projekt();
  const fe = pr.oeffnungen.find(o => o.raumId === raum2.id && o.art === "FENSTER");
  pruefe("Fenster angelegt mit Norm-Brüstung", fe && fe.wandIndex === 1 && fe.bruestungM === 0.9, JSON.stringify(fe));

  console.log("5. Report und PC-Oberfläche");
  const html = await p.evaluate(async () => {
    const m = await import("../report.js");
    return m.berichtHtml(JSON.parse(localStorage.getItem("raumwerk.projekt.v1")), {});
  });
  pruefe("Report enthält beide Räume", html.includes(raum1.name) && html.includes(raum2.name));
  pruefe("Report nennt die Maß-Herkunft", /Bandmaß/.test(html) && /gezielt/.test(html));

  const pc = await ctx.newPage();
  await pc.setViewportSize({ width: 1440, height: 900 });
  pc.on("pageerror", e => fehler.push(`pc pageerror: ${e.message}`));
  await pc.goto(`${BASIS}/raumwerk/`);
  await pc.waitForTimeout(500);
  pruefe("PC-Oberfläche zeigt das Projekt", (await pc.textContent("body")).includes(raum1.name));
} finally {
  await browser.close();
  server.close();
}

pruefe("keine Fehler im Browser", fehler.length === 0, fehler.join("\n"));
console.log(`feld.e2e: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
