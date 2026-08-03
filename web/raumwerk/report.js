/*
 * PDF-Report – die gewählte Variante als vertrautes Dokument (Konzept §3, §12).
 *
 * Bewusst ohne Fremdbibliothek: Der Bericht wird als eigenständiges HTML in
 * einem neuen Fenster aufgebaut und über die Druckfunktion des Browsers als PDF
 * gesichert. Das läuft offline, im Kundenlink und ohne Serverlast.
 *
 * Aufgenommen wird auch die **Maß-Herkunft** und die konservative
 * Rundungsregel – das ist die rechtliche Absicherung aus §7/§14: klar sagen,
 * welche Zahl verlässlich ist und dass Freiräume untere Schranken sind.
 */

import * as G from "../geometrie.js";
import { finde } from "../komponenten.js";
import { VERSION } from "../regelwerk.js";

const cm = m => `${Math.round(Number(m) * 100)} cm`;

export function bericht(projekt, variante, befunde, svgMarkup, svgGroesse) {
  const raum = projekt.raum;
  const flaeche = G.flaeche(raum).toFixed(2);
  const umfang = G.wandLaengen(raum).reduce((a, b) => a + b, 0).toFixed(2);
  const warnungen = befunde.filter(b => b.schwere === "WARNUNG");
  const datum = new Date().toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });

  const oeffZeilen = projekt.oeffnungen.map(o =>
    `<tr><td>Wand ${(o.wandIndex ?? 0) + 1}</td><td>${artName(o.art)}</td>
     <td>${cm(o.breiteM)} × ${cm(o.hoeheM)}</td><td>${cm(o.abstandM)} ab Ecke</td></tr>`).join("");

  const wandZeilen = G.wandLaengen(raum).map((l, i) =>
    `<tr><td>Wand ${i + 1}</td><td>${l.toFixed(2)} m</td></tr>`).join("");

  const klotzZeilen = variante.platzhalter.map(ph => {
    const k = finde(ph.komponente);
    return `<tr><td>${ph.bezeichnung || (k ? k.name : ph.komponente)}</td>
      <td>${k ? `${cm(k.breiteM)} × ${cm(k.tiefeM)} × ${cm(k.hoeheM)}` : "–"}</td></tr>`;
  }).join("");

  const befundZeilen = [...befunde].sort(schwereZuerst).map(b => `
    <tr class="b-${b.schwere.toLowerCase()}">
      <td>${statusZeichen(b.schwere)}</td>
      <td>${b.komponenteName}</td>
      <td>${b.regelTitel}</td>
      <td>${b.verfuegbarM == null ? "–" : cm(b.verfuegbarM)}</td>
      <td>${b.erforderlichM == null ? "–" : cm(b.erforderlichM)}</td>
      <td class="quelle">${b.quelle}</td>
    </tr>`).join("");

  const w = svgGroesse?.width || 800, h = svgGroesse?.height || 500;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>RAUMWERK – ${esc(raum.name)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #1d2a2a; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 2px solid #2b7a78; padding-bottom: 3px; color: #17494d; }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2b7a78; padding-bottom: 10px; }
  .marke { font-weight: 700; letter-spacing: .18em; color: #2b7a78; font-size: 12px; }
  .meta { text-align: right; font-size: 12px; color: #4a5a5a; }
  .kennzahlen { display: flex; gap: 28px; margin: 14px 0; }
  .kennzahl b { display: block; font-size: 20px; color: #17494d; }
  .kennzahl span { font-size: 12px; color: #4a5a5a; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 4px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #dde6e6; }
  th { background: #eef5f5; font-weight: 600; }
  .plan { border: 1px solid #cdd; border-radius: 8px; overflow: hidden; margin-top: 6px; background: #fff; }
  .b-warnung { background: #fdecec; }
  .b-warnung td { color: #a4262c; }
  .quelle { font-size: 11px; color: #6a7a7a; }
  .hinweis { background: #f3f8f8; border-left: 4px solid #2b7a78; padding: 10px 14px; font-size: 12.5px; margin-top: 10px; border-radius: 0 6px 6px 0; }
  .galerie { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 6px; }
  .foto { margin: 0; border: 1px solid #dde6e6; border-radius: 8px; overflow: hidden; background: #fff; break-inside: avoid; }
  .foto img { width: 100%; height: 150px; object-fit: cover; display: block; background: #111; }
  .foto figcaption { padding: 6px 8px; font-size: 12px; }
  .foto figcaption span { color: #6a7a7a; font-size: 11px; }
  .fuss { margin-top: 26px; border-top: 1px solid #dde6e6; padding-top: 8px; font-size: 11px; color: #8a9a9a; display: flex; justify-content: space-between; }
  @media print { body { margin: 0; } .kein-druck { display: none; } }
  .knopf { position: fixed; top: 16px; right: 16px; background: #2b7a78; color: #fff; border: 0; padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style></head><body>
<button class="knopf kein-druck" onclick="window.print()">Als PDF speichern</button>

<div class="kopf">
  <div>
    <div class="marke">RAUMWERK · AUFMASS- &amp; PLANUNGSREPORT</div>
    <h1>${esc(raum.name)}${raum.nummer ? ` · ${esc(raum.nummer)}` : ""}</h1>
    <div>Variante: <b>${esc(variante.name)}</b> · Geschoss ${raum.geschoss}</div>
  </div>
  <div class="meta">${datum}<br>Regelwerk-Fassung ${VERSION}<br><b style="color:#a4262c">${warnungen.length ? `${warnungen.length} Warnung(en)` : "keine Warnungen"}</b></div>
</div>

<div class="kennzahlen">
  <div class="kennzahl"><b>${flaeche} m²</b><span>Grundfläche</span></div>
  <div class="kennzahl"><b>${umfang} m</b><span>Wandumfang</span></div>
  <div class="kennzahl"><b>${Number(raum.hoeheM).toFixed(2)} m</b><span>Raumhöhe</span></div>
  <div class="kennzahl"><b>${variante.platzhalter.length}</b><span>Geräte geplant</span></div>
</div>

<h2>Grundriss</h2>
<div class="plan"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svgMarkup}</svg></div>

<h2>Normprüfung</h2>
<table>
  <tr><th></th><th>Gerät</th><th>Regel</th><th>vorhanden (mind.)</th><th>gefordert</th><th>Quelle</th></tr>
  ${befundZeilen || `<tr><td colspan="6">Keine prüfpflichtigen Geräte platziert.</td></tr>`}
</table>
<div class="hinweis"><b>Konservative Messung.</b> Alle Freiräume sind untere Schranken:
gemessener Wert minus Toleranz, auf ganze Zentimeter abgerundet. „vorhanden (mind.)"
heißt, dass mindestens dieser Abstand tatsächlich frei ist. Freiraumwerte aus der
Foto-Rekonstruktion sind Kontextmaße (± cm); laser- oder kataloggesicherte Maße gelten als verlässlich.</div>

<h2>Aufmaß</h2>
<div style="display:flex; gap:32px; flex-wrap:wrap;">
  <div style="flex:1; min-width:220px;"><table><tr><th>Wand</th><th>Länge</th></tr>${wandZeilen}</table></div>
  <div style="flex:2; min-width:280px;"><table><tr><th>Öffnung</th><th>Art</th><th>Maß (B×H)</th><th>Lage</th></tr>${oeffZeilen || `<tr><td colspan="4">keine erfasst</td></tr>`}</table></div>
</div>

<h2>Geplante Geräte</h2>
<table><tr><th>Bezeichnung</th><th>Baumaß (B×T×H)</th></tr>${klotzZeilen || `<tr><td colspan="2">keine</td></tr>`}</table>

${(projekt.fotos && projekt.fotos.length) ? `<h2>Verortete Fotos</h2>
<div class="galerie">${projekt.fotos.map((f, i) => `
  <figure class="foto"><img src="${f.datenUrl}" alt=""><figcaption>${i + 1}. ${esc(f.titel || "Foto")}${f.notiz ? `<br><span>${esc(f.notiz)}</span>` : ""}</figcaption></figure>`).join("")}</div>` : ""}

<div class="fuss"><span>RAUMWERK · Konzept-Prototyp · Vertraulich</span><span>Kein Rechts- oder Prüfnachweis – Richtwerte, fachlich abzusichern.</span></div>
</body></html>`;

  const fenster = window.open("", "_blank");
  if (!fenster) { alert("Bitte Pop-ups für den Report erlauben."); return; }
  fenster.document.open();
  fenster.document.write(html);
  fenster.document.close();
}

function schwereZuerst(a, b) {
  const rang = { WARNUNG: 0, HINWEIS: 1, OK: 2 };
  return rang[a.schwere] - rang[b.schwere];
}
const statusZeichen = s => s === "WARNUNG" ? "⚠" : s === "HINWEIS" ? "ℹ" : "✓";
const artName = a => ({ TUER: "Tür", DURCHGANG: "Durchgang", FENSTER: "Fenster", TOR: "Tor" }[a] || a);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
