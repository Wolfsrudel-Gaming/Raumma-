/*
 * RAUMWERK · Planungswerkzeug – Controller.
 *
 * Führt den Zustand (Store), verdrahtet die Grundriss-Ansicht (Plan) und baut
 * die Bedienpanels. Nach jeder Änderung läuft die Normprüfung neu und das
 * Ergebnis fließt in Plan (Zonen/Warnfarben) und in die rechte Spalte.
 *
 * Ablauf wie im Konzept: gemessenen Raum erfassen → Geräte-Klötzchen setzen und
 * ziehen → Freiräume werden live geprüft → Varianten vergleichen → Report.
 */

import * as Store from "./store.js";
import { Plan } from "./plan2d.js";
import { bericht } from "./report.js";
import * as G from "../geometrie.js";
import { KATALOG, Kategorie, finde } from "../komponenten.js";
import { pruefe } from "../pruefung.js";

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let projekt = Store.laden();
let auswahlId = null;      // ausgewähltes Klötzchen
let paletteWahl = null;    // scharf gestellte Komponente zum Platzieren
let modus = "auswahl";     // auswahl | platzieren | messen-strecke | messen-flaeche
let befunde = [];

const svg = $("plan");
const plan = new Plan(svg, { onSelect, onPlatzhalterMove, onPlace, onMessung });

// ------------------------------------------------------------- Kern

function raum() { return projekt.raum; }
function platzhalter() { return Store.platzhalter(projekt); }

function pruefenJetzt() {
  befunde = pruefe(raum(), platzhalter());
  return befunde;
}

/** Ein voller Durchlauf: prüfen, Plan zeichnen, Panels bauen, speichern. */
function render() {
  pruefenJetzt();
  plan.setModell({
    raum: raum(), oeffnungen: projekt.oeffnungen, einbauten: projekt.einbauten,
    platzhalter: platzhalter(), befunde, auswahlId
  }).zeichne();
  renderKopf();
  renderRaum();
  renderOeffnungen();
  renderPalette();
  renderWerkzeuge();
  renderPruefung();
  renderInspektor();
  renderVarianten();
  renderStatus();
  Store.speichern(projekt);
}

// ------------------------------------------------------- Rückrufe Plan

function onSelect(id) {
  auswahlId = id;
  if (id) { paletteWahl = null; if (modus === "platzieren") setModus("auswahl"); }
  render();
}

function onPlatzhalterMove(id, patch) {
  const ph = platzhalter().find(p => p.id === id);
  if (!ph) return;
  Object.assign(ph, patch);
  render();
}

function onPlace(x, y) {
  if (!paletteWahl) return;
  const ph = {
    id: Store.neueId("ph"), raumId: raum().id, komponente: paletteWahl,
    xM: x, yM: y, drehungGrad: 0, bezeichnung: ""
  };
  Object.assign(ph, plan.einrastVorschlag(ph, x, y));
  platzhalter().push(ph);
  auswahlId = ph.id;
  render();
}

function onMessung(e) {
  const el = $("messErgebnis");
  el.textContent = e.art === "strecke"
    ? `Strecke: mind. ${e.laengeM.toFixed(2)} m`
    : `Fläche: ${e.flaecheM2.toFixed(2)} m² · Umfang ${e.umfangM.toFixed(2)} m (${e.punkte} Punkte)`;
}

// ---------------------------------------------------------- Kopfleiste

function renderKopf() {
  $("projektName").value = projekt.name || "";
  const sel = $("varianteSelect");
  sel.innerHTML = projekt.varianten
    .map((v, i) => `<option value="${i}" ${i === projekt.aktiveVariante ? "selected" : ""}>${esc(v.name)}</option>`)
    .join("");
  $("btnVarianteDel").disabled = projekt.varianten.length <= 1;
}

// -------------------------------------------------------------- Raum

function renderRaum() {
  const r = raum();
  const imZug = !!(r.umriss && r.umriss.trim());
  const panel = $("panelRaum");
  panel.innerHTML = `
    <div class="feld"><label>Name</label><input id="rName" value="${esc(r.name)}"></div>
    <div class="feld-reihe">
      <div class="feld"><label>Raumnummer</label><input id="rNummer" value="${esc(r.nummer)}"></div>
      <div class="feld"><label>Geschoss</label><input id="rGeschoss" type="number" value="${r.geschoss}"></div>
      <div class="feld"><label>Höhe (m)</label><input id="rHoehe" type="number" step="0.05" value="${num(r.hoeheM)}"></div>
    </div>
    <div class="feld"><label>Form</label>
      <div class="feld-reihe">
        <button class="klein-knopf ${imZug ? "" : "haupt"}" id="formKurz">Rechteck / Trapez</button>
        <button class="klein-knopf ${imZug ? "haupt" : ""}" id="formZug">Polygonzug</button>
      </div>
    </div>
    ${imZug ? zugEditor(r) : kurzForm(r)}`;

  bind("rName", "change", v => set({ name: v }));
  bind("rNummer", "change", v => set({ nummer: v }));
  bind("rGeschoss", "change", v => set({ geschoss: parseInt(v) || 0 }));
  bind("rHoehe", "change", v => set({ hoeheM: pos(v, 2.5) }));
  $("formKurz").onclick = () => { if (imZug && confirm("Umriss verwerfen und zur Kurzform wechseln?")) set({ umriss: "" }); };
  $("formZug").onclick = () => { if (!imZug) set({ umriss: G.umrissSchreiben(G.ecken(r)) }); };

  if (imZug) bindZug(r); else bindKurz();
}

function kurzForm(r) {
  return `
    <div class="feld-reihe">
      <div class="feld"><label>Breite hinten (m)</label><input id="rBreite" type="number" step="0.05" value="${num(r.breiteM)}"></div>
      <div class="feld"><label>Breite vorne (m)</label><input id="rBreiteV" type="number" step="0.05" placeholder="wie hinten" value="${r.breiteVorneM == null ? "" : num(r.breiteVorneM)}"></div>
    </div>
    <div class="feld-reihe">
      <div class="feld"><label>Tiefe (m)</label><input id="rTiefe" type="number" step="0.05" value="${num(r.tiefeM)}"></div>
      <div class="feld"><label>Schräge</label><select id="rSchraege">
        ${["KEINE", "LINKS", "RECHTS", "BEIDSEITIG"].map(s => `<option ${r.schraege === s ? "selected" : ""}>${s}</option>`).join("")}
      </select></div>
    </div>`;
}

function bindKurz() {
  bind("rBreite", "change", v => set({ breiteM: pos(v, 4) }));
  bind("rBreiteV", "change", v => set({ breiteVorneM: v.trim() === "" ? null : pos(v, 4) }));
  bind("rTiefe", "change", v => set({ tiefeM: pos(v, 4) }));
  bind("rSchraege", "change", v => set({ schraege: v }));
}

/** Polygonzug-Editor: eine Zeile je Wand (Länge, Drehung), mit Restlücke. */
function zugEditor(r) {
  const punkte = G.umrissLesen(r.umriss) || G.ecken(r);
  const waende = G.waende(punkte);
  const z = G.zug(waende);
  const zeilen = waende.map((w, i) => `
    <div class="liste-zeile" data-wand="${i}">
      <input type="number" step="0.05" class="z-laenge" value="${w.laenge}" title="Länge (m)" style="flex:1.3">
      <input type="number" step="5" class="z-dreh" value="${w.drehung}" title="Drehung danach (°, + = rechts)" style="flex:1">
      <button class="weg" title="Wand entfernen">✕</button>
    </div>`).join("");
  const rest = z.restluecke;
  const gut = rest < 0.02;
  return `
    <p class="hint">Je Zeile eine Wand: Länge und Drehung an der Ecke danach (positiv = nach rechts).</p>
    <div id="zugListe">${zeilen}</div>
    <button class="klein-knopf" id="zugPlus">+ Wand</button>
    <div class="insp-zeile" style="margin-top:8px">
      <span>Restlücke</span>
      <span style="color:${gut ? "var(--ok)" : "var(--warn)"};font-weight:700">${(rest * 100).toFixed(1)} cm ${gut ? "· schließt" : "· Messfehler?"}</span>
    </div>`;
}

function bindZug(r) {
  const lesen = () => [...document.querySelectorAll("#zugListe .liste-zeile")].map(z => ({
    laenge: pos(z.querySelector(".z-laenge").value, 1),
    drehung: parseFloat(z.querySelector(".z-dreh").value) || 0
  }));
  const anwenden = waende => {
    const z = G.zug(waende);
    set({ umriss: G.umrissSchreiben(z.punkte) });
  };
  document.querySelectorAll("#zugListe input").forEach(inp =>
    inp.addEventListener("change", () => anwenden(lesen())));
  document.querySelectorAll("#zugListe .weg").forEach((b, i) =>
    b.onclick = () => { const w = lesen(); w.splice(i, 1); if (w.length >= 3) anwenden(w); });
  $("zugPlus").onclick = () => { const w = lesen(); w.push({ laenge: 1, drehung: 90 }); anwenden(w); };
}

// ---------------------------------------------------------- Öffnungen

function renderOeffnungen() {
  const n = G.wandLaengen(raum()).length;
  const panel = $("panelOeffnungen");
  panel.innerHTML = projekt.oeffnungen.map(o => `
    <div class="liste-zeile" data-oef="${o.id}">
      <select class="o-art" title="Art">
        ${[["TUER", "Tür"], ["DURCHGANG", "Durchgang"], ["FENSTER", "Fenster"], ["TOR", "Tor"]]
          .map(([k, t]) => `<option value="${k}" ${o.art === k ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <select class="o-wand" title="Wand" style="flex:0 0 70px">
        ${Array.from({ length: n }, (_, i) => `<option value="${i}" ${(o.wandIndex ?? 0) === i ? "selected" : ""}>W${i + 1}</option>`).join("")}
      </select>
      <input class="o-abstand" type="number" step="0.05" value="${num(o.abstandM)}" title="Abstand ab Ecke (m)" style="flex:1">
      <input class="o-breite" type="number" step="0.05" value="${num(o.breiteM)}" title="Breite (m)" style="flex:1">
      <button class="weg" title="Öffnung entfernen">✕</button>
    </div>`).join("") || `<p class="leer">Keine Öffnungen.</p>`;
  panel.insertAdjacentHTML("beforeend", `<button class="klein-knopf" id="oefPlus">+ Öffnung</button>`);

  projekt.oeffnungen.forEach(o => {
    const z = panel.querySelector(`[data-oef="${o.id}"]`);
    if (!z) return;
    z.querySelector(".o-art").onchange = e => { o.art = e.target.value; render(); };
    z.querySelector(".o-wand").onchange = e => { o.wandIndex = parseInt(e.target.value); render(); };
    z.querySelector(".o-abstand").onchange = e => { o.abstandM = pos(e.target.value, 0); render(); };
    z.querySelector(".o-breite").onchange = e => { o.breiteM = pos(e.target.value, 0.885); render(); };
    z.querySelector(".weg").onclick = () => { projekt.oeffnungen = projekt.oeffnungen.filter(x => x.id !== o.id); render(); };
  });
  $("oefPlus").onclick = () => {
    projekt.oeffnungen.push({ id: Store.neueId("oef"), raumId: raum().id, art: "TUER", wandIndex: 0, abstandM: 0.5, breiteM: 0.885, hoeheM: 2.01, bruestungM: 0 });
    render();
  };
}

// ------------------------------------------------------------ Palette

function renderPalette() {
  const gruppen = {
    VERTEILUNG: "Verteilungen", SCHRANK: "Schränke", GERAET: "Geräte",
    WAERMEQUELLE: "Wärmequellen", KABEL: "Kabel", ROHR: "Rohre", SONSTIGES: "Sonstiges"
  };
  const nach = {};
  for (const k of KATALOG) (nach[k.kategorie] ??= []).push(k);
  const panel = $("panelPalette");
  panel.innerHTML = Object.entries(gruppen).filter(([kat]) => nach[kat]).map(([kat, titel]) => `
    <div class="kat-gruppe">
      <div class="kat-titel">${titel}</div>
      ${nach[kat].map(k => `
        <button class="palette-knopf ${paletteWahl === k.schluessel ? "aktiv" : ""}" data-komp="${k.schluessel}">
          ${esc(k.name)}<br><small>${cm(k.breiteM)} × ${cm(k.tiefeM)} × ${cm(k.hoeheM)}</small>
        </button>`).join("")}
    </div>`).join("");
  panel.querySelectorAll("[data-komp]").forEach(b =>
    b.onclick = () => {
      const s = b.getAttribute("data-komp");
      paletteWahl = paletteWahl === s ? null : s;
      setModus(paletteWahl ? "platzieren" : "auswahl");
    });
}

// ----------------------------------------------------------- Werkzeuge

function renderWerkzeuge() {
  const panel = $("panelWerkzeuge");
  const wz = [["auswahl", "Auswahl"], ["messen-strecke", "Messen ↔"], ["messen-flaeche", "Fläche ▱"]];
  panel.innerHTML = wz.map(([m, t]) =>
    `<button class="werkzeug ${modus === m ? "aktiv" : ""}" data-modus="${m}">${t}</button>`).join("");
  panel.querySelectorAll("[data-modus]").forEach(b =>
    b.onclick = () => { paletteWahl = null; $("messErgebnis").textContent = ""; setModus(b.getAttribute("data-modus")); });
}

function setModus(m) {
  modus = m;
  plan.setModus(m);
  renderPalette();
  renderWerkzeuge();
  renderStatus();
}

function renderStatus() {
  const txt = {
    auswahl: "Gerät ziehen zum Verschieben · nahe Wand rastet es ein · Rad zoomt",
    platzieren: `„${finde(paletteWahl)?.name ?? ""}" platzieren – in den Plan klicken`,
    "messen-strecke": "Zwei Punkte klicken – Länge als untere Schranke",
    "messen-flaeche": "Ecken klicken, Doppelklick schließt die Fläche"
  }[modus];
  $("statusZeile").textContent = txt || "";
}

// ------------------------------------------------------------ Prüfung

function renderPruefung() {
  const warn = befunde.filter(b => b.schwere === "WARNUNG");
  const badge = $("pruefBadge");
  if (!platzhalter().length) { badge.className = "badge"; badge.textContent = ""; }
  else if (warn.length) { badge.className = "badge warn"; badge.textContent = `${warn.length} ⚠`; }
  else { badge.className = "badge gut"; badge.textContent = "frei ✓"; }

  const rang = { WARNUNG: 0, HINWEIS: 1, OK: 2 };
  const sortiert = [...befunde].sort((a, b) => rang[a.schwere] - rang[b.schwere]);
  $("panelPruefung").innerHTML = sortiert.length ? sortiert.map(b => `
    <div class="befund ${b.schwere.toLowerCase()}">
      <span class="zeichen">${b.schwere === "WARNUNG" ? "⚠" : b.schwere === "HINWEIS" ? "ℹ" : "✓"}</span>
      <span class="txt">${esc(b.text)}<span class="quelle">${esc(b.quelle)} · Regelwerk ${b.regelVersion}</span></span>
    </div>`).join("")
    : `<p class="leer">Noch keine prüfpflichtigen Geräte platziert. Wähle links ein Gerät und setze es in den Plan.</p>`;
}

// ----------------------------------------------------------- Inspektor

function renderInspektor() {
  const ph = platzhalter().find(p => p.id === auswahlId);
  const panel = $("panelInspektor");
  if (!ph) { panel.innerHTML = `<p class="hint">Kein Gerät ausgewählt. Klick ein Klötzchen im Plan an.</p>`; return; }
  const k = finde(ph.komponente);
  const meine = befunde.filter(b => b.platzhalterId === ph.id && b.schwere === "WARNUNG");
  panel.innerHTML = `
    <div class="insp-titel">${esc(k?.name ?? ph.komponente)}</div>
    <div class="insp-zeile"><span>Baumaß (B×T×H)</span><span>${k ? `${cm(k.breiteM)} × ${cm(k.tiefeM)} × ${cm(k.hoeheM)}` : "–"}</span></div>
    <div class="insp-zeile"><span>Position</span><span>${num(ph.xM)} / ${num(ph.yM)} m</span></div>
    <div class="insp-zeile"><span>Drehung</span><span>${Math.round(ph.drehungGrad || 0)}°</span></div>
    <div class="feld"><label>Bezeichnung</label><input id="iBez" value="${esc(ph.bezeichnung || "")}" placeholder="z. B. UV Küche"></div>
    <div class="dreh-knoepfe">
      <button id="drehM">↺ 15°</button>
      <button id="dreh90">90°</button>
      <button id="drehP">15° ↻</button>
    </div>
    ${meine.length ? `<div class="befund warnung"><span class="zeichen">⚠</span><span class="txt">${esc(meine[0].text)}</span></div>` : ""}
    <button class="loeschen" id="iDel">Gerät entfernen</button>`;
  bind("iBez", "change", v => { ph.bezeichnung = v; render(); });
  const drehe = d => { ph.drehungGrad = (((Math.round((ph.drehungGrad || 0) + d)) % 360) + 360) % 360; render(); };
  $("drehM").onclick = () => drehe(-15);
  $("drehP").onclick = () => drehe(15);
  $("dreh90").onclick = () => drehe(90);
  $("iDel").onclick = () => {
    const v = Store.aktiveVariante(projekt);
    v.platzhalter = v.platzhalter.filter(p => p.id !== ph.id);
    auswahlId = null; render();
  };
}

// ---------------------------------------------------------- Varianten

function renderVarianten() {
  const panel = $("panelVarianten");
  panel.innerHTML = `<table class="var-tabelle">
    <tr><th>Variante</th><th>Geräte</th><th>Warnungen</th><th></th></tr>
    ${projekt.varianten.map((v, i) => {
      const w = pruefe(raum(), v.platzhalter).filter(b => b.schwere === "WARNUNG").length;
      return `<tr class="${i === projekt.aktiveVariante ? "aktiv" : ""}" data-var="${i}">
        <td><a href="#" class="var-wahl">${esc(v.name)}</a></td>
        <td>${v.platzhalter.length}</td>
        <td class="${w ? "warnz" : "gutz"}">${w ? `${w} ⚠` : "✓"}</td>
        <td><button class="mini" data-ren="${i}">umbenennen</button></td>
      </tr>`;
    }).join("")}
  </table>`;
  panel.querySelectorAll("[data-var]").forEach(tr => {
    const i = parseInt(tr.getAttribute("data-var"));
    tr.querySelector(".var-wahl").onclick = e => { e.preventDefault(); projekt.aktiveVariante = i; auswahlId = null; render(); };
  });
  panel.querySelectorAll("[data-ren]").forEach(b => b.onclick = () => {
    const i = parseInt(b.getAttribute("data-ren"));
    const name = prompt("Neuer Name der Variante:", projekt.varianten[i].name);
    if (name) { projekt.varianten[i].name = name; render(); }
  });
}

// ------------------------------------------------------- Kopf-Aktionen

function verdrahteKopf() {
  bind("projektName", "change", v => { projekt.name = v; Store.speichern(projekt); });
  $("varianteSelect").onchange = e => { projekt.aktiveVariante = parseInt(e.target.value); auswahlId = null; render(); };
  $("btnVarianteNeu").onclick = () => { Store.varianteNeu(projekt); auswahlId = null; render(); };
  $("btnVarianteKlon").onclick = () => { Store.varianteKlonen(projekt); auswahlId = null; render(); };
  $("btnVarianteDel").onclick = () => {
    if (projekt.varianten.length > 1 && confirm("Aktive Variante löschen?")) {
      Store.varianteLoeschen(projekt, projekt.aktiveVariante); auswahlId = null; render();
    }
  };
  $("btnReport").onclick = () => {
    const r = svg.getBoundingClientRect();
    bericht(projekt, Store.aktiveVariante(projekt), befunde, svg.innerHTML, { width: Math.round(r.width), height: Math.round(r.height) });
  };
  $("btnReset").onclick = () => {
    if (confirm("Zum Beispielprojekt zurücksetzen? Der aktuelle Stand geht verloren.")) {
      projekt = Store.beispielProjekt(); auswahlId = null; paletteWahl = null; setModus("auswahl"); render(); plan.einpassen();
    }
  };
  $("btnEinpassen").onclick = () => plan.einpassen();
}

// -------------------------------------------------------- Tastatur

window.addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea")) return;
  const ph = platzhalter().find(p => p.id === auswahlId);
  if (e.key === "Escape") { paletteWahl = null; auswahlId = null; setModus("auswahl"); render(); }
  else if (ph && (e.key === "Delete" || e.key === "Backspace")) {
    const v = Store.aktiveVariante(projekt);
    v.platzhalter = v.platzhalter.filter(p => p.id !== ph.id); auswahlId = null; render();
  } else if (ph && (e.key === "r" || e.key === "R")) {
    ph.drehungGrad = (((ph.drehungGrad || 0) + (e.shiftKey ? -15 : 15)) % 360 + 360) % 360; render();
  }
});

window.addEventListener("resize", () => plan.zeichne());

// ------------------------------------------------------- Hilfsfunktionen

function set(patch) { Object.assign(raum(), patch); render(); }
function bind(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, e => fn(e.target.value)); }
const num = v => Number(v).toFixed(2).replace(/\.00$/, "");
const cm = m => `${Math.round(Number(m) * 100)}`;
const pos = (v, fallback) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : fallback; };

// ------------------------------------------------------------- Start

verdrahteKopf();
render();
requestAnimationFrame(() => plan.einpassen());
