/*
 * PDF-Report – das eigentliche Ergebnis des Werkzeugs (Konzept §3, §12).
 *
 * Bewusst ohne Fremdbibliothek: Der Bericht ist ein eigenständiges HTML-
 * Dokument (Stil inline, keine Netzressource), das über die Druckfunktion als
 * PDF gesichert wird. Das läuft offline, im Kundenlink, in der Android-App
 * (Druckdienst über `window.__native.drucken`) und ohne Serverlast.
 *
 * Zwei Teile:
 *  · `berichtHtml(projekt, opts)` – reine Funktion, baut den kompletten Text.
 *    Kein `window`, kein `document`: in Node testbar (web/tests/report.test.mjs).
 *  · `berichtOeffnen(projekt, opts)` – zeigt ihn an: App-Druckdienst, sonst
 *    neuer Tab (Blob-URL), sonst Download.
 *
 * Der Grundriss wird hier **selbst** gezeichnet, mit Farben und Strichstärken
 * als SVG-Attributen. Das Live-SVG der App taugt dafür nicht: dessen Aussehen
 * steckt in styles.css, im Bericht fehlten sonst Wände, und Zonen würden
 * schwarz.
 *
 * Aufgenommen wird auch die **Maß-Herkunft** und die konservative
 * Rundungsregel – das ist die rechtliche Absicherung aus §7/§14: klar sagen,
 * welche Zahl verlässlich ist und dass Freiräume untere Schranken sind.
 *
 * Sicherheit: Jeder Wert aus dem Projekt läuft durch `esc()` (auch das
 * einfache Anführungszeichen); Zahlen werden mit Number() gezwungen, Farben und
 * Foto-Daten gegen eine Positivliste geprüft. IDs erscheinen im Bericht nicht.
 */

import * as G from "../geometrie.js";
import { finde } from "../komponenten.js";
import { VERSION, fuer, Richtung } from "../regelwerk.js";
import { pruefe, grundriss } from "../pruefung.js";
import { ARTEN } from "../normmasse.js";
import { waendeMitHerkunft } from "./uebernahme.js";

// ------------------------------------------------------------ Öffentlich

/**
 * Den kompletten Bericht als HTML-Text bauen.
 *
 * opts: { varianteIndex = projekt.aktiveVariante,
 *         raumIds = alle Räume (Reihenfolge des Projekts),
 *         datum = new Date() }
 */
export function berichtHtml(projekt, opts = {}) {
  const p = projekt && typeof projekt === "object" ? projekt : {};
  const alleRaeume = liste(p.raeume).filter(r => r && typeof r === "object");
  const varianten = liste(p.varianten).filter(v => v && typeof v === "object");
  let vi = Number(opts.varianteIndex ?? p.aktiveVariante ?? 0);
  if (!Number.isInteger(vi) || vi < 0 || vi >= varianten.length) vi = 0;
  const variante = varianten[vi] || { name: "–", platzhalter: [] };
  const platzhalterAlle = liste(variante.platzhalter).filter(x => x && typeof x === "object");

  // Raumauswahl: Reihenfolge des Projekts; nichts Gültiges gewählt → alle.
  let raeume = alleRaeume;
  if (Array.isArray(opts.raumIds)) {
    const gewaehlt = new Set(opts.raumIds);
    const treffer = alleRaeume.filter(r => gewaehlt.has(r.id));
    if (treffer.length) raeume = treffer;
  }

  const datum = datumText(opts.datum instanceof Date && !isNaN(opts.datum) ? opts.datum : new Date());
  const daten = raeume.map((raum, i) => raumDaten(p, raum, platzhalterAlle, i));
  const titel = `RAUMWERK – ${p.name ? String(p.name) : "Projekt"} – ${variante.name ?? ""}`;

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<style>${STIL}</style></head><body>
<div class="leiste kein-druck"><span>RAUMWERK-Bericht · ${esc(p.name || "Projekt")}</span><button type="button" class="knopf" onclick="window.print()">Drucken / Als PDF speichern</button></div>
${deckblatt(p, variante, vi, varianten.length, daten, datum)}
${daten.map(d => raumSeite(d, variante, datum)).join("\n")}
</body></html>`;
}

/**
 * Bericht anzeigen. In der Android-App über den Druckdienst; im Browser in
 * einem neuen Tab (Blob-URL, ohne Zugriff zurück auf die App); ist der Tab
 * blockiert, als HTML-Datei über `__native.teilen` (Teilen-Menü/Download).
 * Gibt ein Promise mit dem genommenen Weg: "drucken" | "tab" | "datei" | "fehler".
 */
export function berichtOeffnen(projekt, opts = {}) {
  const html = berichtHtml(projekt, opts);
  const name = String(projekt?.name || "Projekt");
  const titel = `RAUMWERK – ${name}`;
  const N = typeof window !== "undefined" ? window.__native : null;

  // 1. Android-App: nativer Druckdialog („Als PDF speichern").
  if (N && N.app && typeof N.drucken === "function") {
    try { if (N.drucken(html, titel)) return Promise.resolve("drucken"); } catch (_) { /* Browserweg */ }
  }

  // 2. Browser: neuer Tab mit Blob-URL. Bewusst ohne "noopener" im
  //    Feature-Text – damit liefert window.open laut Norm immer null, und ein
  //    blockiertes Pop-up wäre nicht zu erkennen. Stattdessen wird die
  //    Rückverbindung sofort gekappt, bevor das Dokument überhaupt lädt.
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const fenster = window.open(url, "_blank");
    if (fenster) {
      try { fenster.opener = null; } catch (_) { /* egal */ }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      return Promise.resolve("tab");
    }
  } catch (_) { /* blockiert → Datei */ }
  if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* egal */ } }

  // 3. Rückfall: als Datei weitergeben.
  const datei = `RAUMWERK_${name.replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, "_").slice(0, 60) || "Bericht"}.html`;
  const weitergabe = N && typeof N.teilen === "function"
    ? N.teilen(datei, "text/html", html)
    : Promise.resolve(herunterladen(datei, html));
  return Promise.resolve(weitergabe).then(ok => (ok ? "datei" : "fehler"), () => "fehler");
}

/**
 * Veraltet – alter Aufruf aus App und Mobil-Ansicht (Live-SVG wird ignoriert).
 * Bleibt, bis beide auf `berichtOeffnen` umgestellt sind.
 */
export function bericht(projekt, variante, befunde, svgMarkup, svgGroesse) {
  const index = liste(projekt?.varianten).indexOf(variante);
  return berichtOeffnen(projekt, {
    raumIds: [projekt?.aktiverRaum],
    varianteIndex: index >= 0 ? index : undefined
  });
}

// ------------------------------------------------------------ Daten je Raum

/** Alles, was Deckblatt und Raumseite über einen Raum brauchen – einmal gerechnet. */
function raumDaten(p, raum, platzhalterAlle, index) {
  const oeffnungen = liste(p.oeffnungen).filter(o => o && o.raumId === raum.id);
  const einbauten = liste(p.einbauten).filter(e => e && e.raumId === raum.id);
  const fotos = liste(p.fotos).filter(f => f && f.raumId === raum.id);
  const platzhalter = platzhalterAlle.filter(ph => ph.raumId === raum.id);
  const ecken = sicher(() => G.ecken(raum), []);
  const gueltig = ecken.length >= 3 && ecken.every(q => isFinite(q[0]) && isFinite(q[1]));
  const laengen = gueltig ? G.wandLaengen(raum) : [];
  const flaeche = gueltig ? G.flaeche(raum) : NaN;
  const umfang = laengen.reduce((a, b) => a + b, 0);
  const befunde = sicher(() => pruefe(raum, platzhalter), []);
  const waende = sicher(() => waendeMitHerkunft(raum), laengen.map(l => ({ laenge: l, quelle: "getippt", sigmaM: null })));
  return {
    nr: index + 1, raum, oeffnungen, einbauten, fotos, platzhalter, ecken, gueltig,
    laengen, flaeche, umfang, befunde, waende,
    warnungen: befunde.filter(b => b.schwere === "WARNUNG").length
  };
}

// ------------------------------------------------------------ Deckblatt

function deckblatt(p, variante, vi, anzahlVarianten, daten, datum) {
  const summe = (f) => daten.reduce((s, d) => s + f(d), 0);
  const flaecheGesamt = summe(d => (isFinite(d.flaeche) ? d.flaeche : 0));
  const warnGesamt = summe(d => d.warnungen);
  const zeilen = daten.map(d => `<tr${d.warnungen ? ` class="b-warnung"` : ""}>
    <td>${esc(d.raum.nummer || "")}</td><td>${esc(d.raum.name || `Raum ${d.nr}`)}</td>
    <td>${esc(geschossName(d.raum.geschoss))}</td>
    <td class="z">${zahl(d.flaeche, 2)}</td><td class="z">${zahl(d.umfang, 2)}</td>
    <td class="z">${zahl(d.raum.hoeheM, 2)}</td>
    <td class="z">${d.oeffnungen.length}</td><td class="z">${d.einbauten.length}</td>
    <td class="z">${d.platzhalter.length}</td>
    <td class="z">${d.warnungen ? `<b>${d.warnungen}</b>` : "–"}</td></tr>`).join("");

  return `<section class="blatt deckblatt">
<div class="kopf">
  <div>
    <div class="marke">RAUMWERK · AUFMASS- &amp; PLANUNGSREPORT</div>
    <h1>${esc(p.name || "Projekt")}</h1>
    <div>Variante: <b>${esc(variante.name ?? "–")}</b>${anzahlVarianten > 1 ? ` (${vi + 1} von ${anzahlVarianten})` : ""}</div>
  </div>
  <div class="meta">${esc(datum)}<br>Regelwerk-Fassung ${esc(VERSION)}<br>
    <b class="${warnGesamt ? "rot" : "gruen"}">${warnGesamt ? `${warnGesamt} Warnung(en)` : "keine Warnungen"}</b></div>
</div>

<div class="kennzahlen">
  ${kennzahl(String(daten.length), daten.length === 1 ? "Raum" : "Räume")}
  ${kennzahl(`${zahl(flaecheGesamt, 2)} m²`, "Grundfläche gesamt")}
  ${kennzahl(String(summe(d => d.platzhalter.length)), "Geräte geplant")}
  ${kennzahl(String(warnGesamt), "Warnungen")}
</div>

<h2>Raumübersicht</h2>
<div class="tabelle"><table>
  <thead><tr><th>Nr.</th><th>Raum</th><th>Geschoss</th><th class="z">Fläche m²</th><th class="z">Umfang m</th>
  <th class="z">Höhe m</th><th class="z">Öffn.</th><th class="z">Einb.</th><th class="z">Geräte</th><th class="z">Warn.</th></tr></thead>
  <tbody>${zeilen || `<tr><td colspan="10">Keine Räume erfasst.</td></tr>`}</tbody>
  <tfoot><tr><th colspan="3">Summe</th><th class="z">${zahl(flaecheGesamt, 2)}</th><th></th><th></th>
  <th class="z">${summe(d => d.oeffnungen.length)}</th><th class="z">${summe(d => d.einbauten.length)}</th>
  <th class="z">${summe(d => d.platzhalter.length)}</th><th class="z">${warnGesamt || "–"}</th></tr></tfoot>
</table></div>

<h2>Hinweise zur Genauigkeit</h2>
<div class="hinweis"><b>Konservative Messung.</b> Alle Freiräume sind untere Schranken:
gemessener Wert minus Toleranz, auf ganze Zentimeter abgerundet. „vorhanden (mind.)“
heißt, dass mindestens dieser Abstand tatsächlich frei ist. Freiraumwerte aus der
Foto-Rekonstruktion sind Kontextmaße (± cm); laser- oder kataloggesicherte Maße gelten als verlässlich.</div>
<div class="hinweis"><b>Maß-Herkunft.</b> Jede Wandlänge trägt ihre Herkunft:
<b>Bandmaß</b> – mit Maßband oder Laser genommen, verlässlich;
<b>gezielt ± x cm</b> – mit der Handykamera angepeilt, mit der angegebenen Unsicherheit (eine Standardabweichung);
<b>eingegeben</b> – so übernommen, wie es eingetippt wurde, ohne eigene Messung.
Wer eine Wand nachmisst, macht aus „gezielt“ oder „eingegeben“ ein Bandmaß.</div>
${fuss()}
</section>`;
}

// ------------------------------------------------------------ Raumseite

function raumSeite(d, variante, datum) {
  const { raum } = d;
  const aufbau = Number(raum.aufbauM) || 0;
  const hoehe = Number(raum.hoeheM);
  const volumen = isFinite(d.flaeche) && isFinite(hoehe) ? d.flaeche * hoehe : NaN;

  return `<section class="blatt raum">
<div class="kopf">
  <div>
    <div class="marke">RAUM ${d.nr}${raum.nummer ? ` · ${esc(raum.nummer)}` : ""}</div>
    <h1>${esc(raum.name || `Raum ${d.nr}`)}</h1>
    <div>Geschoss ${esc(geschossName(raum.geschoss))} · ${varianteText(variante)}</div>
  </div>
  <div class="meta">${esc(datum)}<br>${esc(aufmassText(raum))}<br>
    <b class="${d.warnungen ? "rot" : "gruen"}">${d.warnungen ? `${d.warnungen} Warnung(en)` : "keine Warnungen"}</b></div>
</div>

<div class="kennzahlen">
  ${kennzahl(`${zahl(d.flaeche, 2)} m²`, "Grundfläche")}
  ${kennzahl(`${zahl(d.umfang, 2)} m`, "Wandumfang")}
  ${kennzahl(`${zahl(hoehe, 2)} m`, "Raumhöhe (ab Fertigfußboden)")}
  ${kennzahl(`${Math.round(aufbau * 100)} cm`, "Fußbodenaufbau")}
  ${kennzahl(`${zahl(volumen, 1)} m³`, "Rauminhalt")}
</div>
${raum.notiz ? `<div class="notiz">${mehrzeilig(raum.notiz)}</div>` : ""}

<h2>Grundriss</h2>
<figure class="plan">${planSvg(d)}${legende()}</figure>

<h2>Wände</h2>
${wandTabelle(d)}

<h2>Öffnungen</h2>
${oeffnungsTabelle(d)}

<h2>Einbauten</h2>
${einbauTabelle(d)}

<h2>Geplante Geräte</h2>
${geraeteTabelle(d)}

<h2>Normprüfung</h2>
${befundTabelle(d)}
<p class="klein">Freiräume sind untere Schranken (konservative Messung, siehe Deckblatt).
Prüfung nach Regelwerk-Fassung ${esc(VERSION)}.</p>

${fotoGalerie(d)}
${fuss()}
</section>`;
}

function wandTabelle(d) {
  if (!d.laengen.length) return `<p class="klein">Keine gültigen Raummaße – Grundriss fehlt.</p>`;
  const zeilen = d.laengen.map((l, i) => {
    const w = d.waende[i] || {};
    const quelle = quelleText(w.quelle, w.sigmaM);
    return `<tr><td class="nw">Wand ${i + 1}</td><td class="z">${zahl(l, 2)} m</td>
      <td><span class="quelle-${quelle.klasse}">${esc(quelle.text)}</span></td></tr>`;
  }).join("");
  return `<div class="tabelle"><table class="schmal"><thead><tr><th>Wand</th><th class="z">Länge</th><th>Maß-Herkunft</th></tr></thead>
<tbody>${zeilen}</tbody></table></div>`;
}

function oeffnungsTabelle(d) {
  const n = d.laengen.length;
  // Nach Wand und Lage sortiert – so liest man den Raum im Uhrzeigersinn ab.
  const sortiert = [...d.oeffnungen].sort((a, b) =>
    (Number(a.wandIndex) || 0) - (Number(b.wandIndex) || 0) || (Number(a.abstandM) || 0) - (Number(b.abstandM) || 0));
  const zeilen = sortiert.map(o => {
    const w = Number(o.wandIndex ?? 0);
    const wand = Number.isInteger(w) && w >= 0 && w < n ? `Wand ${w + 1}` : `Wand ${esc(String(o.wandIndex))} (fehlt)`;
    const bez = o.bezeichnung ? ` <span class="grau">(${esc(o.bezeichnung)})</span>` : "";
    return `<tr><td class="nw">${wand}</td><td>${esc(oeffnungsName(o.art))}${bez}</td>
      <td class="z">${cm(o.breiteM)} × ${cm(o.hoeheM)}</td>
      <td class="z">${Number(o.bruestungM) > 0 ? cm(o.bruestungM) : "–"}</td>
      <td class="z">${zahl(o.abstandM, 2)} m</td></tr>`;
  }).join("");
  return `<div class="tabelle"><table><thead><tr><th>Wand</th><th>Art</th><th class="z">Breite × Höhe</th>
<th class="z">Brüstung</th><th class="z">ab Wandanfang</th></tr></thead>
<tbody>${zeilen || `<tr><td colspan="5">keine erfasst</td></tr>`}</tbody></table></div>`;
}

function einbauTabelle(d) {
  const { raum } = d;
  const aufbau = Number(raum.aufbauM) || 0;
  const n = d.laengen.length;
  const zeilen = d.einbauten.map((e, i) => {
    const bef = befestigungName(e.befestigung);
    let wand = "–", lage = "–";
    if (e.befestigung === "WAND") {
      const w = Number(e.wandIndex ?? 0);
      wand = Number.isInteger(w) && w >= 0 && w < n ? `Wand ${w + 1}` : `Wand ${esc(String(e.wandIndex))} (fehlt)`;
      lage = `${zahl(e.abstandM, 2)} m`;
    } else if (d.gueltig) {
      const l = sicher(() => G.lageImRaum(raum, e), null);
      if (l && isFinite(l.x) && isFinite(l.y)) lage = `x ${zahl(l.x, 2)} / y ${zahl(l.y, 2)} m`;
    }
    let h = Number(e.hoeheM);
    let richtwert = false;
    if (e.hoeheM == null || !isFinite(h)) {
      if (e.befestigung === "DECKE" && isFinite(Number(raum.hoeheM))) { h = Number(raum.hoeheM); richtwert = true; }
      else h = NaN;
    }
    const zusatz = richtwert ? ` <span class="grau">(Decke)</span>` : "";
    return `<tr><td><span class="marke-ein">${i + 1}</span></td><td>${esc(einbauName(e.art))}</td><td>${esc(bef)}</td>
      <td class="nw">${wand}</td><td class="z">${lage}</td>
      <td class="z">${isFinite(h) ? `${zahl(h, 2)} m` : "–"}${zusatz}</td>
      <td class="z">${isFinite(h) ? `${zahl(h + aufbau, 2)} m` : "–"}</td></tr>`;
  }).join("");
  return `<div class="tabelle"><table><thead><tr><th>Nr.</th><th>Art</th><th>Befestigung</th><th>Wand</th>
<th class="z">ab Wandanfang / Lage</th><th class="z">Höhe ü. Fertigfußboden</th><th class="z">Höhe ü. Rohboden</th></tr></thead>
<tbody>${zeilen || `<tr><td colspan="7">keine erfasst</td></tr>`}</tbody></table></div>
${d.einbauten.length ? `<p class="klein">Höhe über Rohboden = Höhe über Fertigfußboden + Fußbodenaufbau (${Math.round(aufbau * 100)} cm). Lage x/y ab der linken oberen Ecke des Grundrisses.</p>` : ""}`;
}

function geraeteTabelle(d) {
  const zeilen = d.platzhalter.map((ph, i) => {
    const k = finde(ph.komponente);
    const warn = d.befunde.some(b => b.platzhalterId === ph.id && b.schwere === "WARNUNG");
    const drin = d.gueltig && sicher(() => G.imRaum(d.raum, Number(ph.xM), Number(ph.yM)), true);
    const status = !k ? `<span class="rot">unbekannter Typ</span>`
      : !drin ? `<span class="rot">außerhalb des Raums</span>`
        : warn ? `<span class="rot">⚠ Warnung</span>` : `<span class="gruen">✓ geprüft</span>`;
    return `<tr${warn ? ` class="b-warnung"` : ""}><td><span class="marke-ger">G${i + 1}</span></td>
      <td>${esc(ph.bezeichnung || (k ? k.name : ph.komponente))}</td>
      <td>${esc(k ? k.name : String(ph.komponente ?? "–"))}</td>
      <td class="z">${k ? `${cm(k.breiteM)} × ${cm(k.tiefeM)} × ${cm(k.hoeheM)}` : "–"}</td>
      <td class="z">x ${zahl(ph.xM, 2)} / y ${zahl(ph.yM, 2)} m · ${Math.round(Number(ph.drehungGrad) || 0)}°</td>
      <td>${status}</td></tr>`;
  }).join("");
  return `<div class="tabelle"><table><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Typ</th>
<th class="z">Baumaß B × T × H</th><th class="z">Lage (Mitte) · Drehung</th><th>Status</th></tr></thead>
<tbody>${zeilen || `<tr><td colspan="6">keine Geräte in dieser Variante</td></tr>`}</tbody></table></div>`;
}

function befundTabelle(d) {
  const nummer = new Map(d.platzhalter.map((ph, i) => [ph.id, `G${i + 1}`]));
  const zeilen = [...d.befunde].sort(schwereZuerst).map(b => `
    <tr class="b-${esc(String(b.schwere).toLowerCase())}">
      <td>${esc(statusText(b.schwere))}</td>
      <td>${esc(nummer.get(b.platzhalterId) || "")} ${esc(b.komponenteName)}</td>
      <td>${esc(b.regelTitel)}<br><span class="grau">${esc(b.text || "")}</span></td>
      <td class="z">${abstandText(b.verfuegbarM, b.regelId)}</td>
      <td class="z">${abstandText(b.erforderlichM, b.regelId)}</td>
      <td class="quelle">${esc(b.quelle)}<br>Fassung ${esc(b.regelVersion || VERSION)}</td>
    </tr>`).join("");
  return `<div class="tabelle"><table><thead><tr><th>Status</th><th>Gerät</th><th>Regel</th><th class="z">vorhanden (mind.)</th>
<th class="z">gefordert</th><th>Quelle</th></tr></thead>
<tbody>${zeilen || `<tr><td colspan="6">Keine prüfpflichtigen Geräte platziert.</td></tr>`}</tbody></table></div>`;
}

function fotoGalerie(d) {
  if (!d.fotos.length) return "";
  const bilder = d.fotos.map((f, i) => {
    const url = bildUrl(f.datenUrl);
    const bild = url ? `<img src="${esc(url)}" alt="">`
      : `<div class="kein-bild">Bild nicht eingebettet (Format nicht unterstützt)</div>`;
    return `<figure class="foto">${bild}<figcaption><b>F${i + 1}</b> · ${esc(f.titel || "Foto")}${f.notiz ? `<br><span>${esc(f.notiz)}</span>` : ""}</figcaption></figure>`;
  }).join("");
  return `<h2>Verortete Fotos</h2><div class="galerie">${bilder}</div>`;
}

// ------------------------------------------------------------ Grundriss-SVG

const PLAN_B = 640;        // Breite in SVG-Einheiten (≈ 170 mm im Druck, 1 Einheit ≈ 1 px)
const PLAN_H_MAX = 600;    // höchstens so hoch – passt mit Kopf auf eine A4-Seite
const RAND = 60;           // Platz um den Raum für Maßketten
const LEISTE = 16;         // Maßstabsleiste unten
const WAND_PX = 5;         // Wandstrich
const MASS_ABSTAND = 26;   // Maßlinie vor der Wand
const FARBE = {
  wand: "#1d2a2a", mass: "#3d4d4d", tk: "#2b7a78", tkDunkel: "#17494d",
  ok: "#2e8b57", warn: "#c0392b", geraet: "#e3eaed", geraetRand: "#4a5a5a",
  einbau: "#1f4e79", foto: "#d98324", fotoDunkel: "#8a4b0a"
};

/** Der Grundriss eines Raums – eigenständiges SVG, alle Stile als Attribute. */
function planSvg(d) {
  const { raum, ecken: e } = d;
  if (!d.gueltig || !(d.flaeche > 0.01)) {
    return `<div class="kein-plan">Kein Grundriss – Breite/Tiefe oder Umriss fehlen.</div>`;
  }

  // Ausschnitt: der Raum, dazu Geräte und Zonen, die höchstens 1,5 m hinausragen.
  const xs = e.map(q => q[0]), ys = e.map(q => q[1]);
  const rMinX = Math.min(...xs), rMaxX = Math.max(...xs), rMinY = Math.min(...ys), rMaxY = Math.max(...ys);
  let minX = rMinX, maxX = rMaxX, minY = rMinY, maxY = rMaxY;
  const geraete = d.platzhalter.map((ph, i) => ({ ph, i, komp: finde(ph.komponente) }))
    .filter(x => x.komp && [x.ph.xM, x.ph.yM, x.ph.drehungGrad || 0].every(v => isFinite(Number(v))));
  for (const { ph, komp } of geraete) {
    const zone = zonenPunkte(ph, komp);
    for (const q of grundriss(ph, komp).concat(zone ? (zone.huelle || zone.punkte) : [])) {
      minX = Math.min(minX, Math.max(q[0], rMinX - 1.5)); maxX = Math.max(maxX, Math.min(q[0], rMaxX + 1.5));
      minY = Math.min(minY, Math.max(q[1], rMinY - 1.5)); maxY = Math.max(maxY, Math.min(q[1], rMaxY + 1.5));
    }
  }
  const bw = Math.max(0.1, maxX - minX), bh = Math.max(0.1, maxY - minY);
  const s = Math.min((PLAN_B - 2 * RAND) / bw, (PLAN_H_MAX - 2 * RAND - LEISTE) / bh, 240);
  const hoehe = Math.round(bh * s + 2 * RAND + LEISTE);
  const ox = (PLAN_B - bw * s) / 2 - minX * s, oy = RAND - minY * s;
  const P = (x, y) => [r1(ox + x * s), r1(oy + y * s)];
  const pts = punkte => punkte.map(q => P(q[0], q[1]).join(",")).join(" ");

  // Umlaufsinn: bestimmt, wo „außen" ist (Maßketten) und wohin Türen schlagen.
  let flaecheSigniert = 0;
  for (let i = 0; i < e.length; i++) {
    const a = e[i], b = e[(i + 1) % e.length];
    flaecheSigniert += a[0] * b[1] - b[0] * a[1];
  }
  const uhrzeiger = flaecheSigniert > 0;   // y nach unten: positiv = im Uhrzeigersinn
  const wand = i => {
    const a = e[i], b = e[(i + 1) % e.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    const aussen = uhrzeiger ? [uy, -ux] : [-uy, ux];
    return { a, b, l, ux, uy, aussen, winkel: Math.atan2(dy, dx) * 180 / Math.PI };
  };

  const teile = [];
  const farbe = FARBE_OK.test(String(raum.farbe || "")) ? raum.farbe : "#cfe8e9";
  teile.push(`<polygon points="${pts(e)}" fill="${esc(farbe)}" fill-opacity="0.45" stroke="none"/>`);

  // Zonen unter den Geräten, damit die Kästen lesbar bleiben.
  for (const { ph, komp } of geraete) teile.push(zonenSvg(ph, komp, d.befunde, P, s));

  // Wände mit Lücken für Öffnungen.
  const linien = [];
  for (let i = 0; i < e.length; i++) {
    const w = wand(i);
    const loecher = d.oeffnungen.filter(o => Number(o.wandIndex ?? 0) === i)
      .map(o => [klemm(Number(o.abstandM) || 0, 0, w.l), klemm((Number(o.abstandM) || 0) + (Number(o.breiteM) || 0), 0, w.l)])
      .filter(([v, b]) => b - v > 0.005)
      .sort((x, y) => x[0] - y[0]);
    let t = 0;
    const stuecke = [];
    for (const [v, b] of loecher) { if (v > t) stuecke.push([t, v]); t = Math.max(t, b); }
    if (t < w.l) stuecke.push([t, w.l]);
    for (const [v, b] of stuecke) {
      const A = P(w.a[0] + w.ux * v, w.a[1] + w.uy * v), B = P(w.a[0] + w.ux * b, w.a[1] + w.uy * b);
      linien.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}"/>`);
    }
  }
  teile.push(`<g stroke="${FARBE.wand}" stroke-width="${WAND_PX}" stroke-linecap="butt">${linien.join("")}</g>`);
  teile.push(`<g fill="${FARBE.wand}">${e.map(q => { const [x, y] = P(q[0], q[1]); return `<circle cx="${x}" cy="${y}" r="${WAND_PX / 2}"/>`; }).join("")}</g>`);

  // Öffnungszeichen in den Lücken; Türen schlagen schematisch nach innen.
  for (const o of d.oeffnungen) {
    const i = Number(o.wandIndex ?? 0);
    if (!Number.isInteger(i) || i < 0 || i >= e.length) continue;
    const w = wand(i);
    const v = klemm(Number(o.abstandM) || 0, 0, w.l), b = klemm(v + (Number(o.breiteM) || 0), 0, w.l);
    if (b - v <= 0.005) continue;
    const m = (v + b) / 2;
    const [x, y] = P(w.a[0] + w.ux * m, w.a[1] + w.uy * m);
    // Das Zeichen öffnet nach lokal −y; so drehen, dass −y in den Raum zeigt.
    const nachInnen = -w.aussen[0] * Math.sin(w.winkel * Math.PI / 180) + w.aussen[1] * Math.cos(w.winkel * Math.PI / 180) > 0;
    const dreh = r1(w.winkel + (nachInnen ? 0 : 180));
    teile.push(`<g transform="translate(${x} ${y}) rotate(${dreh})">${oeffnungZeichen(o.art, (b - v) * s)}</g>`);
  }

  // Geräte: Kasten mit kräftiger Vorderkante (Bedienseite) und Nummer.
  for (const { ph, komp, i } of geraete) {
    const eck = grundriss(ph, komp);
    const warn = d.befunde.some(b => b.platzhalterId === ph.id && b.schwere === "WARNUNG");
    const rand = warn ? FARBE.warn : FARBE.geraetRand;
    const [m0, m1] = P(Number(ph.xM), Number(ph.yM));
    const v0 = P(...eck[3]), v1 = P(...eck[2]);
    teile.push(`<g><polygon points="${pts(eck)}" fill="${warn ? "#f6d5d2" : FARBE.geraet}" stroke="${rand}" stroke-width="1.4"/>`
      + (komp.bedienseiteVorn ? `<line x1="${v0[0]}" y1="${v0[1]}" x2="${v1[0]}" y2="${v1[1]}" stroke="${warn ? FARBE.warn : FARBE.tkDunkel}" stroke-width="3" stroke-linecap="round"/>` : "")
      + `<text x="${m0}" y="${m1}" dy="0.35em" text-anchor="middle" font-size="10" font-weight="700" fill="#24343a" stroke="#fff" stroke-width="3" paint-order="stroke">G${i + 1}</text></g>`);
  }

  // Einbauten: nummerierte Marken (Wand: an der Wand, Decke: gestrichelt, Boden: eckig).
  d.einbauten.forEach((ein, i) => {
    // Wandgerät an einer Wand, die es nicht (mehr) gibt: nur in der Tabelle, nicht irgendwo zeichnen.
    if (ein.befestigung === "WAND" && !gueltigeWand(ein.wandIndex, e.length)) return;
    const l0 = sicher(() => G.lageImRaum(raum, ein, 0), null);
    if (!l0 || !isFinite(l0.x) || !isFinite(l0.y)) return;
    const [x0, y0] = P(l0.x, l0.y);
    const nr = i + 1;
    const text = `<text x="__X" y="__Y" dy="0.35em" text-anchor="middle" font-size="9" font-weight="700" fill="__F">${nr}</text>`;
    if (ein.befestigung === "WAND") {
      const l1 = G.lageImRaum(raum, ein, 1);
      const nx = l1.x - l0.x, ny = l1.y - l0.y, nl = Math.hypot(nx, ny) || 1;
      const x = r1(x0 + nx / nl * 15), y = r1(y0 + ny / nl * 15);
      teile.push(`<g><line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="${FARBE.einbau}" stroke-width="1.2"/>`
        + `<circle cx="${x}" cy="${y}" r="7.5" fill="${FARBE.einbau}" stroke="#fff" stroke-width="1"/>`
        + text.replace("__X", x).replace("__Y", y).replace("__F", "#fff") + `</g>`);
    } else if (ein.befestigung === "DECKE") {
      teile.push(`<g><circle cx="${x0}" cy="${y0}" r="7.5" fill="#fff" stroke="${FARBE.einbau}" stroke-width="1.4" stroke-dasharray="3 2"/>`
        + text.replace("__X", x0).replace("__Y", y0).replace("__F", FARBE.einbau) + `</g>`);
    } else {
      teile.push(`<g><rect x="${r1(x0 - 7)}" y="${r1(y0 - 7)}" width="14" height="14" rx="2" fill="${FARBE.einbau}" stroke="#fff" stroke-width="1"/>`
        + text.replace("__X", x0).replace("__Y", y0).replace("__F", "#fff") + `</g>`);
    }
  });

  // Foto-Pins mit Nummer F1, F2 … (wie die Galerie).
  const rb = sicher(() => G.breite(raum), 0) || 1, rt = sicher(() => G.tiefe(raum), 0) || 1;
  d.fotos.forEach((f, i) => {
    const fx = Number(f.relX), fy = Number(f.relY);
    if (!isFinite(fx) || !isFinite(fy)) return;
    const [x, y] = P(fx * rb, fy * rt);
    teile.push(`<g transform="translate(${x} ${y})">`
      + `<path d="M0 0 C -9 -9 -8 -19 0 -19 C 8 -19 9 -9 0 0 Z" fill="${FARBE.foto}" stroke="${FARBE.fotoDunkel}" stroke-width="1.1"/>`
      + `<circle cx="0" cy="-12.5" r="4" fill="#fff"/>`
      + `<text x="9" y="-11" font-size="9.5" font-weight="700" fill="${FARBE.fotoDunkel}" stroke="#fff" stroke-width="3" paint-order="stroke">F${i + 1}</text></g>`);
  });

  // Maßketten außen an jeder Wand, mit Wandnummer im Kreis.
  const masse = [];
  for (let i = 0; i < e.length; i++) {
    const w = wand(i);
    const [ax, ay] = P(...w.a), [bx, by] = P(...w.b);
    const [nx, ny] = w.aussen;
    const a1 = [ax + nx * MASS_ABSTAND, ay + ny * MASS_ABSTAND], b1 = [bx + nx * MASS_ABSTAND, by + ny * MASS_ABSTAND];
    const hilfs = (x, y) => `<line x1="${r1(x + nx * 5)}" y1="${r1(y + ny * 5)}" x2="${r1(x + nx * (MASS_ABSTAND + 5))}" y2="${r1(y + ny * (MASS_ABSTAND + 5))}" stroke-width="0.6"/>`;
    const tick = q => {
      const tx = (w.ux + nx) * 3.5, ty = (w.uy + ny) * 3.5;
      return `<line x1="${r1(q[0] - tx)}" y1="${r1(q[1] - ty)}" x2="${r1(q[0] + tx)}" y2="${r1(q[1] + ty)}" stroke-width="1.3"/>`;
    };
    // Text immer lesbar (nie kopfüber): Leserichtung auf −90°…90° bringen.
    let lese = w.winkel, lx = w.ux, ly = w.uy;
    if (lese > 90.5 || lese <= -89.5) { lese += 180; lx = -lx; ly = -ly; }
    if (lese > 180) lese -= 360;
    const wert = zahl(w.l, 2);
    const mx = (a1[0] + b1[0]) / 2, my = (a1[1] + b1[1]) / 2;
    const halb = wert.length * 3.2 + 4;
    const kx = r1(mx - lx * (halb + 10)), ky = r1(my - ly * (halb + 10));
    masse.push(`<g>${hilfs(ax, ay)}${hilfs(bx, by)}`
      + `<line x1="${r1(a1[0])}" y1="${r1(a1[1])}" x2="${r1(b1[0])}" y2="${r1(b1[1])}" stroke-width="0.8"/>`
      + tick(a1) + tick(b1)
      + `<text x="${r1(mx)}" y="${r1(my)}" dy="0.35em" transform="rotate(${r1(lese)} ${r1(mx)} ${r1(my)})" text-anchor="middle" font-size="11" fill="${FARBE.wand}" stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(wert)}</text>`
      + `<circle cx="${kx}" cy="${ky}" r="8" fill="#fff" stroke="${FARBE.tk}" stroke-width="1.3"/>`
      + `<text x="${kx}" y="${ky}" dy="0.35em" text-anchor="middle" font-size="9.5" font-weight="700" fill="${FARBE.tkDunkel}" stroke="none">${i + 1}</text></g>`);
  }
  teile.push(`<g stroke="${FARBE.mass}" fill="none">${masse.join("")}</g>`);

  // Maßstabsleiste: 1 m, halbiert.
  const y = hoehe - 14, x = 14, h = r1(s / 2);
  teile.push(`<g font-size="9.5" fill="${FARBE.wand}">`
    + `<rect x="${x}" y="${y - 5}" width="${h}" height="5" fill="${FARBE.wand}"/>`
    + `<rect x="${r1(x + h)}" y="${y - 5}" width="${h}" height="5" fill="#fff" stroke="${FARBE.wand}" stroke-width="0.8"/>`
    + `<text x="${x}" y="${y + 10}" text-anchor="middle">0</text>`
    + `<text x="${r1(x + h)}" y="${y + 10}" text-anchor="middle">0,5</text>`
    + `<text x="${r1(x + s)}" y="${y + 10}" text-anchor="middle">1 m</text>`
    + `<text x="${PLAN_B - 14}" y="${y + 10}" text-anchor="end" fill="#4a5a5a">Maße in m · Wandlängen innen</text></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLAN_B} ${hoehe}" width="${PLAN_B}" height="${hoehe}" `
    + `font-family="Helvetica, Arial, sans-serif" role="img" aria-label="Grundriss">${teile.join("")}</svg>`;
}

/** Freiraumzone vor der Bedienseite (VORNE-Regel) bzw. rundum (RUNDUM-Regel). */
function zonenPunkte(ph, komp) {
  const regeln = fuer(komp.kategorie);
  const vorne = regeln.find(r => r.richtung === Richtung.VORNE);
  if (vorne && komp.bedienseiteVorn) {
    const g = grundriss(ph, komp);
    const fl = g[3], fr = g[2], bl = g[0];
    const nx = fl[0] - bl[0], ny = fl[1] - bl[1], len = Math.hypot(nx, ny) || 1;
    const t = vorne.abstandM;
    return { art: "vorne", regel: vorne, punkte: [fr, fl, [fl[0] + nx / len * t, fl[1] + ny / len * t], [fr[0] + nx / len * t, fr[1] + ny / len * t]] };
  }
  const rundum = regeln.find(r => r.richtung === Richtung.RUNDUM);
  if (rundum) {
    const g = grundriss(ph, komp);
    const t = rundum.abstandM;
    return { art: "rundum", regel: rundum, punkte: g.map(q => [q[0], q[1]]), abstand: t,
      // Für den Ausschnitt: grob die um t vergrößerte Box.
      huelle: g.map(q => [q[0] + t, q[1] + t]).concat(g.map(q => [q[0] - t, q[1] - t])) };
  }
  return null;
}

function zonenSvg(ph, komp, befunde, P, s) {
  const z = zonenPunkte(ph, komp);
  if (!z) return "";
  const warn = befunde.some(b => b.platzhalterId === ph.id && b.regelId === z.regel.id && b.schwere === "WARNUNG");
  const f = warn ? FARBE.warn : FARBE.ok;
  const pts = z.punkte.map(q => P(q[0], q[1]).join(",")).join(" ");
  if (z.art === "vorne") {
    return `<polygon points="${pts}" fill="${f}" fill-opacity="${warn ? 0.3 : 0.22}" stroke="${f}" stroke-width="1" stroke-dasharray="4 3"/>`;
  }
  // Rundum: breiter, runder Strich um den Kasten = Band der Breite `abstand`.
  return `<polygon points="${pts}" fill="none" stroke="${f}" stroke-opacity="${warn ? 0.3 : 0.2}" stroke-width="${r1(2 * z.abstand * s)}" stroke-linejoin="round"/>`;
}

/** Öffnungszeichen um den Ursprung; die Lücke liegt auf der x-Achse, −y = Raumseite. */
function oeffnungZeichen(art, laenge) {
  const l = Math.max(6, laenge), h = r1(l / 2);
  const st = `stroke="${FARBE.wand}" fill="none"`;
  if (art === "FENSTER") {
    return `<rect x="${-h}" y="-3" width="${r1(l)}" height="6" fill="#fff" stroke="${FARBE.wand}" stroke-width="0.9"/>`
      + `<line x1="${-h}" y1="0" x2="${h}" y2="0" ${st} stroke-width="0.9"/>`;
  }
  if (art === "DURCHGANG") {
    return `<line x1="${-h}" y1="-4" x2="${-h}" y2="4" ${st} stroke-width="1.4"/>`
      + `<line x1="${h}" y1="-4" x2="${h}" y2="4" ${st} stroke-width="1.4"/>`;
  }
  if (art === "TOR") {
    return `<line x1="${-h}" y1="0" x2="${h}" y2="0" ${st} stroke-width="1.2" stroke-dasharray="6 3"/>`
      + `<line x1="${-h}" y1="-4" x2="${-h}" y2="4" ${st} stroke-width="1.4"/>`
      + `<line x1="${h}" y1="-4" x2="${h}" y2="4" ${st} stroke-width="1.4"/>`;
  }
  // Tür: Flügel senkrecht zur Wand, dazu der Bogen, den er überstreicht.
  return `<line x1="${-h}" y1="0" x2="${-h}" y2="${r1(-l)}" ${st} stroke-width="1.6"/>`
    + `<path d="M ${-h} ${r1(-l)} A ${r1(l)} ${r1(l)} 0 0 1 ${h} 0" ${st} stroke-width="0.9" stroke-dasharray="3 2"/>`;
}

function legende() {
  const eintrag = (svg, text, b = 22) => `<span class="leg"><svg viewBox="0 0 ${b} 16" width="${b}" height="16">${svg}</svg>${text}</span>`;
  return `<figcaption class="legende">`
    + eintrag(`<line x1="1" y1="8" x2="21" y2="8" stroke="${FARBE.wand}" stroke-width="4"/>`, "Wand")
    + eintrag(`<line x1="3" y1="14" x2="3" y2="2" stroke="${FARBE.wand}" stroke-width="1.4"/><path d="M3 2 A 12 12 0 0 1 15 14" fill="none" stroke="${FARBE.wand}" stroke-dasharray="2 1.5"/>`, "Tür (Aufschlag schematisch)")
    + eintrag(`<rect x="1" y="5" width="20" height="6" fill="#fff" stroke="${FARBE.wand}" stroke-width="0.9"/><line x1="1" y1="8" x2="21" y2="8" stroke="${FARBE.wand}" stroke-width="0.9"/>`, "Fenster")
    + eintrag(`<rect x="3" y="2" width="16" height="6" fill="${FARBE.geraet}" stroke="${FARBE.geraetRand}"/><rect x="3" y="8" width="16" height="7" fill="${FARBE.ok}" fill-opacity="0.25" stroke="${FARBE.ok}" stroke-dasharray="2 1.5"/>`, "Gerät + Freiraum frei")
    + eintrag(`<rect x="3" y="2" width="16" height="6" fill="#f6d5d2" stroke="${FARBE.warn}"/><rect x="3" y="8" width="16" height="7" fill="${FARBE.warn}" fill-opacity="0.3" stroke="${FARBE.warn}" stroke-dasharray="2 1.5"/>`, "Freiraum unterschritten")
    + eintrag(`<circle cx="7" cy="8" r="6" fill="${FARBE.einbau}"/><circle cx="21" cy="8" r="5.5" fill="#fff" stroke="${FARBE.einbau}" stroke-width="1.2" stroke-dasharray="2 1.5"/><rect x="30" y="2.5" width="11" height="11" rx="1.5" fill="${FARBE.einbau}"/>`, "Einbau Wand / Decke / Boden", 42)
    + eintrag(`<path d="M11 15 C 4 8 5 1 11 1 C 17 1 18 8 11 15 Z" fill="${FARBE.foto}"/>`, "Foto")
    + eintrag(`<circle cx="11" cy="8" r="6.5" fill="#fff" stroke="${FARBE.tk}" stroke-width="1.3"/><text x="11" y="11" font-size="9" text-anchor="middle" font-weight="700" fill="${FARBE.tkDunkel}">1</text>`, "Wandnummer")
    + `</figcaption>`;
}

// ------------------------------------------------------------ Texte

function aufmassText(raum) {
  const a = raum.aufmass && typeof raum.aufmass === "object" ? raum.aufmass : null;
  if (!a) return "Maße eingegeben";
  if (a.methode === "zielen") {
    const h = Number(a.kamerahoeheM);
    return a.kalibriert ? "Aufmaß: gezielt, Maßstab per Bandmaß gesetzt"
      : `Aufmaß: gezielt, Maßstab aus Kamerahöhe${isFinite(h) && h > 0 ? ` ${zahl(h, 2)} m` : ""}`;
  }
  if (a.methode === "band") return "Aufmaß: Bandmaß, Wand für Wand";
  if (a.methode === "rechteck") return "Aufmaß: Rechteck per Bandmaß";
  return "Aufmaß: eingegeben";
}

function quelleText(quelle, sigmaM) {
  if (quelle === "band") return { text: "Bandmaß", klasse: "band" };
  if (quelle === "gezielt") {
    const sig = Number(sigmaM);
    return { text: isFinite(sig) && sigmaM != null ? `gezielt ± ${Math.max(1, Math.round(sig * 100))} cm` : "gezielt", klasse: "gezielt" };
  }
  return { text: "eingegeben", klasse: "getippt" };
}

/** Abstand für die Normprüfung; ≥ 50 m ist der „nichts im Weg"-Wert → „frei". */
function abstandText(m, regelId) {
  if (m == null) return "–";
  const v = Number(m);
  if (!isFinite(v)) return "–";
  if (v >= 50) return "frei";
  if (regelId === "BIEGERADIUS") return `${Math.round(v * 1000)} mm`;
  return cm(v);
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
  "September", "Oktober", "November", "Dezember"];
/** Feste deutsche Schreibweise – unabhängig davon, ob die Laufzeit Intl-Daten hat. */
function datumText(d) { return `${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`; }

function geschossName(g) {
  const n = Number(g);
  if (!Number.isInteger(n)) return "–";
  return n === 0 ? "EG" : n > 0 ? `${n}. OG` : `${-n}. UG`;
}

const OEFFNUNGEN = { TUER: "Tür", DURCHGANG: "Durchgang", FENSTER: "Fenster", TOR: "Tor" };
const oeffnungsName = a => OEFFNUNGEN[a] || "Öffnung";
const einbauName = a => ARTEN.get(a) || (a ? String(a) : "Sonstiges");
const BEFESTIGUNG = { WAND: "Wand", DECKE: "Decke", BODEN: "Boden", FREI: "frei im Raum" };
const befestigungName = b => BEFESTIGUNG[b] || "–";

function schwereZuerst(a, b) {
  const rang = { WARNUNG: 0, HINWEIS: 1, OK: 2 };
  return (rang[a.schwere] ?? 3) - (rang[b.schwere] ?? 3);
}
const statusText = s => s === "WARNUNG" ? "⚠ Warnung" : s === "HINWEIS" ? "ℹ Hinweis" : "✓ erfüllt";

/** „Variante A" nicht als „Variante Variante A" schreiben. */
function varianteText(v) {
  const name = String(v.name ?? "–");
  return /^variante\b/i.test(name) ? `<b>${esc(name)}</b>` : `Variante <b>${esc(name)}</b>`;
}

const kennzahl = (wert, text) => `<div class="kennzahl"><b>${esc(wert)}</b><span>${esc(text)}</span></div>`;
const fuss = () => `<div class="fuss"><span>RAUMWERK · Konzept-Prototyp · Vertraulich</span><span>Kein Rechts- oder Prüfnachweis – Richtwerte, fachlich abzusichern.</span></div>`;

// ------------------------------------------------------------ Helfer

/** HTML-sicher – für Text und Attributwerte (auch einfache Anführungszeichen). */
export function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const mehrzeilig = t => esc(t).replace(/\r?\n/g, "<br>");

/** Zahl mit Dezimalkomma; Unsinn → „–". */
function zahl(v, stellen) {
  const n = Number(v);
  return v == null || !isFinite(n) ? "–" : n.toFixed(stellen).replace(".", ",");
}
const cm = m => { const n = Number(m); return isFinite(n) ? `${Math.round(n * 100)} cm` : "–"; };
const r1 = v => Math.round(v * 10) / 10;
const klemm = (v, a, b) => Math.max(a, Math.min(b, v));
const liste = x => (Array.isArray(x) ? x : []);
const gueltigeWand = (w, n) => { const i = Number(w ?? 0); return Number.isInteger(i) && i >= 0 && i < n; };
function sicher(f, ersatz) { try { const r = f(); return r ?? ersatz; } catch (_) { return ersatz; } }

const FARBE_OK = /^#[0-9a-fA-F]{3,8}$/;
const BILD_URL = /^data:image\/(png|jpe?g|webp|gif)[;,]/;
/** Nur eingebettete Rasterbilder; Base64-Teil muss sauber sein, sonst lädt der Browser Unsinn. */
function bildUrl(u) {
  if (typeof u !== "string" || !BILD_URL.test(u)) return null;
  const i = u.indexOf(";base64,");
  return i < 0 || /^[A-Za-z0-9+/=\s]*$/.test(u.slice(i + 8)) ? u : null;
}

function herunterladen(name, html) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch (_) { return false; }
}

// ------------------------------------------------------------ Stil

const STIL = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html { background: #e9eeee; }
  body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1d2a2a; margin: 0; padding: 0 0 40px; background: #e9eeee; }
  .leiste { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 16px; margin-bottom: 16px; background: #17494d; color: #fff; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .leiste span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .blatt { background: #fff; max-width: 210mm; margin: 0 auto 18px; padding: 14mm 14mm 10mm; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
  h1 { font-size: 21px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 2px solid #2b7a78; padding-bottom: 3px; color: #17494d; break-after: avoid; page-break-after: avoid; }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #2b7a78; padding-bottom: 10px; }
  .marke { font-weight: 700; letter-spacing: .16em; color: #2b7a78; font-size: 11px; }
  .meta { text-align: right; font-size: 11.5px; color: #4a5a5a; }
  .rot { color: #a4262c; } .gruen { color: #24734a; } .grau { color: #6a7a7a; font-size: 11px; }
  .kennzahlen { display: flex; flex-wrap: wrap; gap: 10px 26px; margin: 12px 0; }
  .kennzahl b { display: block; font-size: 18px; color: #17494d; }
  .kennzahl span { font-size: 11px; color: #4a5a5a; }
  .notiz { background: #fbf8ee; border-left: 4px solid #d9b64a; padding: 6px 10px; font-size: 12px; margin: 6px 0; }
  .tabelle { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 2px; }
  table.schmal { width: auto; min-width: 60%; }
  th, td { text-align: left; padding: 4px 7px; border-bottom: 1px solid #dde6e6; vertical-align: top; }
  th { background: #eef5f5; font-weight: 600; }
  tfoot th { background: #f6f9f9; }
  .z { text-align: right; white-space: nowrap; }
  .nw { white-space: nowrap; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .b-warnung { background: #fdecec; }
  .b-warnung td { color: #a4262c; }
  .quelle { font-size: 10.5px; color: #6a7a7a; }
  .quelle-band { color: #24734a; font-weight: 600; } .quelle-gezielt { color: #8a5a00; } .quelle-getippt { color: #4a5a5a; }
  .marke-ein { display: inline-block; min-width: 18px; padding: 0 4px; border-radius: 9px; background: #1f4e79; color: #fff; font-weight: 700; text-align: center; font-size: 11px; }
  .marke-ger { font-weight: 700; color: #17494d; }
  .klein { font-size: 11px; color: #4a5a5a; margin: 4px 0 0; }
  .plan { margin: 4px 0 0; border: 1px solid #cdd; border-radius: 6px; padding: 6px; background: #fff; break-inside: avoid; page-break-inside: avoid; }
  .plan > svg { display: block; width: 100%; max-width: 170mm; height: auto; margin: 0 auto; }
  .kein-plan { padding: 30px; text-align: center; color: #6a7a7a; }
  .legende { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 10.5px; color: #4a5a5a; padding: 4px 4px 0; border-top: 1px solid #eef2f2; margin-top: 4px; }
  .leg { display: inline-flex; align-items: center; gap: 4px; }
  .hinweis { background: #f3f8f8; border-left: 4px solid #2b7a78; padding: 8px 12px; font-size: 12px; margin-top: 8px; border-radius: 0 6px 6px 0; }
  .galerie { display: grid; grid-template-columns: repeat(auto-fill, minmax(52mm, 1fr)); gap: 10px; margin-top: 6px; }
  .foto { margin: 0; border: 1px solid #dde6e6; border-radius: 6px; overflow: hidden; background: #fff; break-inside: avoid; page-break-inside: avoid; }
  .foto img { width: 100%; height: 40mm; object-fit: cover; display: block; background: #f1f4f4; }
  .kein-bild { height: 40mm; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; color: #6a7a7a; font-size: 11px; background: #f1f4f4; }
  .foto figcaption { padding: 5px 7px; font-size: 11.5px; }
  .foto figcaption span { color: #6a7a7a; font-size: 10.5px; }
  .fuss { margin-top: 18px; border-top: 1px solid #dde6e6; padding-top: 6px; font-size: 10px; color: #8a9a9a; display: flex; justify-content: space-between; gap: 12px; }
  .knopf { flex: none; background: #2b7a78; color: #fff; border: 1px solid #5fb3b0; padding: 9px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .knopf:hover { background: #3a8f8c; }
  @media (max-width: 640px) {
    body { padding: 0 0 24px; }
    .leiste { padding: 8px 12px; } .leiste span { font-size: 12px; }
    .blatt { padding: 16px; margin-bottom: 12px; }
    .kopf { flex-direction: column; } .meta { text-align: left; }
  }
  @page { size: A4; margin: 14mm 13mm 14mm; }
  @media print {
    html, body { background: #fff; padding: 0; }
    .kein-druck { display: none !important; }
    .blatt { box-shadow: none; margin: 0; padding: 0; max-width: none; break-after: page; page-break-after: always; }
    .blatt:last-of-type { break-after: auto; page-break-after: auto; }
    .tabelle { overflow: visible; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;
