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
import { Gebaeude } from "./gebaeude.js";
import { bericht } from "./report.js";
import * as G from "../geometrie.js";
import { KATALOG, Kategorie, finde } from "../komponenten.js";
import { pruefe } from "../pruefung.js";
import * as Normmasse from "../normmasse.js";
import { anlegen, einrasten, Seite } from "../platzierung.js";
import * as Verbindung from "./verbindung.js";

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let projekt = Store.laden();
let auswahl = null;        // { typ: "platzhalter"|"einbau", id } oder null
let paletteWahl = null;    // scharf gestellte Komponente (Klötzchen) zum Platzieren
let einbauWahl = null;     // scharf gestellte Einbau-Art zum Platzieren
let modus = "auswahl";     // auswahl | platzieren | messen-strecke | messen-flaeche
let ansicht = "raum";      // raum | gebaeude | 3d
let befunde = [];
let modell3d = null;       // three.js-Modell, erst beim Öffnen der 3D-Ansicht geladen
let modus3d = "drehen";    // drehen | verschieben | begehen
let wolke3d = null;        // Punktwolken-Viewer (Pipeline-Ergebnis)
let wolkeGeladen = false;
let wolkeInfo = null;
let pipelineUrl = localStorage.getItem("raumwerk.pipeline") || "http://localhost:8781";
let pipelineJobs = [];

const svg = $("plan");
const svgGeb = $("gebaeude");
const plan = new Plan(svg, {
  onSelect, onPlatzhalterMove, onPlace, onMessung, onEinbauSelect, onEinbauMove,
  onFotoMove, onFotoOeffnen
});
const gebaeude = new Gebaeude(svgGeb, { onSelect: onRaumSelect, onMove: onRaumMove });

// ------------------------------------------------------------- Kern

/** Alle Räume; der aktive Raum ist der, den die Detailansicht bearbeitet. */
function raeume() { return projekt.raeume; }
function raum() { return projekt.raeume.find(r => r.id === projekt.aktiverRaum) || projekt.raeume[0]; }
function platzhalter() { return Store.platzhalter(projekt); }

// Auf den aktiven Raum gefilterte Sichten – jedes Objekt trägt seine raumId.
function oeffnungenAkt() { const id = raum().id; return projekt.oeffnungen.filter(o => o.raumId === id); }
function einbautenAkt() { const id = raum().id; return projekt.einbauten.filter(e => e.raumId === id); }
function fotosAkt() { const id = raum().id; return projekt.fotos.filter(f => f.raumId === id); }
function platzhalterAkt() { const id = raum().id; return platzhalter().filter(p => p.raumId === id); }

// Aus den Verbindungen abgeleitete Öffnungen (gemeinsame Türen/Durchgänge).
function tuerOeffnungenAlle() { return projekt.verbindungen.flatMap(v => Verbindung.oeffnungen(v, raeume())); }
function tuerOeffnungenRaum(id) { return tuerOeffnungenAlle().filter(o => o.raumId === id); }
function tuerMarken() { return projekt.verbindungen.map(v => Verbindung.marke(v, raeume())).filter(Boolean); }

function gewaehltPlatzhalter() { return auswahl?.typ === "platzhalter" ? platzhalter().find(p => p.id === auswahl.id) : null; }
function gewaehltEinbau() { return auswahl?.typ === "einbau" ? projekt.einbauten.find(e => e.id === auswahl.id) : null; }
function palettenLeeren() { paletteWahl = null; einbauWahl = null; }

function pruefenJetzt() {
  befunde = pruefe(raum(), platzhalterAkt());
  return befunde;
}

/** Ein voller Durchlauf: prüfen, Ansicht zeichnen, Panels bauen, speichern. */
function render() {
  pruefenJetzt();
  if (ansicht === "raum") {
    plan.setModell({
      raum: raum(), oeffnungen: oeffnungenAkt().concat(tuerOeffnungenRaum(raum().id)),
      einbauten: einbautenAkt(), platzhalter: platzhalterAkt(), fotos: fotosAkt(), befunde, auswahl
    }).zeichne();
  } else if (ansicht === "gebaeude") {
    gebaeude.setModell({ raeume: raeume(), geschoss: raum().geschoss, aktivId: raum().id, tueren: tuerMarken() }).zeichne();
  }
  renderKopf();
  renderRaeume();
  renderRaum();
  renderOeffnungen();
  renderVerbindungen();
  renderPalette();
  renderEinbauPalette();
  renderFotos();
  renderPipeline();
  renderWerkzeuge();
  renderPruefung();
  renderInspektor();
  renderVarianten();
  renderStatus();
  const gespeichert = Store.speichern(projekt);
  if (!gespeichert) $("statusZeile").textContent = "Speicher voll (viele Fotos?) – Stand per Export sichern.";
}

// ------------------------------------------------------- Rückrufe Plan

function onSelect(id) {
  auswahl = id ? { typ: "platzhalter", id } : null;
  if (id) { palettenLeeren(); if (modus === "platzieren") setModus("auswahl"); }
  render();
}

function onEinbauSelect(id) {
  auswahl = { typ: "einbau", id };
  palettenLeeren(); if (modus === "platzieren") setModus("auswahl");
  render();
}

function onPlatzhalterMove(id, patch) {
  const ph = platzhalter().find(p => p.id === id);
  if (!ph) return;
  Object.assign(ph, patch);
  render();
}

function onEinbauMove(id, patch) {
  const e = projekt.einbauten.find(x => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  render();
}

function onPlace(x, y) {
  if (einbauWahl) {
    const art = einbauWahl;
    const e = {
      id: Store.neueId("ein"), raumId: raum().id, art,
      befestigung: Normmasse.befestigung(art), hoeheM: Normmasse.hoehe(art),
      relX: 0.5, relY: 0.5
    };
    Object.assign(e, plan.einrastEinbauVorschlag(e, x, y));
    projekt.einbauten.push(e);
    auswahl = { typ: "einbau", id: e.id };
    render();
  } else if (paletteWahl) {
    const ph = {
      id: Store.neueId("ph"), raumId: raum().id, komponente: paletteWahl,
      xM: x, yM: y, drehungGrad: 0, bezeichnung: ""
    };
    Object.assign(ph, plan.einrastVorschlag(ph, x, y));
    platzhalter().push(ph);
    auswahl = { typ: "platzhalter", id: ph.id };
    render();
  }
}

function onMessung(e) {
  const el = $("messErgebnis");
  el.textContent = e.art === "strecke"
    ? `Strecke: mind. ${e.laengeM.toFixed(2)} m`
    : `Fläche: ${e.flaecheM2.toFixed(2)} m² · Umfang ${e.umfangM.toFixed(2)} m (${e.punkte} Punkte)`;
}

function onFotoMove(id, patch) {
  const f = projekt.fotos.find(x => x.id === id);
  if (f) { Object.assign(f, patch); render(); }
}

function onFotoOeffnen(id) {
  const f = projekt.fotos.find(x => x.id === id);
  if (f) lightboxZeigen(f);
}

// -------------------------------------------------------- Fotos

function renderFotos() {
  const panel = $("panelFotos");
  panel.innerHTML = fotosAkt().map((f, i) => `
    <div class="foto-zeile" data-foto="${f.id}">
      <img class="foto-mini" src="${f.datenUrl}" alt="">
      <div class="foto-mitte">
        <span class="foto-nr">${i + 1}</span>
        <input class="foto-titel" value="${esc(f.titel || "")}" placeholder="Titel">
      </div>
      <button class="foto-auf" title="Groß anzeigen">ansehen</button>
      <button class="weg" title="Foto entfernen">✕</button>
    </div>`).join("") || `<p class="leer">Noch keine Fotos.</p>`;
  panel.insertAdjacentHTML("beforeend", `<button class="klein-knopf" id="fotoPlus">+ Foto hinzufügen</button>`);

  fotosAkt().forEach(f => {
    const z = panel.querySelector(`[data-foto="${f.id}"]`);
    if (!z) return;
    z.querySelector(".foto-mini").onclick = () => lightboxZeigen(f);
    z.querySelector(".foto-auf").onclick = () => lightboxZeigen(f);
    z.querySelector(".foto-titel").addEventListener("change", e => { f.titel = e.target.value; render(); });
    z.querySelector(".weg").onclick = () => { projekt.fotos = projekt.fotos.filter(x => x.id !== f.id); render(); };
  });
  $("fotoPlus").onclick = () => $("fileFoto").click();
}

async function fotosHinzufuegen(dateien) {
  for (const datei of dateien) {
    try {
      const url = await bildSkaliert(datei);
      projekt.fotos.push({
        id: Store.neueId("foto"), raumId: raum().id, relX: 0.5, relY: 0.5,
        titel: datei.name.replace(/\.[^.]+$/, ""), datenUrl: url, notiz: ""
      });
    } catch (_) { /* eine kaputte Datei überspringt den Rest nicht */ }
  }
  render();
}

/** Bild einlesen und verkleinern – hält den localStorage-Speicher klein. */
function bildSkaliert(datei, maxKante = 1280, qualitaet = 0.75) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxKante / Math.max(img.width, img.height));
        const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        res(c.toDataURL("image/jpeg", qualitaet));
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(datei);
  });
}

function lightboxZeigen(f) {
  $("lbBild").src = f.datenUrl;
  $("lbTitel").textContent = f.titel || "Foto";
  $("lbNotiz").textContent = f.notiz || "";
  $("lightbox").hidden = false;
}

function lightboxSchliessen() { $("lightbox").hidden = true; $("lbBild").src = ""; }

// -------------------------------------------------- Gebäude / Räume

function onRaumSelect(id) {
  if (projekt.aktiverRaum === id) return;
  projekt.aktiverRaum = id; auswahl = null; render();
}

function onRaumMove(id, patch) {
  const r = raeume().find(x => x.id === id);
  if (r) { Object.assign(r, patch); render(); }
}

function setAnsicht(a) {
  const vorher = ansicht;
  ansicht = a;
  // SVG-Elemente spiegeln die .hidden-Property NICHT auf das Attribut – daher
  // das Attribut explizit setzen, sonst greift die CSS-Regel verkehrt.
  svg.toggleAttribute("hidden", a !== "raum");
  svgGeb.toggleAttribute("hidden", a !== "gebaeude");
  $("modell3d").toggleAttribute("hidden", a !== "3d");
  $("wolke3d").toggleAttribute("hidden", a !== "wolke");
  // 3D beim Verlassen abbauen, Wolke pausieren: die Grafik rechnet sonst im
  // Hintergrund weiter und zieht Akku (Hinweis aus EINBAU.md).
  if (vorher === "3d" && a !== "3d" && modell3d) { modell3d.dispose(); modell3d = null; }
  if (vorher === "wolke" && a !== "wolke" && wolke3d) wolke3d.pause();
  render();
  if (a === "3d") requestAnimationFrame(dreiDStarten);
  else if (a === "wolke") requestAnimationFrame(() => { if (wolke3d) { wolke3d.weiter(); wolke3d.resize(); } });
  else requestAnimationFrame(() => (a === "raum" ? plan.einpassen() : gebaeude.einpassen()));
}

/** Räume in die Form bringen, die modell3d.js erwartet (englische Feldnamen). */
function raeumeFuer3d() {
  return raeume().map(r => ({
    id: r.id, name: r.name, number: r.nummer, floor: r.geschoss,
    corners: G.ecken(r), posX: Number(r.xM) || 0, posY: Number(r.yM) || 0,
    rotationDeg: Number(r.drehungGrad) || 0, heightM: Number(r.hoeheM) || 2.5, color: r.farbe,
    openings: projekt.oeffnungen.filter(o => o.raumId === r.id).concat(tuerOeffnungenRaum(r.id)).map(o => ({
      wallIndex: o.wandIndex ?? 0, offsetM: Number(o.abstandM) || 0, widthM: Number(o.breiteM) || 0,
      sillM: Number(o.bruestungM) || 0, heightM: Number(o.hoeheM) || 0
    })),
    fixtures: projekt.einbauten.filter(e => e.raumId === r.id).map(e => ({
      id: e.id, roomId: r.id, type: e.art, mount: e.befestigung || Normmasse.befestigung(e.art),
      wallIndex: e.wandIndex ?? 0, offsetM: Number(e.abstandM) || 0,
      heightM: e.hoeheM != null ? Number(e.hoeheM) : null,
      relX: Number(e.relX ?? 0.5), relY: Number(e.relY ?? 0.5)
    }))
  }));
}

/** Lädt three.js beim ersten Öffnen und füllt das Modell. */
async function dreiDStarten() {
  const container = $("modell3d");
  if (!modell3d) {
    try {
      const mod = await import("../modell3d.js");
      modell3d = mod.createModel(container, { onSelect: on3dSelect, onMoved: on3dMoved, snap: on3dSnap });
    } catch (_) {
      container.innerHTML = `<div class="dreid-fehler">3D-Ansicht konnte nicht geladen werden (three.js fehlt unter web/lib/).</div>`;
      return;
    }
  }
  modell3d.setRooms(raeumeFuer3d());
  modell3d.setMode(modus3d);
  modell3d.resize();
}

function on3dSelect(daten) { if (daten) { projekt.aktiverRaum = daten.id; auswahl = null; render(); } }
function on3dMoved(daten) {
  const r = raeume().find(x => x.id === daten.id);
  if (r) { r.xM = daten.posX; r.yM = daten.posY; render(); }
}
function on3dSnap(modelRaum, nx, ny) {
  const echt = raeume().find(r => r.id === modelRaum.id);
  return echt ? einrasten(echt, nx, ny, raeume()) : [nx, ny];
}

// -------------------------------------------------------- AR

/** AR-Besprechung: die aktive Variante im echten Raum überlagern. */
async function arMitKunde() {
  try {
    const mod = await import("./ar.js");
    await mod.starte({
      raum: raum(), platzhalter: platzhalterAkt(), findeKomponente: finde,
      onAenderung: () => render(),   // in AR verschoben → im Modell speichern + überall aktualisieren
      onEnde: () => render(),
    });
  } catch (_) {
    alert("AR konnte nicht gestartet werden (Kamera/WebGL nötig).");
  }
}

// -------------------------------------------------- Pipeline / Wolke

function renderPipeline() {
  const panel = $("panelPipeline");
  panel.innerHTML = `
    <div class="feld"><label>Server-URL</label><input id="pipUrl" value="${esc(pipelineUrl)}"></div>
    <div class="feld-reihe">
      <button class="klein-knopf" id="pipLaden">Aufträge laden</button>
      <button class="klein-knopf" id="pipDatei">PLY-Datei…</button>
    </div>
    <div id="pipListe">${pipelineJobs.length ? pipelineJobs.map(j => `
      <div class="pip-job">
        <span class="pip-name">${esc(j.name)}</span>
        <span class="pip-status ${j.status}">${esc(j.status)}</span>
        ${j.status === "fertig" ? `<button class="mini" data-wolke="${j.id}">Wolke</button>` : ""}
      </div>`).join("") : `<p class="leer">Aufträge laden oder eine PLY-Datei öffnen.</p>`}</div>
    ${wolkeInfo ? `<div class="pip-info">
      ${wolkeInfo.punkte ?? "?"} Punkte · Spanne ${wolkeInfo.spanne_m ?? "?"} m
      ${wolkeInfo.skala != null ? `<br>Maßstab ${wolkeInfo.skala} m/Einheit` : ""}
      ${wolkeInfo.qa != null ? ` · Kontrollmaß ±${wolkeInfo.qa} mm` : ""}
    </div>` : ""}`;
  bind("pipUrl", "change", v => { pipelineUrl = v.replace(/\/+$/, ""); localStorage.setItem("raumwerk.pipeline", pipelineUrl); });
  $("pipLaden").onclick = pipelineAuftraege;
  $("pipDatei").onclick = () => $("fileWolke").click();
  panel.querySelectorAll("[data-wolke]").forEach(b => b.onclick = () => pipelineWolke(b.getAttribute("data-wolke")));
}

async function pipelineAuftraege() {
  try {
    const r = await fetch(`${pipelineUrl}/jobs`);
    pipelineJobs = await r.json();
    renderPipeline();
  } catch (_) {
    alert(`Pipeline nicht erreichbar unter ${pipelineUrl}. Läuft der Server?`);
  }
}

async function pipelineWolke(id) {
  try {
    const [res, ply] = await Promise.all([
      fetch(`${pipelineUrl}/jobs/${id}/result`).then(r => r.json()),
      fetch(`${pipelineUrl}/jobs/${id}/wolke.ply`).then(r => r.text()),
    ]);
    const mass = res?.massstab || {};
    await wolkeAusText(ply, { skala: mass.skala_m_je_einheit, qa: mass.kontrollmass_abweichung_mm });
  } catch (_) {
    alert("Die Punktwolke konnte nicht geladen werden.");
  }
}

/** Eine PLY (aus der Pipeline oder als Datei) in den Wolke-Viewer bringen. */
async function wolkeAusText(plyText, info = {}) {
  const container = $("wolke3d");
  if (!wolke3d) {
    try {
      const mod = await import("./wolke3d.js");
      wolke3d = new mod.Wolke(container);
    } catch (_) {
      container.innerHTML = `<div class="dreid-fehler">Punktwolken-Viewer nicht ladbar (three.js fehlt).</div>`;
      return;
    }
  }
  const stat = wolke3d.laden(plyText);
  wolkeInfo = { ...info, ...stat };
  wolkeGeladen = true;
  setAnsicht("wolke");
}

/** Neuen Raum an den aktiven anlegen – „liegt rechts/hinter …" ohne Fingerschieben. */
function raumAnlegen(seite) {
  const basis = raum();
  const neu = {
    id: Store.neueId("raum"), name: `Raum ${raeume().length + 1}`, nummer: "", geschoss: basis.geschoss,
    breiteM: 3, breiteVorneM: null, tiefeM: 3, schraege: "KEINE", umriss: "",
    hoeheM: basis.hoeheM, xM: 0, yM: 0, drehungGrad: 0, farbe: "#e6d8b5", notiz: ""
  };
  Object.assign(neu, anlegen(neu, basis, seite));
  raeume().push(neu);
  projekt.aktiverRaum = neu.id; auswahl = null;
  render();
  if (ansicht === "gebaeude") requestAnimationFrame(() => gebaeude.einpassen());
}

function raumLoeschen(id) {
  if (raeume().length <= 1) return;
  projekt.raeume = raeume().filter(r => r.id !== id);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== id);
  projekt.einbauten = projekt.einbauten.filter(e => e.raumId !== id);
  projekt.fotos = projekt.fotos.filter(f => f.raumId !== id);
  for (const v of projekt.varianten) v.platzhalter = v.platzhalter.filter(p => p.raumId !== id);
  if (projekt.aktiverRaum === id) projekt.aktiverRaum = raeume()[0].id;
  auswahl = null; render();
}

function geschossName(n) { return n === 0 ? "EG" : n > 0 ? `${n}. OG` : `${-n}. UG`; }

function renderRaeume() {
  const panel = $("panelRaeume");
  const geschosse = [...new Set(raeume().map(r => r.geschoss))].sort((a, b) => b - a);
  const g = raum().geschoss;
  const aufEbene = raeume().filter(r => r.geschoss === g);
  panel.innerHTML = `
    <div class="ansicht-wahl">
      <button class="werkzeug ${ansicht === "raum" ? "aktiv" : ""}" data-ansicht="raum">Rauminnen</button>
      <button class="werkzeug ${ansicht === "gebaeude" ? "aktiv" : ""}" data-ansicht="gebaeude">Gebäude</button>
      <button class="werkzeug ${ansicht === "3d" ? "aktiv" : ""}" data-ansicht="3d">3D</button>
      <button class="werkzeug ${ansicht === "wolke" ? "aktiv" : ""}" data-ansicht="wolke" ${wolkeGeladen ? "" : "disabled"} title="${wolkeGeladen ? "" : "Erst unten eine Wolke laden"}">Wolke</button>
    </div>
    ${geschosse.length > 1 ? `<div class="feld"><label>Geschoss</label><div class="chips">
      ${geschosse.map(n => `<button class="chip ${n === g ? "aktiv" : ""}" data-geschoss="${n}">${geschossName(n)}</button>`).join("")}
    </div></div>` : ""}
    <div class="feld"><label>Räume auf ${geschossName(g)}</label>
      ${aufEbene.map(r => `
        <div class="raum-zeile ${r.id === raum().id ? "aktiv" : ""}" data-raum="${r.id}">
          <button class="raum-wahl">${esc(r.name)}${r.nummer ? ` · ${esc(r.nummer)}` : ""}</button>
          <span class="raum-flaeche">${G.flaeche(r).toFixed(1)} m²</span>
          <button class="weg" title="Raum löschen" ${raeume().length <= 1 ? "disabled" : ""}>✕</button>
        </div>`).join("")}
    </div>
    <div class="feld"><label>Neuen Raum anlegen an</label>
      <div class="anlegen-knoepfe">
        <button data-seite="LINKS">links</button>
        <button data-seite="RECHTS">rechts</button>
        <button data-seite="DAVOR">davor</button>
        <button data-seite="DAHINTER">dahinter</button>
      </div>
    </div>`;

  panel.querySelectorAll("[data-ansicht]").forEach(b => b.onclick = () => setAnsicht(b.getAttribute("data-ansicht")));
  panel.querySelectorAll("[data-geschoss]").forEach(b => b.onclick = () => {
    const n = parseInt(b.getAttribute("data-geschoss"));
    const ziel = raeume().find(r => r.geschoss === n);
    if (ziel) { projekt.aktiverRaum = ziel.id; auswahl = null; render(); }
  });
  panel.querySelectorAll(".raum-zeile").forEach(z => {
    const id = z.getAttribute("data-raum");
    z.querySelector(".raum-wahl").onclick = () => onRaumSelect(id);
    z.querySelector(".weg").onclick = () => raumLoeschen(id);
  });
  panel.querySelectorAll("[data-seite]").forEach(b => b.onclick = () => raumAnlegen(b.getAttribute("data-seite")));
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
  panel.innerHTML = oeffnungenAkt().map(o => `
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

  oeffnungenAkt().forEach(o => {
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

// ----------------------------------------------------- Verbindungen

function renderVerbindungen() {
  const panel = $("panelVerbindungen");
  const akt = raum();
  const meine = projekt.verbindungen.filter(v => v.raumA === akt.id || v.raumB === akt.id);
  const schon = new Set(meine.map(v => (v.raumA === akt.id ? v.raumB : v.raumA)));
  const offen = Verbindung.nachbarn(akt, raeume()).filter(n => !schon.has(n.raum.id));

  const liste = meine.map(v => {
    const anderer = raeume().find(r => r.id === (v.raumA === akt.id ? v.raumB : v.raumA));
    const gilt = Verbindung.marke(v, raeume());
    return `<div class="vb-zeile" data-vb="${v.id}">
      <span>${v.art === "TUER" ? "Tür" : "Durchgang"} → ${esc(anderer ? anderer.name : "?")}${gilt ? "" : ` <em>(getrennt)</em>`}</span>
      <button class="weg" title="entfernen">✕</button></div>`;
  }).join("");

  const neu = offen.map(n => `<div class="vb-neu"><span>${esc(n.raum.name)}</span>
    <button class="mini" data-tuer="${n.raum.id}">+ Tür</button>
    <button class="mini" data-durch="${n.raum.id}">+ Durchgang</button></div>`).join("");

  panel.innerHTML = (liste || `<p class="leer">Keine Verbindungen von „${esc(akt.name)}".</p>`)
    + (neu ? `<div class="feld" style="margin-top:8px"><label>Angrenzende Räume</label>${neu}</div>` : "")
    + (!meine.length && !offen.length ? `<p class="hint">Keine angrenzenden Räume – in der Gebäude-Ansicht Räume aneinanderschieben.</p>` : "");

  panel.querySelectorAll("[data-vb]").forEach(z =>
    z.querySelector(".weg").onclick = () => {
      const id = z.getAttribute("data-vb");
      projekt.verbindungen = projekt.verbindungen.filter(v => v.id !== id);
      render();
    });
  panel.querySelectorAll("[data-tuer]").forEach(b => b.onclick = () => verbindungAnlegen(b.getAttribute("data-tuer"), "TUER"));
  panel.querySelectorAll("[data-durch]").forEach(b => b.onclick = () => verbindungAnlegen(b.getAttribute("data-durch"), "DURCHGANG"));
}

function verbindungAnlegen(nachbarId, art) {
  projekt.verbindungen.push({
    id: Store.neueId("vb"), raumA: raum().id, raumB: nachbarId,
    art, breiteM: art === "TUER" ? 0.885 : 1.0,
  });
  render();
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
      const an = paletteWahl !== s;
      palettenLeeren(); paletteWahl = an ? s : null;
      setModus(an ? "platzieren" : "auswahl");
    });
}

// Einbauten des Bestands (Steckdosen, Schalter, Leuchten …) mit Norm-Höhen.
function renderEinbauPalette() {
  const panel = $("panelEinbauPalette");
  if (!panel) return;
  panel.innerHTML = [...Normmasse.ARTEN].map(([k, label]) =>
    `<button class="chip ${einbauWahl === k ? "aktiv" : ""}" data-ein-art="${k}" title="${esc(label)}">${esc(label)}</button>`).join("");
  panel.querySelectorAll("[data-ein-art]").forEach(b =>
    b.onclick = () => {
      const a = b.getAttribute("data-ein-art");
      const an = einbauWahl !== a;
      palettenLeeren(); einbauWahl = an ? a : null;
      setModus(an ? "platzieren" : "auswahl");
    });
}

// ----------------------------------------------------------- Werkzeuge

function renderWerkzeuge() {
  const panel = $("panelWerkzeuge");
  if (ansicht === "3d") {
    const wz = [["drehen", "Umschauen"], ["verschieben", "Räume schieben"], ["begehen", "Begehen"]];
    panel.innerHTML = wz.map(([m, t]) =>
      `<button class="werkzeug ${modus3d === m ? "aktiv" : ""}" data-modus3d="${m}">${t}</button>`).join("");
    panel.querySelectorAll("[data-modus3d]").forEach(b =>
      b.onclick = () => { modus3d = b.getAttribute("data-modus3d"); modell3d?.setMode(modus3d); renderWerkzeuge(); renderStatus(); });
    return;
  }
  if (ansicht !== "raum") { panel.innerHTML = ""; return; }   // Gebäude/Wolke: keine Raum-Werkzeuge
  const wz = [["auswahl", "Auswahl"], ["messen-strecke", "Messen ↔"], ["messen-flaeche", "Fläche ▱"]];
  panel.innerHTML = wz.map(([m, t]) =>
    `<button class="werkzeug ${modus === m ? "aktiv" : ""}" data-modus="${m}">${t}</button>`).join("");
  panel.querySelectorAll("[data-modus]").forEach(b =>
    b.onclick = () => { palettenLeeren(); $("messErgebnis").textContent = ""; setModus(b.getAttribute("data-modus")); });
}

function setModus(m) {
  modus = m;
  plan.setModus(m);
  renderPalette();
  renderEinbauPalette();
  renderWerkzeuge();
  renderStatus();
}

/** Warnungen einer Variante über alle Räume – jede Prüfung braucht ihren Raum. */
function warnungenVariante(v) {
  let w = 0;
  for (const r of raeume()) {
    const phs = v.platzhalter.filter(p => p.raumId === r.id);
    if (phs.length) w += pruefe(r, phs).filter(b => b.schwere === "WARNUNG").length;
  }
  return w;
}

function renderStatus() {
  if (ansicht === "gebaeude") {
    $("statusZeile").textContent = "Räume ziehen zum Anordnen · Kanten rasten an Nachbarräume ein · Klick wählt den aktiven Raum";
    return;
  }
  if (ansicht === "3d") {
    $("statusZeile").textContent = {
      drehen: "Ziehen dreht die Ansicht · Rad zoomt · Raum anklicken wählt ihn",
      verschieben: "Räume im Modell schieben – Kanten rasten ein",
      begehen: "Begehen: WASD / Pfeiltasten laufen, ziehen schaut um"
    }[modus3d] || "";
    return;
  }
  if (ansicht === "wolke") {
    const i = wolkeInfo || {};
    $("statusZeile").textContent = `Punktwolke aus der Pipeline · ${i.punkte ?? "?"} Punkte`
      + (i.skala != null ? ` · Maßstab ${i.skala} m/Einheit` : "") + " · ziehen dreht, Rad zoomt";
    return;
  }
  const wasName = einbauWahl ? Normmasse.ARTEN.get(einbauWahl) : finde(paletteWahl)?.name ?? "";
  const txt = {
    auswahl: "Gerät ziehen zum Verschieben · nahe Wand rastet es ein · Rad zoomt",
    platzieren: `„${wasName}" platzieren – in den Plan klicken`,
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
  const panel = $("panelInspektor");
  const ein = gewaehltEinbau();
  if (ein) { renderEinbauInspektor(panel, ein); return; }
  const ph = gewaehltPlatzhalter();
  if (!ph) { panel.innerHTML = `<p class="hint">Nichts ausgewählt. Klick ein Klötzchen oder einen Einbau im Plan an.</p>`; return; }
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
    auswahl = null; render();
  };
}

function renderEinbauInspektor(panel, ein) {
  const bef = ein.befestigung ?? Normmasse.befestigung(ein.art);
  panel.innerHTML = `
    <div class="insp-titel">Einbau (Bestand)</div>
    <div class="feld"><label>Art</label><select id="eArt">
      ${[...Normmasse.ARTEN].map(([k, v]) => `<option value="${k}" ${ein.art === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
    </select></div>
    <div class="insp-zeile"><span>Befestigung</span><span>${bef === "WAND" ? `Wand ${(ein.wandIndex ?? 0) + 1}` : bef === "DECKE" ? "Decke" : bef === "BODEN" ? "Boden" : "frei"}</span></div>
    <div class="feld"><label>Höhe über Boden (m)</label><input id="eHoehe" type="number" step="0.05" value="${ein.hoeheM == null ? "" : num(ein.hoeheM)}" placeholder="${bef === "DECKE" ? "an der Decke" : "Richtwert"}"></div>
    <p class="hint">Ziehen verschiebt den Einbau; Wandgeräte rasten an die nächste Wand.</p>
    <button class="loeschen" id="eDel">Einbau entfernen</button>`;
  $("eArt").onchange = e => {
    ein.art = e.target.value;
    ein.befestigung = Normmasse.befestigung(ein.art);
    ein.hoeheM = Normmasse.hoehe(ein.art);        // Norm-Höhe zur neuen Art
    render();
  };
  bind("eHoehe", "change", v => { ein.hoeheM = v.trim() === "" ? null : (parseFloat(v) || 0); render(); });
  $("eDel").onclick = () => { projekt.einbauten = projekt.einbauten.filter(x => x.id !== ein.id); auswahl = null; render(); };
}

// ---------------------------------------------------------- Varianten

function renderVarianten() {
  const panel = $("panelVarianten");
  panel.innerHTML = `<table class="var-tabelle">
    <tr><th>Variante</th><th>Geräte</th><th>Warnungen</th><th></th></tr>
    ${projekt.varianten.map((v, i) => {
      const w = warnungenVariante(v);
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
    tr.querySelector(".var-wahl").onclick = e => { e.preventDefault(); projekt.aktiveVariante = i; auswahl = null; render(); };
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
  $("varianteSelect").onchange = e => { projekt.aktiveVariante = parseInt(e.target.value); auswahl = null; render(); };
  $("btnVarianteNeu").onclick = () => { Store.varianteNeu(projekt); auswahl = null; render(); };
  $("btnVarianteKlon").onclick = () => { Store.varianteKlonen(projekt); auswahl = null; render(); };
  $("btnVarianteDel").onclick = () => {
    if (projekt.varianten.length > 1 && confirm("Aktive Variante löschen?")) {
      Store.varianteLoeschen(projekt, projekt.aktiveVariante); auswahl = null; render();
    }
  };
  $("btnReport").onclick = () => {
    // Der Report zeigt den Grundriss des aktiven Raums – dafür in die
    // Rauminnenansicht wechseln, damit die SVG-Maße stimmen.
    if (ansicht !== "raum") setAnsicht("raum");
    plan.einpassen();
    const r = svg.getBoundingClientRect();
    bericht(projekt, Store.aktiveVariante(projekt), pruefe(raum(), platzhalterAkt()), svg.innerHTML,
      { width: Math.round(r.width) || 900, height: Math.round(r.height) || 560 });
  };
  $("btnReset").onclick = () => {
    if (confirm("Zum Beispielprojekt zurücksetzen? Der aktuelle Stand geht verloren.")) {
      projekt = Store.beispielProjekt(); auswahl = null; palettenLeeren(); setModus("auswahl"); setAnsicht("raum");
    }
  };
  $("btnEinpassen").onclick = () => {
    if (ansicht === "raum") plan.einpassen();
    else if (ansicht === "gebaeude") gebaeude.einpassen();
    else if (ansicht === "3d") modell3d?.resize();
    else wolke3d?.resize();
  };
  $("btnAR").onclick = arMitKunde;
  $("btnExport").onclick = exportJson;
  $("btnImport").onclick = () => $("fileImport").click();
  $("fileImport").onchange = e => importJson(e.target.files[0]);
  $("fileFoto").onchange = e => { fotosHinzufuegen([...e.target.files]); e.target.value = ""; };
  $("fileWolke").onchange = e => {
    const f = e.target.files[0];
    if (f) f.text().then(t => wolkeAusText(t, { quelle: f.name }));
    e.target.value = "";
  };
  $("lbZu").onclick = lightboxSchliessen;
  $("lightbox").onclick = e => { if (e.target.id === "lightbox") lightboxSchliessen(); };
}

/** Projekt als JSON sichern – zum Teilen oder als Backup (kundenlink-tauglich). */
function exportJson() {
  const blob = new Blob([JSON.stringify(projekt, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (projekt.name || "raumwerk").replace(/[^\w\-]+/g, "_") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Ein gesichertes Projekt wieder einlesen. Nachsichtig: Unsinn wird abgewiesen. */
function importJson(datei) {
  if (!datei) return;
  const leser = new FileReader();
  leser.onload = () => {
    try {
      const obj = Store.ausObjekt(JSON.parse(leser.result));
      if (!obj.raeume || !obj.raeume.length) throw new Error("keine Räume");
      projekt = obj; auswahl = null; palettenLeeren(); setModus("auswahl"); setAnsicht("raum");
    } catch (_) {
      alert("Die Datei ist kein gültiges RAUMWERK-Projekt.");
    }
  };
  leser.readAsText(datei);
  $("fileImport").value = "";
}

// -------------------------------------------------------- Tastatur

window.addEventListener("keydown", e => {
  if (!$("lightbox").hidden && e.key === "Escape") { lightboxSchliessen(); return; }
  if (e.target.matches("input, select, textarea")) return;
  const ph = gewaehltPlatzhalter();
  const ein = gewaehltEinbau();
  if (e.key === "Escape") { palettenLeeren(); auswahl = null; setModus("auswahl"); render(); }
  else if ((ph || ein) && (e.key === "Delete" || e.key === "Backspace")) {
    if (ph) Store.aktiveVariante(projekt).platzhalter = Store.aktiveVariante(projekt).platzhalter.filter(p => p.id !== ph.id);
    else projekt.einbauten = projekt.einbauten.filter(x => x.id !== ein.id);
    auswahl = null; render();
  } else if (ph && (e.key === "r" || e.key === "R")) {
    ph.drehungGrad = (((ph.drehungGrad || 0) + (e.shiftKey ? -15 : 15)) % 360 + 360) % 360; render();
  }
});

window.addEventListener("resize", () => {
  if (ansicht === "raum") plan.zeichne();
  else if (ansicht === "gebaeude") gebaeude.zeichne();
  else if (ansicht === "3d") modell3d?.resize();
  else wolke3d?.resize();
});

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
