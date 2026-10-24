/*
 * Prüft den Bericht (report.js) ohne DOM: Inhalt vollständig, Maße mit
 * Dezimalkomma, Einbauten gelistet – und vor allem, dass kein Feld aus einem
 * (importierten, fremden) Projekt als HTML oder Script im Bericht landet.
 * Dazu: Der Service Worker hält alles vor, was App und Bericht offline brauchen.
 *
 * Aufruf: node web/tests/report.test.mjs   (Exitcode != 0 bei Fehler)
 */
import { berichtHtml, berichtOeffnen, bericht } from "../raumwerk/report.js";
import { beispielProjekt } from "../raumwerk/store.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let ok = 0, fail = 0;
const pruef = (name, bed, info = "") => {
  if (!bed) { console.error(`FAIL ${name}${info ? ": " + info : ""}`); fail++; } else ok++;
};
const zaehle = (text, teil) => text.split(teil).length - 1;

/**
 * Alle echten Tags des Dokuments. Ist richtig maskiert, stammt jedes „<" im
 * Text vom Bericht selbst – dann sind das genau seine eigenen Tags.
 */
function tags(html) {
  const liste = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>"'\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = [];
    const ra = /([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    let a;
    while ((a = ra.exec(m[2]))) attrs.push({ name: a[1].toLowerCase(), wert: (a[2] || "").replace(/^["']|["']$/g, "") });
    liste.push({ tag: m[1].toLowerCase(), attrs });
  }
  return liste;
}

/** Sicherheitsprüfung, die für jedes erzeugte Dokument gelten muss. */
function sicher(name, html) {
  const alle = tags(html);
  const verboten = alle.filter(t => ["script", "iframe", "object", "embed", "link", "base", "form", "meta"].includes(t.tag)
    && !(t.tag === "meta" && t.attrs.every(a => ["charset", "http-equiv", "content", "name"].includes(a.name))));
  pruef(`${name}: keine fremden Tags`, verboten.length === 0, JSON.stringify(verboten.slice(0, 3)));
  const handler = alle.flatMap(t => t.attrs.filter(a => a.name.startsWith("on")).map(a => ({ tag: t.tag, ...a })));
  pruef(`${name}: genau ein Ereignis-Attribut (Druckknopf)`,
    handler.length === 1 && handler[0].tag === "button" && handler[0].name === "onclick" && handler[0].wert === "window.print()",
    JSON.stringify(handler));
  const bilder = alle.filter(t => t.tag === "img");
  pruef(`${name}: Bilder nur als data:image`, bilder.every(t => /^data:image\/(png|jpe?g|webp|gif)[;,]/.test(t.attrs.find(a => a.name === "src")?.wert || "")));
  pruef(`${name}: kein javascript:`, !/javascript:/i.test(html));
  pruef(`${name}: kein rohes <script`, !/<script/i.test(html));
  pruef(`${name}: CSP gesetzt`, html.includes(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"`));
  pruef(`${name}: keine externen Ressourcen`, !/(src|href)="(https?:|\/\/)/i.test(html) && !/url\(/i.test(html));
  // Attributwerte, die der Bericht als Farbe setzt, müssen Farben sein.
  const fills = alle.flatMap(t => t.attrs.filter(a => a.name === "fill" || a.name === "stroke").map(a => a.wert));
  pruef(`${name}: Farben gültig`, fills.every(f => /^(#[0-9a-fA-F]{3,8}|none)$/.test(f)), fills.filter(f => !/^(#[0-9a-fA-F]{3,8}|none)$/.test(f)).join(" "));
}

const DATUM = new Date(2026, 9, 24);
const X = `<img src=x onerror=alert(1)>`;

// ------------------------------------------------ 1. Beispielprojekt
const bsp = beispielProjekt();
let html = berichtHtml(bsp, { datum: DATUM });
sicher("Beispiel", html);
pruef("Beispiel: Projektname", html.includes("Technikraum (Beispiel)"));
pruef("Beispiel: beide Räume", html.includes("Technikraum") && html.includes("Lager"));
pruef("Beispiel: zwei Raumseiten", zaehle(html, `class="blatt raum"`) === 2);
pruef("Beispiel: Deckblatt", zaehle(html, `class="blatt deckblatt"`) === 1);
pruef("Beispiel: Datum", html.includes("24. Oktober 2026"));
pruef("Beispiel: Variante", html.includes("Variante A"));
pruef("Beispiel: Regelwerk-Fassung", html.includes("2026.07"));
pruef("Beispiel: Wand 4,20", html.includes(">4,20<"));
pruef("Beispiel: Wand 3,00", html.includes(">3,00<"));
pruef("Beispiel: Fläche 12,60", html.includes("12,60 m²"));
pruef("Beispiel: Geschoss EG", html.includes("<td>EG</td>"));
pruef("Beispiel: Einbauten-Tabelle", html.includes("<h2>Einbauten</h2>") && html.includes("Leuchte") && html.includes("Schalter"));
pruef("Beispiel: Schalter 1,05 + 6 cm = 1,11", html.includes("1,05 m") && html.includes("1,11 m"));
pruef("Beispiel: Öffnung Tür 89 × 201", html.includes("Tür") && html.includes("89 cm × 201 cm"));
pruef("Beispiel: Geräte", html.includes("Zählerschrank") && html.includes("Verteilerschrank (UV)"));
pruef("Beispiel: Normprüfung mit Quelle", html.includes("DIN VDE 0100-729"));
pruef("Beispiel: Maß-Herkunft erklärt", html.includes("Maß-Herkunft") && html.includes("eingegeben"));
pruef("Beispiel: Ehrlichkeitstexte", html.includes("Konservative Messung") && html.includes("Kein Rechts- oder Prüfnachweis"));
pruef("Beispiel: eigenes SVG mit Wänden", /<svg[^>]*viewBox="0 0 640 \d+"/.test(html) && html.includes(`stroke="#1d2a2a" stroke-width="5"`));
pruef("Beispiel: grüne Zonen", html.includes(`fill="#2e8b57"`));
pruef("Beispiel: Maßstabsleiste", html.includes(">1 m</text>"));
pruef("Beispiel: kein Live-SVG der App", !html.includes(`class="wand"`) && !html.includes(`class="klotz`));

// Gültiges PNG wird eingebettet und als F2 nummeriert.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
bsp.fotos.push({ id: "f2", raumId: bsp.raeume[0].id, relX: 0.8, relY: 0.2, titel: "Typenschild neu", datenUrl: PNG, notiz: "" });
html = berichtHtml(bsp, { datum: DATUM });
pruef("Foto: PNG eingebettet", html.includes(`<img src="${PNG}" alt="">`));
pruef("Foto: Pin F2 und Galerie F2", html.includes(">F2</text>") && html.includes("<b>F2</b> · Typenschild neu"));

// Raumauswahl und Variante
html = berichtHtml(bsp, { raumIds: [bsp.raeume[1].id], datum: DATUM });
pruef("Auswahl: nur eine Raumseite", zaehle(html, `class="blatt raum"`) === 1);
pruef("Auswahl: Lager drin", html.includes("<h1>Lager</h1>"));
pruef("Auswahl: Technikraum-Seite fehlt", !html.includes("<h1>Technikraum</h1>"));
html = berichtHtml(bsp, { raumIds: ["gibt-es-nicht"], datum: DATUM });
pruef("Auswahl ungültig → alle Räume", zaehle(html, `class="blatt raum"`) === 2);
bsp.varianten.push({ id: "v2", name: "Variante Leer", platzhalter: [] });
html = berichtHtml(bsp, { varianteIndex: 1, datum: DATUM });
pruef("Variante 2 gewählt", html.includes("Variante Leer") && html.includes("(2 von 2)"));
pruef("Variante 2: keine Geräte", html.includes("keine Geräte in dieser Variante"));

// Türen und Durchgänge aus Verbindungen erscheinen wie in Plan, 3D und AR der
// App: im Grundriss als Lücke mit Zeichen, in der Öffnungstabelle und in der
// Zählung auf dem Deckblatt – auch, wenn nur einer der beiden Räume gewählt ist.
{
  const vb = beispielProjekt();
  const [technik, lager] = vb.raeume;
  const wandGruppe = h => (h.match(/<g stroke="#1d2a2a" stroke-width="5" stroke-linecap="butt">([\s\S]*?)<\/g>/) || [, ""])[1];
  const seite = (h, name) => h.split(`class="blatt raum"`).find(t => t.includes(`<h1>${name}</h1>`)) || "";
  let h = berichtHtml(vb, { raumIds: [lager.id], datum: DATUM });
  sicher("Verbindung", h);
  const oeffnungsTeil = h.slice(h.indexOf("<h2>Öffnungen</h2>"), h.indexOf("<h2>Einbauten</h2>"));
  pruef("Verbindung: Durchgang in der Tabelle des Lagers",
    oeffnungsTeil.includes("Durchgang") && oeffnungsTeil.includes("(zu Technikraum)") && !oeffnungsTeil.includes("keine erfasst"), oeffnungsTeil);
  pruef("Verbindung: Wand 4, 90 × 210, ab 1,05 m",
    oeffnungsTeil.includes(`<td class="nw">Wand 4</td>`) && oeffnungsTeil.includes("90 cm × 210 cm") && oeffnungsTeil.includes("1,05 m"));
  pruef("Verbindung: Deckblatt zählt die Öffnung",
    /<td>T\.02<\/td>[\s\S]*?<td class="z">2,50<\/td>\s*<td class="z">1<\/td>/.test(h));
  pruef("Verbindung: Lücke im Grundriss (5 Wandstücke)", zaehle(wandGruppe(h), "<line") === 5, wandGruppe(h));
  pruef("Verbindung: Durchgangszeichen im Grundriss", zaehle(h, `fill="none" stroke-width="1.4"`) === 2);
  h = berichtHtml(vb, { datum: DATUM });
  pruef("Verbindung: Technikraum mit Tür und Durchgang", seite(h, "Technikraum").includes("(zu Lager)")
    && zaehle(wandGruppe(seite(h, "Technikraum")), "<line") === 6);
  pruef("Verbindung: Summe Öffnungen 3", /<th class="z">3<\/th><th class="z">2<\/th>/.test(h));
  // Grenzen die Räume nicht mehr aneinander, gibt es keine Öffnung.
  lager.xM = 6;
  h = berichtHtml(vb, { raumIds: [lager.id], datum: DATUM });
  pruef("Verbindung: nicht angrenzend → keine Öffnung", h.includes(`<td colspan="5">keine erfasst</td>`));
  // Kaputte und fremde Verbindungen: kein Absturz, alles maskiert.
  lager.xM = 4.2; lager.name = X;
  vb.verbindungen.push(null, "x", { id: "v2", raumA: technik.id }, { id: "v3", raumA: technik.id, raumB: technik.id },
    { id: "v4", raumA: lager.id, raumB: technik.id, art: `<script>alert(11)</script>`, breiteM: `"><x` });
  h = berichtHtml(vb, { datum: DATUM });
  sicher("Verbindung kaputt", h);
  pruef("Verbindung kaputt: maskiert", !h.includes("<script>alert(11)") && h.includes("(zu &lt;img src=x onerror=alert(1)&gt;)"));
}

// ------------------------------------------------ 2. L-Raum mit Öffnungen und Einbauten
const L = beispielProjekt();
const r0 = L.raeume[0];
L.raeume = [r0];
L.aktiverRaum = r0.id;
// L-Form im Uhrzeigersinn (y nach unten): 5 × 4 m, rechts unten 2 × 1,5 m ausgespart.
r0.name = "L-Werkstatt"; r0.nummer = "W.1"; r0.geschoss = -1; r0.aufbauM = 0.08;
r0.umriss = JSON.stringify([[0, 0], [5, 0], [5, 2.5], [3, 2.5], [3, 4], [0, 4]]);
r0.aufmass = { methode: "zielen", kalibriert: true, kamerahoeheM: 1.42, waende: [
  { quelle: "band", sigmaM: 0.005 }, { quelle: "gezielt", sigmaM: 0.031 }, { quelle: "gezielt", sigmaM: 0.02 },
  { quelle: "getippt", sigmaM: null }, { quelle: "band", sigmaM: 0.005 }, { quelle: "gezielt", sigmaM: 0.004 }] };
L.oeffnungen = [
  { id: "o1", raumId: r0.id, art: "TUER", wandIndex: 5, abstandM: 0.5, breiteM: 1.01, hoeheM: 2.135, bruestungM: 0 },
  { id: "o2", raumId: r0.id, art: "FENSTER", wandIndex: 0, abstandM: 1.5, breiteM: 1.2, hoeheM: 1.4, bruestungM: 0.9 },
  { id: "o3", raumId: r0.id, art: "DURCHGANG", wandIndex: 3, abstandM: 0.2, breiteM: 0.9, hoeheM: 2.1, bruestungM: 0 },
  { id: "o4", raumId: r0.id, art: "TOR", wandIndex: 9, abstandM: 0, breiteM: 2, hoeheM: 2, bruestungM: 0 }
];
L.einbauten = [
  { id: "e1", raumId: r0.id, art: "STECKDOSE_2FACH", befestigung: "WAND", wandIndex: 2, abstandM: 0.6, hoeheM: 0.3 },
  { id: "e2", raumId: r0.id, art: "RAUCHMELDER", befestigung: "DECKE", relX: 0.3, relY: 0.4, hoeheM: null },
  { id: "e3", raumId: r0.id, art: "REGAL", befestigung: "BODEN", relX: 0.1, relY: 0.8, hoeheM: 0 }
];
L.fotos = [];
L.varianten = [{ id: "v", name: "Plan B", platzhalter: [
  { id: "p1", raumId: r0.id, komponente: "HAUPTVERTEILUNG", xM: 2.5, yM: 0.2, drehungGrad: 0, bezeichnung: "NSHV" },
  { id: "p2", raumId: r0.id, komponente: "THERME", xM: 1.0, yM: 3.8, drehungGrad: 180, bezeichnung: "" },
  // Zu nah an der Wand gegenüber (Vorderkante 2,00 m, Wand bei 2,50 m) → Warnung.
  { id: "p3", raumId: r0.id, komponente: "SCHALTSCHRANK", xM: 4.0, yM: 1.8, drehungGrad: 0, bezeichnung: "" }
] }];
L.aktiveVariante = 0;
html = berichtHtml(L, { datum: DATUM });
sicher("L-Raum", html);
pruef("L: Name", html.includes("L-Werkstatt"));
pruef("L: Geschoss 1. UG", html.includes("1. UG"));
pruef("L: sechs Wände", html.includes(`<td class="nw">Wand 6</td><td class="z">4,00 m</td>`) && !html.includes("Wand 7<"));
pruef("L: Maße 5,00 2,50 2,00 1,50 3,00 4,00", [">5,00<", ">2,50<", ">2,00<", ">1,50<", ">3,00<", ">4,00<"].every(t => html.includes(t)));
pruef("L: Fläche 17,00", html.includes("17,00 m²"));
pruef("L: Herkunft Bandmaß", html.includes(">Bandmaß<"));
pruef("L: Herkunft gezielt ± 3 cm", html.includes("gezielt ± 3 cm"));
pruef("L: gezielt mindestens ± 1 cm", html.includes("gezielt ± 1 cm"));
pruef("L: Aufmaßtext", html.includes("Maßstab per Bandmaß gesetzt"));
pruef("L: Fenster mit Brüstung", html.includes("Fenster") && html.includes("120 cm × 140 cm") && html.includes(">90 cm<"));
pruef("L: Öffnung an fehlender Wand markiert", html.includes("Wand 9 (fehlt)"));
pruef("L: Einbau-Namen aus ARTEN", html.includes("Steckdose 2-fach") && html.includes("Rauchmelder") && html.includes("Regal"));
pruef("L: Steckdose 0,30 / 0,38 über Rohboden", html.includes("0,30 m") && html.includes("0,38 m"));
pruef("L: Rauchmelder an der Decke = Raumhöhe", html.includes("2,50 m <span class=\"grau\">(Decke)</span>"));
pruef("L: Befestigungen", html.includes("<td>Wand</td>") && html.includes("<td>Decke</td>") && html.includes("<td>Boden</td>"));
pruef("L: drei Einbau-Marken im Plan", [">1</text>", ">2</text>", ">3</text>"].every(t => html.includes(t)));
pruef("L: Warnung rot", html.includes(`fill="#c0392b"`) && html.includes("⚠ Warnung"));
pruef("L: Schaltschrank nur 48 cm", html.includes(">48 cm<"));
pruef("L: Bezeichnung NSHV", html.includes("NSHV"));
// Wärmequelle allein im Raum: nichts in der Nähe → „frei" statt 9999 cm.
L.varianten[0].platzhalter = [L.varianten[0].platzhalter[1]];
html = berichtHtml(L, { datum: DATUM });
pruef("L: Wärmequelle allein → frei", html.includes(">frei<"));
pruef("L: kein Sentinel 9999 cm", !html.includes("9999 cm"));

// ------------------------------------------------ 3. Bösartiges Projekt
const Q = `'"><script>alert(2)</script>`;
const boese = {
  name: `'><svg onload=alert(3)>`,
  raeume: [{
    id: `r1" onmouseover="alert(4)`, name: X, nummer: Q, geschoss: `<b>1</b>`,
    breiteM: 4.2, breiteVorneM: null, tiefeM: 3, schraege: "KEINE", umriss: "",
    hoeheM: `2.5"><script>`, aufbauM: `"><img src=x>`, xM: 0, yM: 0, drehungGrad: 0,
    farbe: `red" onload="alert(5)`, notiz: `Zeile 1\n<script>alert(6)</script>`,
    aufmass: { methode: `<script>`, waende: [{ quelle: `<img src=x onerror=1>`, sigmaM: `"><b>` }] }
  }, {
    id: "r2", name: `Zweiter ${Q}`, nummer: "", geschoss: 2, breiteM: 2, tiefeM: 2, umriss: `[[0,0],[2,0],["<x>",2]]`,
    hoeheM: 2.4, farbe: "#abcdef"
  }],
  aktiverRaum: `r1" onmouseover="alert(4)`,
  oeffnungen: [{ id: `o"><script>`, raumId: `r1" onmouseover="alert(4)`, art: `<script>alert(7)</script>`,
    bezeichnung: X, wandIndex: `0"><img src=x>`, abstandM: `1"><x`, breiteM: 0.9, hoeheM: `"><x`, bruestungM: 0 }],
  einbauten: [{ id: "e1", raumId: `r1" onmouseover="alert(4)`, art: X, befestigung: `"><script>`, wandIndex: 0,
    abstandM: 1, hoeheM: 1, relX: `"><x`, relY: 0.5 },
  { id: "e2", raumId: `r1" onmouseover="alert(4)`, art: "SCHALTER", befestigung: "WAND", wandIndex: `<x>`, abstandM: `<y>`, hoeheM: 1.05 }],
  fotos: [
    { id: "f1", raumId: `r1" onmouseover="alert(4)`, relX: 0.5, relY: 0.5, titel: Q, notiz: X, datenUrl: "javascript:alert(8)" },
    { id: "f2", raumId: `r1" onmouseover="alert(4)`, relX: `"><x`, relY: 0.5, titel: "svg", notiz: "",
      datenUrl: `data:image/svg+xml,<svg onload=alert(9)>` },
    { id: "f3", raumId: `r1" onmouseover="alert(4)`, relX: 0.1, relY: 0.1, titel: "ok", notiz: "",
      datenUrl: `data:image/png;base64,iVBORw0KGgo="><script>alert(10)</script>` }
  ],
  varianten: [{ id: "v", name: Q, platzhalter: [
    { id: "p1", raumId: `r1" onmouseover="alert(4)`, komponente: X, xM: 1, yM: 2, drehungGrad: 0, bezeichnung: Q },
    { id: `p2"><script>`, raumId: `r1" onmouseover="alert(4)`, komponente: "ZAEHLERSCHRANK", xM: `2"><x`, yM: 2.9, drehungGrad: 180, bezeichnung: X },
    { id: "p3", raumId: `r1" onmouseover="alert(4)`, komponente: "USV", xM: 3, yM: 1, drehungGrad: `"><script>`, bezeichnung: "" }
  ] }],
  aktiveVariante: `"><script>`
};
html = berichtHtml(boese, { datum: DATUM });
sicher("Bösartig", html);
pruef("Bösartig: kein rohes <img src=x", !html.includes("<img src=x"));
pruef("Bösartig: kein '><svg", !html.includes("'><svg"));
pruef("Bösartig: kein \"><script>", !html.includes(`"><script>`));
pruef("Bösartig: Farbe verworfen", !html.includes(`red"`) && !html.includes("onload=\"alert"));
pruef("Bösartig: keine IDs im Bericht", !html.includes("onmouseover"));
pruef("Bösartig: Raumname maskiert sichtbar", html.includes("&lt;img src=x onerror=alert(1)&gt;"));
pruef("Bösartig: zweiter Raum maskiert sichtbar", html.includes("Zweiter &#39;&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
pruef("Bösartig: Notiz maskiert mit Zeilenumbruch", html.includes("Zeile 1<br>&lt;script&gt;alert(6)&lt;/script&gt;"));
pruef("Bösartig: Fotos ohne gültige URL → Platzhalter", zaehle(html, "Format nicht unterstützt") === 3);
pruef("Bösartig: kaputtes Base64 nicht eingebettet",
  !html.includes("iVBORw0KGgo"));
pruef("Bösartig: Raum mit kaputtem Umriss → kein Absturz", html.includes("Zweiter"));
pruef("Bösartig: Wert 4,20 trotzdem da", html.includes(">4,20<"));

// ------------------------------------------------ 4. Unvollständige Projekte stürzen nicht ab
for (const [name, p] of [["leer", {}], ["null", null], ["ohne Varianten", { name: "x", raeume: [{ id: "a", name: "A", breiteM: 0, tiefeM: 0 }] }]]) {
  let h = "";
  try { h = berichtHtml(p, { datum: DATUM }); } catch (e) { pruef(`${name}: kein Absturz`, false, e.message); continue; }
  pruef(`${name}: Dokument`, h.startsWith("<!doctype html>") && h.endsWith("</html>"));
  sicher(name, h);
}

// ------------------------------------------------ 5. Service Worker: offline vollständig
// Bericht und App sollen offline laufen. Dafür muss der Vorab-Cache (HUELLE in
// sw.js) jede Datei enthalten, die PC- und Mobil-Seite laden – auch die erst
// per import() nachgeladenen Module (AR, Assistent, Scan, 3D) samt deren
// Importen. Sonst bricht z. B. der AR-Start offline mit „Kamera/WebGL nötig" ab.
{
  const basis = path.join(path.dirname(fileURLToPath(import.meta.url)), "../raumwerk/");
  const sw = fs.readFileSync(basis + "sw.js", "utf8");
  const huelleText = sw.match(/const HUELLE = (\[[\s\S]*?\]);/);
  const huelle = huelleText ? new Function(`return ${huelleText[1]};`)() : [];
  // "./" und "./mobil/" sind die Seiten selbst.
  const datei = u => { const f = path.resolve(basis, u); return u.endsWith("/") ? path.join(f, "index.html") : f; };
  const imCache = new Set(huelle.map(datei));
  pruef("SW: HUELLE gelesen", huelle.length > 20);
  const fehlend = huelle.filter(u => !fs.existsSync(datei(u)));
  pruef("SW: jede Datei der HUELLE gibt es", fehlend.length === 0, fehlend.join(" "));

  // Alles einsammeln, was die Seiten laden: Skripte, Stile, Manifest, Symbole,
  // Schriften, statische und dynamische Importe.
  const gesehen = new Set();
  const offen = [basis + "index.html", basis + "mobil/index.html"];
  const lokal = u => u && !/^(data:|https?:|\/\/|#)/.test(u);
  while (offen.length) {
    const f = offen.pop();
    if (gesehen.has(f) || !fs.existsSync(f)) continue;
    gesehen.add(f);
    const text = fs.readFileSync(f, "utf8");
    const verweise = [];
    if (/\.html$/.test(f)) for (const m of text.matchAll(/\b(?:src|href)="([^"]+)"/g)) verweise.push(m[1]);
    if (/\.css$/.test(f)) for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) verweise.push(m[1]);
    if (/\.m?js$/.test(f)) for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) verweise.push(m[1]);
    if (/\.webmanifest$/.test(f)) for (const i of JSON.parse(text).icons || []) verweise.push(i.src);
    for (const u of verweise.filter(lokal)) offen.push(path.resolve(path.dirname(f), u.split(/[?#]/)[0]));
  }
  // Skins hängt index.html per ?skin= an (Android-App) – alle vorhandenen.
  for (const s of fs.readdirSync(basis + "skins")) if (s.endsWith(".css")) gesehen.add(basis + "skins/" + s);
  const nichtImCache = [...gesehen].filter(f => !imCache.has(f)).map(f => path.relative(basis, f));
  pruef("SW: alles Geladene im Vorab-Cache", nichtImCache.length === 0, nichtImCache.join(" "));
  pruef("SW: AR-Abhängigkeit ausrichten.js im Cache", imCache.has(path.resolve(basis, "../ausrichten.js")));
  pruef("SW: Module erreicht (inkl. Lazy-Importe)", ["ar.js", "assistent.js", "scan.js", "wolke3d.js", "../modell3d.js", "../ausrichten.js"]
    .every(u => gesehen.has(path.resolve(basis, u))));
  // v3 ging ohne ausrichten.js aus; erst ein neuer Cache-Name lässt
  // installierte Clients die vollständige Liste laden.
  const version = Number((sw.match(/const CACHE = "raumwerk-app-v(\d+)"/) || [])[1]);
  pruef("SW: Cache-Version nach v3 erhöht", version >= 4, String(version));
}

// ------------------------------------------------ 6. API
pruef("berichtOeffnen exportiert", typeof berichtOeffnen === "function");
pruef("bericht (veraltet) exportiert", typeof bericht === "function");

console.log(`report: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exit(1);
