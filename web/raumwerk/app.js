/*
 * RAUMWERK · Planungswerkzeug – Controller.
 *
 * Führt den Zustand (Store), verdrahtet die Grundriss-Ansicht (Plan) und baut
 * die Bedienpanels. Nach jeder Änderung läuft die Normprüfung neu und das
 * Ergebnis fließt in Plan (Zonen/Warnfarben) und in die rechte Spalte.
 *
 * Ablauf wie im Konzept: Raum aufnehmen (Assistent: zielen, Maßband oder
 * Rechteck – ohne Würfel) → Wände bei Bedarf mit dem Bandmaß nachmessen →
 * Geräte-Klötzchen setzen und ziehen → Freiräume werden live geprüft →
 * Varianten vergleichen → Report über alle Räume.
 *
 * Robustheit: Jeder Darstellungsschritt läuft für sich – fällt ein Panel aus,
 * werden die anderen trotzdem gebaut und der Stand trotzdem gespeichert.
 * Alles, was aus gespeicherten oder importierten Projekten stammt, wird beim
 * Einsetzen ins HTML maskiert.
 */

import * as Store from "./store.js";
import { Plan } from "./plan2d.js";
import { Gebaeude } from "./gebaeude.js";
import * as Report from "./report.js";
import * as G from "../geometrie.js";
import { KATALOG, finde } from "../komponenten.js";
import { pruefe } from "../pruefung.js";
import * as Normmasse from "../normmasse.js";
import { anlegen, einrasten } from "../platzierung.js";
import * as Verbindung from "./verbindung.js";
import { uebernehmen, nachmessen, waendeMitHerkunft } from "./uebernahme.js";

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssEsc = s => (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));

let projekt = projektLaden();
let auswahl = null;        // { typ: "platzhalter"|"einbau", id } oder null
let paletteWahl = null;    // scharf gestellte Komponente (Klötzchen) zum Platzieren
let einbauWahl = null;     // scharf gestellte Einbau-Art zum Platzieren
let modus = "auswahl";     // auswahl | platzieren | messen-strecke | messen-flaeche
let ansicht = "raum";      // raum | gebaeude | 3d | wolke
let befunde = [];
let modell3d = null;       // three.js-Modell, erst beim Öffnen der 3D-Ansicht geladen
let modus3d = "drehen";    // drehen | verschieben | begehen
let wolke3d = null;        // Punktwolken-Viewer (Pipeline-Ergebnis)
let wolkeGeladen = false;
let wolkeInfo = null;
let pipelineUrl = speicherLesen("raumwerk.pipeline") || "http://localhost:8781";
let pipelineJobs = [];
let zugEntwurf = null;     // Polygonzug-Editor: die Eingabe des Nutzers { raumId, stand, waende }
let assistentOffen = false;
let mitUmschalt = false;   // Umschalt beim Klick in den Plan → Platzieren bleibt scharf

const svg = $("plan");
const svgGeb = $("gebaeude");
const plan = new Plan(svg, {
  onSelect, onPlatzhalterMove, onPlace, onMessung, onEinbauSelect, onEinbauMove,
  onFotoMove, onFotoOeffnen, onMesspunkte
});
const gebaeude = new Gebaeude(svgGeb, { onSelect: onRaumSelect, onMove: onRaumMove });

/** Gespeichertes Projekt – im Zweifel das Beispiel, nie eine leere Seite. */
function projektLaden() {
  try { return Store.laden(); } catch (_) { return Store.beispielProjekt(); }
}

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

/**
 * Ein Darstellungsschritt für sich: ein Fehler darin hält weder die übrigen
 * Panels noch das Speichern an. Das betroffene Panel sagt ehrlich Bescheid.
 */
function schritt(name, fn, panelId) {
  try { fn(); }
  catch (e) {
    console.error(`RAUMWERK: „${name}“ konnte nicht dargestellt werden.`, e);
    const p = panelId && $(panelId);
    if (p) p.innerHTML = `<p class="leer fehler-text">Dieser Bereich konnte nicht angezeigt werden (${esc(e?.message || "Fehler")}).</p>`;
  }
}

/** Ein voller Durchlauf: prüfen, Ansicht zeichnen, Panels bauen, speichern. */
function render() {
  clearTimeout(renderTimer); renderWartet = false;
  const fokus = fokusMerken();
  schritt("Normprüfung", () => { try { pruefenJetzt(); } catch (e) { befunde = []; throw e; } });
  if (ansicht === "raum") {
    schritt("Grundriss", () => plan.setModell({
      raum: raum(), oeffnungen: oeffnungenAkt().concat(tuerOeffnungenRaum(raum().id)),
      einbauten: einbautenAkt(), platzhalter: platzhalterAkt(), fotos: fotosAkt(), befunde, auswahl
    }).zeichne());
  } else if (ansicht === "gebaeude") {
    schritt("Gebäude", () => gebaeude.setModell({ raeume: raeume(), geschoss: raum().geschoss, aktivId: raum().id, tueren: tuerMarken() }).zeichne());
  }
  schritt("Kopfleiste", renderKopf);
  schritt("Räume", renderRaeume, "panelRaeume");
  schritt("Aktiver Raum", renderRaum, "panelRaum");
  schritt("Öffnungen", renderOeffnungen, "panelOeffnungen");
  schritt("Verbindungen", renderVerbindungen, "panelVerbindungen");
  schritt("Geräte-Palette", renderPalette, "panelPalette");
  schritt("Installation", renderEinbauPalette, "panelEinbauPalette");
  schritt("Fotos", renderFotos, "panelFotos");
  schritt("Pipeline", renderPipeline, "panelPipeline");
  schritt("Werkzeuge", renderWerkzeuge, "panelWerkzeuge");
  schritt("Prüfung", renderPruefung, "panelPruefung");
  schritt("Auswahl", renderInspektor, "panelInspektor");
  schritt("Varianten", renderVarianten, "panelVarianten");
  schritt("Statuszeile", renderStatus);
  fokusWiederherstellen(fokus);
  speichernJetzt();
}

/** Speichern; klappt es nicht, bleibt ein Banner mit Export-Knopf stehen. */
function speichernJetzt() {
  let ok = false;
  try { ok = Store.speichern(projekt); } catch (_) { ok = false; }
  const b = $("speicherBanner");
  if (b) b.hidden = !!ok;
  return ok;
}

// Neu aufbauen erst, wenn der Fokus gewandert ist (Tab) und ein laufender
// Klick fertig ist – sonst verschluckt der Neuaufbau Tab und Klick.
let renderTimer = 0, renderWartet = false, zeigerUnten = false;
function renderBald() {
  clearTimeout(renderTimer);
  if (zeigerUnten) { renderWartet = true; renderTimer = setTimeout(render, 1500); return; }   // Sicherheitsnetz
  renderTimer = setTimeout(render, 0);
}
document.addEventListener("pointerdown", () => { zeigerUnten = true; }, true);
const zeigerHoch = () => {
  zeigerUnten = false;
  if (renderWartet) { renderWartet = false; clearTimeout(renderTimer); renderTimer = setTimeout(render, 0); }
};
document.addEventListener("pointerup", zeigerHoch, true);
document.addEventListener("pointercancel", zeigerHoch, true);

/** Fokus vor dem Neuaufbau merken – per id oder data-fokus, samt Markierung. */
function fokusMerken() {
  const el = document.activeElement;
  if (!el || el === document.body || !el.closest?.(".spalte, .appbar, .plan-toolbar")) return null;
  const id = el.id || null, schluessel = el.dataset?.fokus || null;
  if (!id && !schluessel) return null;
  let sel = null;
  try { if (typeof el.selectionStart === "number") sel = [el.selectionStart, el.selectionEnd, el.selectionDirection || "none"]; } catch (_) { /* kein Textfeld */ }
  return { el, id, schluessel, sel };
}

function fokusWiederherstellen(f) {
  if (!f || (f.el.isConnected && document.activeElement === f.el)) return;
  if (document.activeElement && document.activeElement !== document.body && document.activeElement !== f.el) return;   // Nutzer ist schon woanders
  const neu = f.id ? $(f.id) : document.querySelector(`[data-fokus="${cssEsc(f.schluessel)}"]`);
  if (!neu || neu.disabled) return;
  try { neu.focus({ preventScroll: true }); } catch (_) { return; }
  if (f.sel && typeof neu.setSelectionRange === "function") {
    try { neu.setSelectionRange(f.sel[0], f.sel[1], f.sel[2]); } catch (_) { /* z. B. type=number */ }
  }
}

// ------------------------------------------------------- Hinweis-Box

let meldungTimer = 0;
/**
 * Hinweis über dem Plan – für Ergebnisse (Aufmaß übernommen, Nachmessen) und
 * Angebote („Jetzt aufnehmen“). Mit Liste oder Knopf bleibt er stehen.
 */
function meldung(titel, { hinweise = [], aktion = null, dauer } = {}) {
  const box = $("hinweisBox");
  if (!box) return;
  const liste = [...new Set((hinweise || []).filter(Boolean).map(String))];
  const aktionen = (Array.isArray(aktion) ? aktion : aktion ? [aktion] : []).filter(a => a && a.fn);
  box.innerHTML = `
    <div class="hb-text"><b>${esc(titel)}</b>${liste.length ? `<ul>${liste.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}</div>
    ${aktionen.map((a, i) => `<button class="${i ? "" : "haupt"}" data-hb="${i}">${esc(a.text)}</button>`).join("")}
    <button class="hb-zu" id="hbZu" title="Hinweis schließen" aria-label="Hinweis schließen">✕</button>`;
  box.hidden = false;
  $("hbZu").onclick = meldungZu;
  box.querySelectorAll("[data-hb]").forEach(b => b.onclick = () => { meldungZu(); aktionen[Number(b.dataset.hb)].fn(); });
  clearTimeout(meldungTimer);
  // Mit Liste bleibt der Hinweis, bis er gelesen und geschlossen ist; ein Angebot eine Weile.
  const ms = dauer ?? (liste.length ? 0 : aktionen.length ? 20000 : 6000);
  if (ms) meldungTimer = setTimeout(meldungZu, ms);
}
function meldungZu() { clearTimeout(meldungTimer); const b = $("hinweisBox"); if (b) { b.hidden = true; b.innerHTML = ""; } }

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

/** Ein Klick im Platzieren-Modus setzt ein Teil – mit Umschalt bleibt der Modus scharf. */
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
  } else if (paletteWahl) {
    const ph = {
      id: Store.neueId("ph"), raumId: raum().id, komponente: paletteWahl,
      xM: x, yM: y, drehungGrad: 0, bezeichnung: ""
    };
    Object.assign(ph, plan.einrastVorschlag(ph, x, y));
    platzhalter().push(ph);
    auswahl = { typ: "platzhalter", id: ph.id };
  } else return;
  if (!mitUmschalt) { palettenLeeren(); modus = "auswahl"; plan.setModus("auswahl"); }
  render();
}
// Umschalt merken, bevor der Plan den Klick als Platzierung meldet.
svg.addEventListener("pointerdown", e => { mitUmschalt = !!e.shiftKey; }, true);

function onMessung(e) {
  const el = $("messErgebnis");
  el.textContent = e.art === "strecke"
    ? `Strecke: mind. ${komma(e.laengeM, 2)} m`
    : `Fläche: ${komma(e.flaecheM2, 2)} m² · Umfang ${komma(e.umfangM, 2)} m (${e.punkte} Punkte)`;
  messKnopf(0);
}

/** Der Plan meldet die Zahl der Messpunkte – ab drei gibt es „Fläche schließen“. */
function onMesspunkte(n) { messKnopf(n); }

function messKnopf(n = plan.messpunkte?.length || 0) {
  const b = $("btnFlaecheZu");
  if (b) b.hidden = !(ansicht === "raum" && modus === "messen-flaeche" && n >= 3);
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

/** Nur eingebettete Bilder anzeigen – ein Import könnte sonst fremde Adressen einschleusen. */
function sichereBildUrl(u) {
  return typeof u === "string" && /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(u) ? u : "";
}

function renderFotos() {
  const panel = $("panelFotos");
  const liste = fotosAkt();
  panel.innerHTML = liste.map((f, i) => `
    <div class="foto-zeile" data-i="${i}">
      <img class="foto-mini" src="${esc(sichereBildUrl(f.datenUrl))}" alt="">
      <div class="foto-mitte">
        <span class="foto-nr">${i + 1}</span>
        <input class="foto-titel" data-fokus="foto-${i}" value="${esc(f.titel || "")}" placeholder="Titel">
      </div>
      <button class="foto-auf" title="Groß anzeigen">ansehen</button>
      <button class="weg" title="Foto entfernen">✕</button>
    </div>`).join("") || `<p class="leer">Noch keine Fotos.</p>`;
  panel.insertAdjacentHTML("beforeend", `<button class="klein-knopf" id="fotoPlus">+ Foto hinzufügen</button>`);

  panel.querySelectorAll(".foto-zeile").forEach(z => {
    const f = liste[Number(z.dataset.i)];
    if (!f) return;
    z.querySelector(".foto-mini").onclick = () => lightboxZeigen(f);
    z.querySelector(".foto-auf").onclick = () => lightboxZeigen(f);
    z.querySelector(".foto-titel").addEventListener("change", e => { f.titel = e.target.value; renderBald(); });
    z.querySelector(".weg").onclick = () => {
      if (!confirm(`Foto „${f.titel || "ohne Titel"}“ entfernen?`)) return;
      projekt.fotos = projekt.fotos.filter(x => x !== f); render();
    };
  });
  $("fotoPlus").onclick = () => $("fileFoto").click();
}

async function fotosHinzufuegen(dateien) {
  let fehler = 0;
  for (const datei of dateien) {
    try {
      const url = await bildSkaliert(datei);
      projekt.fotos.push({
        id: Store.neueId("foto"), raumId: raum().id, relX: 0.5, relY: 0.5,
        titel: datei.name.replace(/\.[^.]+$/, ""), datenUrl: url, notiz: ""
      });
    } catch (_) { fehler++; /* eine kaputte Datei überspringt den Rest nicht */ }
  }
  render();
  if (fehler) meldung(`${fehler} Datei(en) ließen sich nicht als Bild lesen.`);
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
  $("lbBild").src = sichereBildUrl(f.datenUrl);
  $("lbTitel").textContent = f.titel || "Foto";
  $("lbNotiz").textContent = f.notiz || "";
  $("lightbox").hidden = false;
}

function lightboxSchliessen() { $("lightbox").hidden = true; $("lbBild").removeAttribute("src"); }

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
  messKnopf();
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

// -------------------------------------------------------- Aufnahme

/**
 * Raum aufnehmen – der Kernablauf: Assistent öffnen (zielen, Maßband oder
 * Rechteck), Ergebnis in den Raum übernehmen, Plan einpassen, Hinweise zeigen.
 */
async function raumAufnehmen(start) {
  if (assistentOffen) return;
  const ziel = raum();
  const id = ziel.id;
  assistentOffen = true;
  let mod;
  try { mod = await import("./assistent.js"); }
  catch (_) { assistentOffen = false; alert("Der Aufmaß-Assistent konnte nicht geladen werden."); return; }
  try {
    mod.starteAssistent({
      raum: ziel, neueId: Store.neueId, start,
      onUebernehmen: e => {
        assistentOffen = false;
        let h = [];
        try { h = uebernehmen(projekt, id, e, Store.neueId); }
        catch (err) { console.error("RAUMWERK: Aufmaß nicht übernommen.", err); alert("Das Aufmaß konnte nicht übernommen werden."); return; }
        projekt.aktiverRaum = id; auswahl = null; zugEntwurf = null;
        if (ansicht !== "raum") setAnsicht("raum"); else render();
        plan.einpassen();
        const r = raeume().find(x => x.id === id) || raum();
        meldung(`${r.name}: ${komma(G.flaeche(r), 2)} m² · ${G.wandLaengen(r).length} Wände übernommen`,
          { hinweise: [...(Array.isArray(e?.hinweise) ? e.hinweise : []), ...h] });
      },
      onAbbruch: () => { assistentOffen = false; }
    });
  } catch (err) {
    assistentOffen = false;
    console.error("RAUMWERK: Assistent nicht gestartet.", err);
    alert("Der Aufmaß-Assistent konnte nicht gestartet werden.");
  }
}

/** Eine Wand mit dem Bandmaß nachmessen – der Rest des Raums wird ausgeglichen. */
function wandNachmessen(i, laengeM) {
  const r = raum();
  let h = [];
  try { h = nachmessen(projekt, r.id, i, laengeM, Store.neueId); }
  catch (err) { console.error("RAUMWERK: Nachmessen fehlgeschlagen.", err); alert("Nachmessen fehlgeschlagen."); return; }
  zugEntwurf = null;
  renderBald();
  meldung(`Wand ${i + 1}: ${komma(laengeM, 2)} m mit dem Bandmaß übernommen`, { hinweise: h });
}

// -------------------------------------------------------- AR / Scan

/** AR-Besprechung: die aktive Variante im echten Raum überlagern. */
async function arMitKunde() {
  try {
    const mod = await import("./ar.js");
    await mod.starte({
      raum: raum(), platzhalter: platzhalterAkt(), einbauten: einbautenAkt(),
      findeKomponente: finde, neueId: Store.neueId,
      einbauHinzufuegen: (e) => projekt.einbauten.push(e),   // vor Ort gesetzt → ins Modell
      onAenderung: () => render(),   // sofort speichern + alle Ansichten aktualisieren
      onEnde: () => render(),
    });
  } catch (_) {
    alert("AR konnte nicht gestartet werden (Kamera/WebGL nötig).");
  }
}

/** Geführte Foto-Aufnahme für die Photogrammetrie (Referenzwürfel + Sensorik). */
async function scanStarten() {
  try {
    const mod = await import("./scan.js");
    await mod.starteScan({
      raum: raum(),
      speichern: (manifest) => {
        projekt.scans = projekt.scans || [];
        projekt.scans.push(manifest);
        speichernJetzt();
      },
      onEnde: () => render(),
    });
  } catch (_) {
    alert("Scan konnte nicht gestartet werden (Kamera nötig).");
  }
}

// -------------------------------------------------- Pipeline / Wolke

function renderPipeline() {
  const panel = $("panelPipeline");
  const zahl = v => (v == null ? "?" : esc(v));
  panel.innerHTML = `
    <div class="feld"><label for="pipUrl">Server-URL</label><input id="pipUrl" value="${esc(pipelineUrl)}"></div>
    <div class="feld-reihe">
      <button class="klein-knopf" id="pipLaden">Aufträge laden</button>
      <button class="klein-knopf" id="pipDatei">PLY-Datei…</button>
    </div>
    <div id="pipListe">${pipelineJobs.length ? pipelineJobs.map((j, i) => `
      <div class="pip-job">
        <span class="pip-name">${esc(j?.name)}</span>
        <span class="pip-status ${String(j?.status ?? "").replace(/[^a-z]/g, "")}">${esc(j?.status)}</span>
        ${j?.status === "fertig" ? `<button class="mini" data-wolke="${i}" data-fokus="wolke-${i}">Wolke</button>` : ""}
      </div>`).join("") : `<p class="leer">Aufträge laden oder eine PLY-Datei öffnen.</p>`}</div>
    ${wolkeInfo ? `<div class="pip-info">
      ${zahl(wolkeInfo.punkte)} Punkte · Spanne ${zahl(wolkeInfo.spanne_m)} m
      ${wolkeInfo.skala != null ? `<br>Maßstab ${esc(wolkeInfo.skala)} m/Einheit` : ""}
      ${wolkeInfo.qa != null ? ` · Kontrollmaß ±${esc(wolkeInfo.qa)} mm` : ""}
    </div>` : ""}`;
  bind("pipUrl", "change", v => { pipelineUrl = v.trim().replace(/\/+$/, ""); speicherSchreiben("raumwerk.pipeline", pipelineUrl); });
  $("pipLaden").onclick = pipelineAuftraege;
  $("pipDatei").onclick = () => $("fileWolke").click();
  panel.querySelectorAll("[data-wolke]").forEach(b => b.onclick = () => {
    const j = pipelineJobs[Number(b.getAttribute("data-wolke"))];
    if (j) pipelineWolke(j.id);
  });
}

async function pipelineAuftraege() {
  try {
    const r = await fetch(`${pipelineUrl}/jobs`);
    const daten = await r.json();
    pipelineJobs = Array.isArray(daten) ? daten.filter(j => j && typeof j === "object") : [];
    renderPipeline();
  } catch (_) {
    alert(`Pipeline nicht erreichbar unter ${pipelineUrl}. Läuft der Server?`);
  }
}

async function pipelineWolke(id) {
  try {
    const pfad = encodeURIComponent(String(id));
    const [res, ply] = await Promise.all([
      fetch(`${pipelineUrl}/jobs/${pfad}/result`).then(r => r.json()),
      fetch(`${pipelineUrl}/jobs/${pfad}/wolke.ply`).then(r => r.text()),
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

// ------------------------------------------------------ Räume anlegen

const VERSATZ = 1000;   // Hilfsverschiebung, um die ≥0-Klemme von anlegen() zu umgehen

/** Umrissbox eines Raums in Gebäudekoordinaten. */
function kasten(r) {
  const x0 = Number(r.xM) || 0, y0 = Number(r.yM) || 0;
  return { x0, y0, x1: x0 + G.breite(r), y1: y0 + G.tiefe(r) };
}

/** Überlappt [r] einen anderen Raum desselben Geschosses (mehr als 1 cm)? */
function ueberlappt(r, liste = raeume()) {
  const a = kasten(r);
  return liste.some(o => {
    if (o === r || o.id === r.id || o.geschoss !== r.geschoss) return false;
    const b = kasten(o);
    return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.01;
  });
}

/** Neuen Raum an den aktiven anlegen – „liegt rechts/hinter …“ ohne Fingerschieben. */
function raumAnlegen(seite) {
  const basis = raum();
  const neu = {
    id: Store.neueId("raum"), name: `Raum ${raeume().length + 1}`, nummer: "", geschoss: basis.geschoss,
    breiteM: 3, breiteVorneM: null, tiefeM: 3, schraege: "KEINE", umriss: "",
    hoeheM: basis.hoeheM, aufbauM: 0, xM: 0, yM: 0, drehungGrad: 0, farbe: "#e6d8b5", notiz: ""
  };
  Object.assign(neu, anlegen(neu, basis, seite));
  // anlegen() klemmt auf ≥ 0 – „links“/„davor“ am Rand landet der neue Raum
  // dann auf dem alten. Statt ihn zu stapeln, das ganze Projekt verschieben.
  if (ueberlappt(neu)) {
    const roh = anlegen(neu, { ...basis, xM: (Number(basis.xM) || 0) + VERSATZ, yM: (Number(basis.yM) || 0) + VERSATZ }, seite);
    const sollX = roh.xM - VERSATZ, sollY = roh.yM - VERSATZ;
    const dx = Math.max(0, -sollX), dy = Math.max(0, -sollY);
    if (dx > 0 || dy > 0) {
      for (const r of raeume()) { r.xM = runde((Number(r.xM) || 0) + dx); r.yM = runde((Number(r.yM) || 0) + dy); }
      neu.xM = runde(sollX + dx); neu.yM = runde(sollY + dy);
    }
  }
  raeume().push(neu);
  projekt.aktiverRaum = neu.id; auswahl = null; zugEntwurf = null;
  render();
  if (ansicht === "gebaeude") requestAnimationFrame(() => gebaeude.einpassen());
  else requestAnimationFrame(() => plan.einpassen());
  meldung(`„${neu.name}“ angelegt – noch mit 3 × 3 m Platzhaltermaß.`, {
    hinweise: ueberlappt(neu) ? ["Der neue Raum überlappt einen anderen – in der Gebäude-Ansicht verschieben."] : [],
    aktion: { text: "Jetzt aufnehmen", fn: () => raumAufnehmen() }
  });
}

function raumLoeschen(id) {
  if (raeume().length <= 1) return;
  const r = raeume().find(x => x.id === id);
  if (!r) return;
  const n = projekt.oeffnungen.filter(o => o.raumId === id).length + projekt.einbauten.filter(e => e.raumId === id).length
    + projekt.fotos.filter(f => f.raumId === id).length;
  if (!confirm(`Raum „${r.name}“ löschen?${n ? ` ${n} Öffnung(en), Einbauten und Fotos dieses Raums gehen mit.` : ""}`)) return;
  projekt.raeume = raeume().filter(x => x.id !== id);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== id);
  projekt.einbauten = projekt.einbauten.filter(e => e.raumId !== id);
  projekt.fotos = projekt.fotos.filter(f => f.raumId !== id);
  projekt.verbindungen = projekt.verbindungen.filter(v => v.raumA !== id && v.raumB !== id);
  for (const v of projekt.varianten) v.platzhalter = v.platzhalter.filter(p => p.raumId !== id);
  if (projekt.aktiverRaum === id) projekt.aktiverRaum = raeume()[0].id;
  if (zugEntwurf?.raumId === id) zugEntwurf = null;
  auswahl = null; render();
}

function geschossName(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "?";
  return n === 0 ? "EG" : n > 0 ? `${n}. OG` : `${-n}. UG`;
}

function renderRaeume() {
  const panel = $("panelRaeume");
  const geschosse = [...new Set(raeume().map(r => r.geschoss))].sort((a, b) => b - a);
  const g = raum().geschoss;
  const aufEbene = raeume().filter(r => r.geschoss === g);
  panel.innerHTML = `
    <div class="ansicht-wahl">
      <button class="werkzeug ${ansicht === "raum" ? "aktiv" : ""}" data-ansicht="raum" id="ansRaum" title="Rauminnenansicht (Grundriss des aktiven Raums)">Raum</button>
      <button class="werkzeug ${ansicht === "gebaeude" ? "aktiv" : ""}" data-ansicht="gebaeude" id="ansGeb">Gebäude</button>
      <button class="werkzeug ${ansicht === "3d" ? "aktiv" : ""}" data-ansicht="3d" id="ans3d">3D</button>
      <button class="werkzeug ${ansicht === "wolke" ? "aktiv" : ""}" data-ansicht="wolke" id="ansWolke" ${wolkeGeladen ? "" : "disabled"} title="${wolkeGeladen ? "Punktwolke" : "Erst unten eine Wolke laden"}">Wolke</button>
    </div>
    ${geschosse.length > 1 ? `<div class="feld"><label>Geschoss</label><div class="chips">
      ${geschosse.map((n, i) => `<button class="chip ${n === g ? "aktiv" : ""}" data-geschoss="${i}" data-fokus="geschoss-${i}">${esc(geschossName(n))}</button>`).join("")}
    </div></div>` : ""}
    <div class="feld"><label>Räume auf ${esc(geschossName(g))}</label>
      ${aufEbene.map((r, i) => `
        <div class="raum-zeile ${r.id === raum().id ? "aktiv" : ""}" data-i="${i}">
          <button class="raum-wahl" data-fokus="raum-${i}">${esc(r.name)}${r.nummer ? ` · ${esc(r.nummer)}` : ""}</button>
          <span class="raum-flaeche">${komma(G.flaeche(r), 1)} m²</span>
          <button class="weg" data-fokus="raum-weg-${i}" title="Raum löschen" ${raeume().length <= 1 ? "disabled" : ""}>✕</button>
        </div>`).join("")}
    </div>
    <div class="feld"><label>Neuen Raum anlegen an</label>
      <div class="anlegen-knoepfe">
        <button data-seite="LINKS" id="neuLinks">links</button>
        <button data-seite="RECHTS" id="neuRechts">rechts</button>
        <button data-seite="DAVOR" id="neuDavor">davor</button>
        <button data-seite="DAHINTER" id="neuDahinter">dahinter</button>
      </div>
    </div>`;

  panel.querySelectorAll("[data-ansicht]").forEach(b => b.onclick = () => setAnsicht(b.getAttribute("data-ansicht")));
  panel.querySelectorAll("[data-geschoss]").forEach(b => b.onclick = () => {
    const n = geschosse[Number(b.getAttribute("data-geschoss"))];
    const ziel = raeume().find(r => r.geschoss === n);
    if (ziel) { projekt.aktiverRaum = ziel.id; auswahl = null; render(); }
  });
  panel.querySelectorAll(".raum-zeile").forEach(z => {
    const r = aufEbene[Number(z.dataset.i)];
    if (!r) return;
    z.querySelector(".raum-wahl").onclick = () => onRaumSelect(r.id);
    z.querySelector(".weg").onclick = () => raumLoeschen(r.id);
  });
  panel.querySelectorAll("[data-seite]").forEach(b => b.onclick = () => raumAnlegen(b.getAttribute("data-seite")));
}

// ---------------------------------------------------------- Kopfleiste

function renderKopf() {
  const name = $("projektName");
  if (document.activeElement !== name) name.value = projekt.name || "";
  const sel = $("varianteSelect");
  sel.innerHTML = projekt.varianten
    .map((v, i) => `<option value="${i}" ${i === projekt.aktiveVariante ? "selected" : ""}>${esc(v.name)}</option>`)
    .join("");
  $("btnVarianteDel").disabled = projekt.varianten.length <= 1;
  const nur = $("btnReportRaum");
  if (nur) nur.textContent = `Nur „${raum().name || "aktiver Raum"}“`;
}

// -------------------------------------------------------------- Raum

const HERKUNFT_KLASSE = { band: "band", gezielt: "gezielt", getippt: "getippt" };
const METHODE = { zielen: "mit dem Handy gezielt", band: "Maßband / Laser", rechteck: "Rechteck", getippt: "von Hand" };

function herkunftText(w) {
  if (w.quelle === "band") return "Bandmaß";
  if (w.quelle === "gezielt") return `gezielt ± ${Math.max(1, Math.round((Number(w.sigmaM) || 0) * 100))} cm`;
  return "eingegeben";
}

function renderRaum() {
  const r = raum();
  const imZug = !!(r.umriss && String(r.umriss).trim());
  const panel = $("panelRaum");
  const laengen = G.wandLaengen(r);
  const umfang = laengen.reduce((a, b) => a + b, 0);
  const am = r.aufmass;
  panel.innerHTML = `
    <div class="feld"><label for="rName">Name</label><input id="rName" value="${esc(r.name)}"></div>
    <div class="feld-reihe">
      <div class="feld"><label for="rNummer">Raumnummer</label><input id="rNummer" value="${esc(r.nummer)}"></div>
      <div class="feld"><label for="rGeschoss">Geschoss</label><input id="rGeschoss" type="text" inputmode="numeric" autocomplete="off" value="${esc(r.geschoss)}"></div>
      <div class="feld"><label for="rHoehe">Höhe (m)</label>${zahlInput(`id="rHoehe"`, r.hoeheM)}</div>
    </div>

    <div class="aufmass-block">
      <button class="haupt gross" id="rAufnehmen">${am ? "Raum neu aufnehmen" : "Raum aufnehmen"}</button>
      <div class="aufmass-info">
        <b>${komma(G.flaeche(r), 2)} m²</b> · ${laengen.length} Wände · Umfang ${komma(umfang, 2)} m
        <span>${am ? `Aufmaß: ${esc(METHODE[am.methode] || am.methode || "–")}${am.datum ? ` · ${esc(datumKurz(am.datum))}` : ""}` : "Noch nicht aufgenommen – Maße sind Platzhalter."}</span>
      </div>
      <div class="wand-liste">
        <div class="wand-kopf"><span>Nr.</span><span>Länge · Herkunft</span><span>nachmessen</span></div>
        ${waendeMitHerkunft(r).map((w, i) => `
        <div class="wand-zeile">
          <span class="wand-nr">${i + 1}</span>
          <span class="wand-mass"><b>${komma(w.laenge, 2)} m</b><small class="herkunft ${HERKUNFT_KLASSE[w.quelle] || "getippt"}">${esc(herkunftText(w))}</small></span>
          <input class="w-band" data-i="${i}" data-fokus="wand-${i}" type="text" inputmode="decimal" autocomplete="off" placeholder="Bandmaß" aria-label="Wand ${i + 1} mit dem Bandmaß nachmessen (m)">
        </div>`).join("")}
      </div>
      <p class="hint">Wand nachgemessen? Länge eintragen – gemessene Wände bleiben fest, der Rest wird ausgeglichen.</p>
    </div>

    <div class="feld"><label for="rAufbau">Bodenaufbau / Estrich (m)</label>
      ${zahlInput(`id="rAufbau"`, r.aufbauM ?? 0)}
      <span class="unter-hint">Höhe, um die der fertige Boden noch steigt. Einbau-Höhen zählen ab fertigem Boden.</span>
    </div>
    <div class="feld"><label>Form von Hand</label>
      <div class="feld-reihe">
        <button class="klein-knopf ${imZug ? "" : "haupt"}" id="formKurz" title="Rechteck oder Trapez: Breite, Tiefe, Schräge">Rechteck</button>
        <button class="klein-knopf ${imZug ? "haupt" : ""}" id="formZug">Polygonzug</button>
      </div>
    </div>
    ${imZug ? zugEditor(r) : kurzForm(r)}`;

  bind("rName", "change", v => { raum().name = v; renderBald(); });
  bind("rNummer", "change", v => { raum().nummer = v; renderBald(); });
  const gesch = $("rGeschoss");
  gesch.addEventListener("change", () => {
    const n = zahlLesen(gesch.value);
    if (!Number.isInteger(n) || n < -9 || n > 99) { markieren(gesch, "Ganze Zahl: 0 = EG, 1 = 1. OG, −1 = 1. UG"); return; }
    raum().geschoss = n; renderBald();
  });
  zahlBinden($("rHoehe"), { min: 0.5, max: 100 }, n => { raum().hoeheM = n; renderBald(); });
  zahlBinden($("rAufbau"), { min: 0, max: 2, leer: true }, n => { raum().aufbauM = n ?? 0; renderBald(); });
  $("rAufnehmen").onclick = () => raumAufnehmen();
  panel.querySelectorAll(".w-band").forEach(inp =>
    zahlBinden(inp, { min: 0.05, max: 100 }, n => wandNachmessen(Number(inp.dataset.i), n)));
  $("formKurz").onclick = () => {
    if (imZug && confirm("Umriss verwerfen und zur Kurzform (Rechteck/Trapez) wechseln?")) { zugEntwurf = null; masseSetzen({ umriss: "" }); }
  };
  $("formZug").onclick = () => { if (!imZug) { zugEntwurf = null; masseSetzen({ umriss: G.umrissSchreiben(G.ecken(r)) }); } };

  if (imZug) bindZug(); else bindKurz();
}

function kurzForm(r) {
  return `
    <div class="feld-reihe">
      <div class="feld"><label for="rBreite">Breite hinten (m)</label>${zahlInput(`id="rBreite"`, r.breiteM)}</div>
      <div class="feld"><label for="rBreiteV">Breite vorne (m)</label>${zahlInput(`id="rBreiteV"`, r.breiteVorneM, "wie hinten")}</div>
    </div>
    <div class="feld-reihe">
      <div class="feld"><label for="rTiefe">Tiefe (m)</label>${zahlInput(`id="rTiefe"`, r.tiefeM)}</div>
      <div class="feld"><label for="rSchraege">Schräge</label><select id="rSchraege">
        ${[["KEINE", "keine"], ["LINKS", "links"], ["RECHTS", "rechts"], ["BEIDSEITIG", "beidseitig"]]
          .map(([s, t]) => `<option value="${s}" ${r.schraege === s ? "selected" : ""}>${t}</option>`).join("")}
      </select></div>
    </div>`;
}

function bindKurz() {
  zahlBinden($("rBreite"), { min: 0.05, max: 100 }, n => masseSetzen({ breiteM: n }));
  zahlBinden($("rBreiteV"), { min: 0.05, max: 100, leer: true }, n => masseSetzen({ breiteVorneM: n }));
  zahlBinden($("rTiefe"), { min: 0.05, max: 100 }, n => masseSetzen({ tiefeM: n }));
  bind("rSchraege", "change", v => masseSetzen({ schraege: v }));
}

/**
 * Maße von Hand ändern. Wände, deren Länge sich dabei ändert, gelten danach
 * als „eingegeben“ – ihr altes Bandmaß stimmt ja nicht mehr. Eine gezielte
 * Aufnahme wird nicht mehr zum Nachrechnen benutzt (sie passt nicht mehr).
 */
function masseSetzen(patch, r = raum()) {
  const vorher = G.wandLaengen(r);
  Object.assign(r, patch);
  const hinweis = herkunftNachfuehren(r, vorher);
  renderBald();
  if (hinweis) meldung(hinweis);
}

function herkunftNachfuehren(r, vorher) {
  const nachher = G.wandLaengen(r);
  const gleich = nachher.length === vorher.length && nachher.every((l, i) => Math.abs(l - vorher[i]) < 0.005);
  if (gleich) return "";
  if (r.aufmass && Array.isArray(r.aufmass.waende)) {
    const alt = r.aufmass.waende;
    const passt = alt.length === vorher.length && nachher.length === vorher.length;
    r.aufmass.waende = nachher.map((l, i) => (passt && Math.abs(l - vorher[i]) < 0.005 ? alt[i] : { quelle: "getippt", sigmaM: null }));
  }
  if (r.aufnahme && r.aufnahme.methode === "zielen") {
    r.aufnahme = null;
    return "Umriss von Hand geändert – Nachmessen gleicht ab jetzt den Polygonzug aus, statt die Kamera-Aufnahme neu zu rechnen.";
  }
  return "";
}

// ------------------------------------------------------- Polygonzug

/**
 * Der Editor arbeitet auf der Wandliste, die der Nutzer eintippt – nicht auf
 * dem gespeicherten Umriss. Erst wenn der Zug schließt (oder der Nutzer
 * ausdrücklich schließt/ausgleicht), wird der Umriss geschrieben. Ändert sich
 * der Umriss von außen (Aufnahme, Nachmessen, Raumwechsel), beginnt der
 * Entwurf neu aus dem Umriss.
 */
function zugEntwurfHolen(r) {
  if (!zugEntwurf || zugEntwurf.raumId !== r.id || zugEntwurf.stand !== r.umriss) {
    zugEntwurf = {
      raumId: r.id, stand: r.umriss,
      waende: G.waende(G.ecken(r)).map(w => ({ laenge: w.laenge, drehung: w.drehung }))
    };
  }
  return zugEntwurf;
}

/** Wandliste auswerten: Punkte, Restlücke, die eine berechnete Wand, Hinweise. */
function zugAuswerten(waende) {
  const w = waende.map(x => ({ laenge: Number(x.laenge) > 0 ? Number(x.laenge) : null, drehung: Number(x.drehung) || 0 }));
  if (w.length < 3) return { fehlt: "Mindestens drei Wände eintragen." };
  const leer = w.map((x, i) => (x.laenge == null ? i : -1)).filter(i => i >= 0);
  if (leer.length > 1) return { fehlt: `${leer.length} Längen fehlen – höchstens eine darf leer bleiben, sie ergibt sich dann.` };
  let fertig = w, berechnet = null;
  if (leer.length === 1) {
    berechnet = leer[0];
    const start = w.map(x => ({ ...x, laenge: x.laenge ?? 1 }));
    fertig = G.ausgleichen(start, start.map((_, i) => i).filter(i => i !== berechnet)).waende;
  }
  const z = G.zug(fertig);
  const kreuzt = z.geschlossen && G.schneidetSichSelbst(z.punkte);
  return {
    waende: fertig, berechnet, punkte: z.punkte, rest: z.restluecke, schliesst: z.geschlossen, kreuzt,
    hinweise: z.geschlossen ? G.pruefen(z.punkte) : [],
    flaeche: z.geschlossen ? G.flaechePunkte(z.punkte) : null
  };
}

/** Geschlossenen Zug als Umriss in den Raum schreiben. */
function zugSchreiben(r, punkte) {
  const umriss = G.umrissSchreiben(punkte);
  if (umriss === r.umriss) return "";
  const vorher = G.wandLaengen(r);
  r.umriss = umriss;
  r.breiteM = runde(Math.max(...punkte.map(p => p[0])));
  r.tiefeM = runde(Math.max(...punkte.map(p => p[1])));
  r.breiteVorneM = null; r.schraege = "KEINE";
  if (zugEntwurf && zugEntwurf.raumId === r.id) zugEntwurf.stand = r.umriss;
  return herkunftNachfuehren(r, vorher);
}

/** Nach jeder Eingabe im Editor: schließt der Zug, wird er übernommen. */
function zugGeaendert(ent) {
  const r = projekt.raeume.find(x => x.id === ent.raumId);
  if (!r) return;
  const aus = zugAuswerten(ent.waende);
  let hinweis = "";
  if (aus.schliesst && !aus.kreuzt && aus.flaeche >= 0.5) hinweis = zugSchreiben(r, aus.punkte);
  renderBald();
  if (hinweis) meldung(hinweis);
}

function zugEditor(r) {
  const ent = zugEntwurfHolen(r);
  const aus = zugAuswerten(ent.waende);
  const n = ent.waende.length;
  const zeilen = ent.waende.map((w, i) => `
    <div class="zug-zeile">
      <span class="zug-nr">${i + 1}</span>
      <input class="z-laenge" data-i="${i}" data-fokus="zug-l-${i}" type="text" inputmode="decimal" autocomplete="off"
        aria-label="Wand ${i + 1}: Länge in m" value="${w.laenge > 0 ? esc(num(w.laenge)) : ""}"
        placeholder="${aus.berechnet === i && aus.waende ? `= ${komma(aus.waende[i].laenge, 2)}` : "Länge"}">
      <input class="z-dreh" data-i="${i}" data-fokus="zug-d-${i}" type="text" autocomplete="off"
        aria-label="Wand ${i + 1}: Drehung an der Ecke danach in Grad (+ rechts, − links)" value="${esc(winkelText(w.drehung))}">
      <button class="z-knopf ${w.drehung === 90 ? "an" : ""}" data-i="${i}" data-w="90" data-fokus="zug-r-${i}" title="danach rechts abbiegen (+90°)">↱ 90</button>
      <button class="z-knopf ${w.drehung === -90 ? "an" : ""}" data-i="${i}" data-w="-90" data-fokus="zug-li-${i}" title="danach links abbiegen (−90°)">↰ −90</button>
      <button class="weg" data-i="${i}" data-fokus="zug-x-${i}" title="Wand entfernen" ${n <= 3 ? "disabled" : ""}>✕</button>
    </div>`).join("");
  let status;
  if (aus.fehlt) status = `<div class="zug-status offen">${esc(aus.fehlt)}</div>`;
  else if (aus.schliesst) {
    status = `<div class="zug-status ${aus.kreuzt ? "warn" : "ok"}"><b>${aus.kreuzt ? "Schließt, aber nicht übernommen" : "✓ Schließt"}</b> · Restlücke ${Math.round(aus.rest * 1000)} mm · ${komma(aus.flaeche, 2)} m²${aus.berechnet != null ? ` · Wand ${aus.berechnet + 1} ergibt sich zu ${komma(aus.waende[aus.berechnet].laenge, 2)} m` : ""}</div>`
      + (aus.hinweise.length ? `<ul class="zug-hinweise">${aus.hinweise.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : "");
  } else {
    status = `<div class="zug-status offen"><b>Restlücke ${komma(aus.rest * 100, 1)} cm</b> – der Zug schließt nicht. Der Plan zeigt den letzten geschlossenen Stand.</div>
      <div class="zug-aktionen">
        <button class="klein-knopf" id="zugSchluss" title="Die Lücke wird eine eigene, neue Wand">mit Schlusswand schließen</button>
        <button class="klein-knopf" id="zugAusgleich" title="Alle Längen minimal anpassen, bis der Zug schließt">Restlücke ausgleichen</button>
      </div>`;
  }
  return `
    <p class="hint">Je Zeile eine Wand im Uhrzeigersinn: Länge und Drehung an der Ecke danach (+ rechts, − links). Eine Länge darf leer bleiben – sie ergibt sich.</p>
    ${aus.punkte ? zugSkizze(aus.punkte, aus.schliesst) : ""}
    <div class="zug-kopf"><span></span><span>Länge (m)</span><span>Drehung (°)</span></div>
    <div id="zugListe">${zeilen}</div>
    <button class="klein-knopf" id="zugPlus">+ Wand</button>
    ${status}`;
}

/** Kleine Skizze des Zugs – offene Lücke gestrichelt rot. */
function zugSkizze(punkte, geschlossen) {
  const xs = punkte.map(p => p[0]), ys = punkte.map(p => p[1]);
  const w = Math.max(...xs, 0.5), h = Math.max(...ys, 0.5);
  const s = Math.min(240 / w, 110 / h);
  const P = p => `${(12 + p[0] * s).toFixed(1)},${(12 + p[1] * s).toFixed(1)}`;
  const linie = punkte.map(P).join(" ");
  const nrn = punkte.map((a, i) => {
    if (!geschlossen && i === punkte.length - 1) return "";
    const b = punkte[(i + 1) % punkte.length];
    const [x, y] = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).split(",");
    return `<text x="${x}" y="${y}" class="zs-nr">${i + 1}</text>`;
  }).join("");
  const luecke = geschlossen ? "" : `<line x1="${P(punkte[punkte.length - 1]).split(",")[0]}" y1="${P(punkte[punkte.length - 1]).split(",")[1]}" x2="${P(punkte[0]).split(",")[0]}" y2="${P(punkte[0]).split(",")[1]}" class="zs-luecke"/>`;
  return `<svg class="zug-skizze" viewBox="0 0 ${(24 + w * s).toFixed(0)} ${(24 + h * s).toFixed(0)}" aria-hidden="true">
    ${geschlossen ? `<polygon points="${linie}" class="zs-raum"/>` : `<polyline points="${linie}" class="zs-zug"/>`}${luecke}${nrn}</svg>`;
}

function bindZug() {
  const ent = zugEntwurf;
  if (!ent) return;
  document.querySelectorAll("#zugListe .z-laenge").forEach(inp => inp.addEventListener("change", () => {
    const i = Number(inp.dataset.i), t = inp.value.trim();
    if (t === "") { ent.waende[i].laenge = null; zugGeaendert(ent); return; }
    const n = zahlLesen(t);
    if (!(n >= 0.05 && n <= 100)) { markieren(inp, "Länge in m, z. B. 4,12 (0,05 – 100)"); return; }
    ent.waende[i].laenge = n; zugGeaendert(ent);
  }));
  document.querySelectorAll("#zugListe .z-dreh").forEach(inp => inp.addEventListener("change", () => {
    const n = zahlLesen(inp.value);
    if (!(n > -180 && n <= 180)) { markieren(inp, "Winkel in Grad von −179 bis 180 (+ rechts, − links)"); return; }
    ent.waende[Number(inp.dataset.i)].drehung = n; zugGeaendert(ent);
  }));
  document.querySelectorAll("#zugListe .z-knopf").forEach(b => b.onclick = () => {
    ent.waende[Number(b.dataset.i)].drehung = Number(b.dataset.w); zugGeaendert(ent);
  });
  document.querySelectorAll("#zugListe .weg").forEach(b => b.onclick = () => {
    if (ent.waende.length <= 3) return;
    ent.waende.splice(Number(b.dataset.i), 1); zugGeaendert(ent);
  });
  $("zugPlus").onclick = () => { ent.waende.push({ laenge: null, drehung: 90 }); zugGeaendert(ent); };
  const schluss = $("zugSchluss");
  if (schluss) schluss.onclick = () => {
    const aus = zugAuswerten(ent.waende);
    if (!aus.punkte || aus.schliesst) return;
    // Offener Zug: n+1 Punkte – die Lücke vom Ende zum Start wird eine eigene Wand.
    const fehler = G.pruefen(aus.punkte);
    if (G.schneidetSichSelbst(aus.punkte) || G.flaechePunkte(aus.punkte) < 0.5) {
      meldung("Schließen nicht möglich", { hinweise: fehler.length ? fehler : ["Der Zug ergibt keine gültige Fläche."] });
      return;
    }
    const h = zugSchreiben(raum(), aus.punkte);
    zugEntwurf = null; renderBald();
    meldung("Mit Schlusswand geschlossen", { hinweise: [h, ...fehler] });
  };
  const ausgl = $("zugAusgleich");
  if (ausgl) ausgl.onclick = () => {
    const aus = zugAuswerten(ent.waende);
    if (!aus.waende) return;
    const a = G.ausgleichen(aus.waende, []);
    const z = G.zug(a.waende);
    if (!z.geschlossen || G.schneidetSichSelbst(z.punkte) || G.flaechePunkte(z.punkte) < 0.5) {
      meldung("Ausgleichen nicht möglich", { hinweise: [`Es bleiben ${komma(a.restlueckeNachher * 100, 1)} cm – laufen alle Wände parallel, oder ist eine Drehung falsch herum?`] });
      return;
    }
    const h = zugSchreiben(raum(), z.punkte);
    zugEntwurf = null; renderBald();
    meldung(`Restlücke ${komma(a.restlueckeVorher * 100, 1)} cm auf alle Wände verteilt`, { hinweise: [h] });
  };
}

// ---------------------------------------------------------- Öffnungen

const OEFF_ARTEN = [["TUER", "Tür"], ["DURCHGANG", "Durchgang"], ["FENSTER", "Fenster"], ["TOR", "Tor"]];

function renderOeffnungen() {
  const laengen = G.wandLaengen(raum());
  const n = laengen.length;
  const panel = $("panelOeffnungen");
  const liste = oeffnungenAkt();
  panel.innerHTML = liste.map((o, i) => {
    const wi = Number(o.wandIndex ?? 0);
    return `
    <div class="oef-karte" data-i="${i}">
      <div class="oef-kopf">
        <select class="o-art" data-fokus="oef-${i}-art" aria-label="Art der Öffnung ${i + 1}">
          ${OEFF_ARTEN.map(([k, t]) => `<option value="${k}" ${o.art === k ? "selected" : ""}>${t}</option>`).join("")}
          ${OEFF_ARTEN.some(([k]) => k === o.art) ? "" : `<option value="" selected>?</option>`}
        </select>
        <select class="o-wand" data-fokus="oef-${i}-wand" aria-label="Wand der Öffnung ${i + 1}">
          ${Array.from({ length: n }, (_, k) => `<option value="${k}" ${wi === k ? "selected" : ""}>Wand ${k + 1}</option>`).join("")}
          ${wi >= 0 && wi < n ? "" : `<option value="" selected>Wand fehlt</option>`}
        </select>
        <button class="weg" data-fokus="oef-${i}-weg" title="Öffnung entfernen">✕</button>
      </div>
      <div class="oef-masse">
        <label class="mini-feld"><span>Abstand</span>${zahlInput(`class="o-abstand" data-fokus="oef-${i}-abstand" title="ab der Ecke am Wandanfang (m)"`, o.abstandM)}</label>
        <label class="mini-feld"><span>Breite</span>${zahlInput(`class="o-breite" data-fokus="oef-${i}-breite"`, o.breiteM)}</label>
        <label class="mini-feld"><span>Höhe</span>${zahlInput(`class="o-hoehe" data-fokus="oef-${i}-hoehe"`, o.hoeheM)}</label>
        <label class="mini-feld"><span>Brüstung</span>${zahlInput(`class="o-bruestung" data-fokus="oef-${i}-bruestung"`, o.bruestungM ?? 0)}</label>
      </div>
    </div>`;
  }).join("") || `<p class="leer">Keine Öffnungen.</p>`;
  panel.insertAdjacentHTML("beforeend", `
    ${liste.length ? `<p class="hint">Maße in m. Abstand ab der Ecke am Wandanfang (Wandnummern im Plan).</p>` : ""}
    <button class="klein-knopf" id="oefPlus">+ Öffnung</button>`);

  panel.querySelectorAll(".oef-karte").forEach(z => {
    const o = liste[Number(z.dataset.i)];
    if (!o) return;
    z.querySelector(".o-art").onchange = e => {
      if (!e.target.value) return;
      o.art = e.target.value;
      Object.assign(o, Normmasse.oeffnung(o.art));            // Normmaße zur neuen Art
      const L = laengen[Number(o.wandIndex ?? 0)];
      if (L > 0) o.abstandM = runde(Math.max(0, Math.min(Number(o.abstandM) || 0, L - o.breiteM)));
      renderBald();
    };
    z.querySelector(".o-wand").onchange = e => { if (e.target.value !== "") { o.wandIndex = parseInt(e.target.value, 10); renderBald(); } };
    zahlBinden(z.querySelector(".o-abstand"), { min: 0, max: 100 }, v => { o.abstandM = v; renderBald(); });
    zahlBinden(z.querySelector(".o-breite"), { min: 0.05, max: 100 }, v => { o.breiteM = v; renderBald(); });
    zahlBinden(z.querySelector(".o-hoehe"), { min: 0.05, max: 100 }, v => { o.hoeheM = v; renderBald(); });
    zahlBinden(z.querySelector(".o-bruestung"), { min: 0, max: 100 }, v => { o.bruestungM = v; renderBald(); });
    z.querySelector(".weg").onclick = () => { projekt.oeffnungen = projekt.oeffnungen.filter(x => x !== o); render(); };
  });
  $("oefPlus").onclick = () => {
    const m = Normmasse.oeffnung("TUER");
    const L = laengen[0] || 0;
    projekt.oeffnungen.push({
      id: Store.neueId("oef"), raumId: raum().id, art: "TUER", wandIndex: 0,
      abstandM: runde(Math.max(0, (L - m.breiteM) / 2)), ...m
    });
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

  const liste = meine.map((v, i) => {
    const anderer = raeume().find(r => r.id === (v.raumA === akt.id ? v.raumB : v.raumA));
    const gilt = Verbindung.marke(v, raeume());
    return `<div class="vb-zeile" data-i="${i}">
      <span>${v.art === "TUER" ? "Tür" : "Durchgang"} → ${esc(anderer ? anderer.name : "?")}${gilt ? "" : ` <em>(getrennt)</em>`}</span>
      <button class="weg" data-fokus="vb-weg-${i}" title="entfernen">✕</button></div>`;
  }).join("");

  const neu = offen.map((n, i) => `<div class="vb-neu"><span>${esc(n.raum.name)}</span>
    <button class="mini" data-tuer="${i}" data-fokus="vb-tuer-${i}">+ Tür</button>
    <button class="mini" data-durch="${i}" data-fokus="vb-durch-${i}">+ Durchgang</button></div>`).join("");

  panel.innerHTML = (liste || `<p class="leer">Keine Verbindungen von „${esc(akt.name)}“.</p>`)
    + (neu ? `<div class="feld" style="margin-top:8px"><label>Angrenzende Räume</label>${neu}</div>` : "")
    + (!meine.length && !offen.length ? `<p class="hint">Keine angrenzenden Räume – in der Gebäude-Ansicht Räume aneinanderschieben.</p>` : "");

  panel.querySelectorAll(".vb-zeile").forEach(z => {
    const v = meine[Number(z.dataset.i)];
    z.querySelector(".weg").onclick = () => { projekt.verbindungen = projekt.verbindungen.filter(x => x !== v); render(); };
  });
  panel.querySelectorAll("[data-tuer]").forEach(b => b.onclick = () => verbindungAnlegen(offen[Number(b.dataset.tuer)]?.raum.id, "TUER"));
  panel.querySelectorAll("[data-durch]").forEach(b => b.onclick = () => verbindungAnlegen(offen[Number(b.dataset.durch)]?.raum.id, "DURCHGANG"));
}

function verbindungAnlegen(nachbarId, art) {
  if (!nachbarId) return;
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
        <button class="palette-knopf ${paletteWahl === k.schluessel ? "aktiv" : ""}" data-komp="${esc(k.schluessel)}" data-fokus="komp-${esc(k.schluessel)}">
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
    `<button class="chip ${einbauWahl === k ? "aktiv" : ""}" data-ein-art="${esc(k)}" data-fokus="ein-${esc(k)}" title="${esc(label)}">${esc(label)}</button>`).join("");
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
  messKnopf();
  if (ansicht === "3d") {
    const wz = [["drehen", "Umschauen"], ["verschieben", "Räume schieben"], ["begehen", "Begehen"]];
    panel.innerHTML = wz.map(([m, t]) =>
      `<button class="werkzeug ${modus3d === m ? "aktiv" : ""}" data-modus3d="${m}" data-fokus="m3d-${m}">${t}</button>`).join("");
    panel.querySelectorAll("[data-modus3d]").forEach(b =>
      b.onclick = () => { modus3d = b.getAttribute("data-modus3d"); modell3d?.setMode(modus3d); renderWerkzeuge(); renderStatus(); });
    return;
  }
  if (ansicht !== "raum") { panel.innerHTML = ""; return; }   // Gebäude/Wolke: keine Raum-Werkzeuge
  const wz = [["auswahl", "Auswahl"], ["messen-strecke", "Messen ↔"], ["messen-flaeche", "Fläche ▱"]];
  panel.innerHTML = wz.map(([m, t]) =>
    `<button class="werkzeug ${modus === m ? "aktiv" : ""}" data-modus="${m}" data-fokus="modus-${m}">${t}</button>`).join("");
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
    platzieren: `„${wasName}“ platzieren – in den Plan klicken · mit Umschalt (⇧) mehrere setzen · Esc bricht ab`,
    "messen-strecke": "Zwei Punkte klicken – Länge als untere Schranke",
    "messen-flaeche": "Ecken klicken · Klick auf den ersten Punkt, Doppelklick oder „Fläche schließen“ beendet"
  }[modus];
  $("statusZeile").textContent = txt || "";
}

// ------------------------------------------------------------ Prüfung

function renderPruefung() {
  const warn = befunde.filter(b => b.schwere === "WARNUNG");
  const badge = $("pruefBadge");
  if (!platzhalterAkt().length) { badge.className = "badge"; badge.textContent = ""; }
  else if (warn.length) { badge.className = "badge warn"; badge.textContent = `${warn.length} ⚠`; }
  else { badge.className = "badge gut"; badge.textContent = "frei ✓"; }

  const rang = { WARNUNG: 0, HINWEIS: 1, OK: 2 };
  const sortiert = [...befunde].sort((a, b) => rang[a.schwere] - rang[b.schwere]);
  $("panelPruefung").innerHTML = sortiert.length ? sortiert.map(b => `
    <div class="befund ${String(b.schwere).toLowerCase().replace(/[^a-z]/g, "")}">
      <span class="zeichen">${b.schwere === "WARNUNG" ? "⚠" : b.schwere === "HINWEIS" ? "ℹ" : "✓"}</span>
      <span class="txt">${esc(b.text)}<span class="quelle">${esc(b.quelle)} · Regelwerk ${esc(b.regelVersion)}</span></span>
    </div>`).join("")
    : `<p class="leer">Noch keine prüfpflichtigen Geräte in diesem Raum. Wähle links ein Gerät und setze es in den Plan.</p>`;
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
    <div class="insp-zeile"><span>Position</span><span>${esc(num(ph.xM))} / ${esc(num(ph.yM))} m</span></div>
    <div class="insp-zeile"><span>Drehung</span><span>${Math.round(Number(ph.drehungGrad) || 0)}°</span></div>
    <div class="feld"><label for="iBez">Bezeichnung</label><input id="iBez" value="${esc(ph.bezeichnung || "")}" placeholder="z. B. UV Küche"></div>
    <div class="dreh-knoepfe">
      <button id="drehM">↺ 15°</button>
      <button id="dreh90">90°</button>
      <button id="drehP">15° ↻</button>
    </div>
    ${meine.length ? `<div class="befund warnung"><span class="zeichen">⚠</span><span class="txt">${esc(meine[0].text)}</span></div>` : ""}
    <button class="loeschen" id="iDel">Gerät entfernen</button>`;
  bind("iBez", "change", v => { ph.bezeichnung = v; renderBald(); });
  const drehe = d => { ph.drehungGrad = (((Math.round((Number(ph.drehungGrad) || 0) + d)) % 360) + 360) % 360; render(); };
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
    <div class="feld"><label for="eArt">Art</label><select id="eArt">
      ${[...Normmasse.ARTEN].map(([k, v]) => `<option value="${esc(k)}" ${ein.art === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
    </select></div>
    <div class="insp-zeile"><span>Befestigung</span><span>${bef === "WAND" ? `Wand ${(Number(ein.wandIndex) || 0) + 1}` : bef === "DECKE" ? "Decke" : bef === "BODEN" ? "Boden" : "frei"}</span></div>
    <div class="feld"><label for="eHoehe">Höhe über fertigem Boden (m)</label>${zahlInput(`id="eHoehe"`, ein.hoeheM, bef === "DECKE" ? "an der Decke" : "Richtwert")}</div>
    <p class="hint">Ziehen verschiebt den Einbau; Wandgeräte rasten an die nächste Wand.</p>
    <button class="loeschen" id="eDel">Einbau entfernen</button>`;
  $("eArt").onchange = e => {
    ein.art = e.target.value;
    ein.befestigung = Normmasse.befestigung(ein.art);
    ein.hoeheM = Normmasse.hoehe(ein.art);        // Norm-Höhe zur neuen Art
    renderBald();
  };
  zahlBinden($("eHoehe"), { min: 0, max: 100, leer: true }, v => { ein.hoeheM = v; renderBald(); });
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
        <td><a href="#" class="var-wahl" data-fokus="var-${i}">${esc(v.name)}</a></td>
        <td>${v.platzhalter.length}</td>
        <td class="${w ? "warnz" : "gutz"}">${w ? `${w} ⚠` : "✓"}</td>
        <td><button class="mini" data-ren="${i}" data-fokus="var-ren-${i}" title="Variante umbenennen" aria-label="Variante umbenennen">✎</button></td>
      </tr>`;
    }).join("")}
  </table>`;
  panel.querySelectorAll("[data-var]").forEach(tr => {
    const i = parseInt(tr.getAttribute("data-var"), 10);
    tr.querySelector(".var-wahl").onclick = e => { e.preventDefault(); projekt.aktiveVariante = i; auswahl = null; render(); };
  });
  panel.querySelectorAll("[data-ren]").forEach(b => b.onclick = () => {
    const i = parseInt(b.getAttribute("data-ren"), 10);
    const name = prompt("Neuer Name der Variante:", projekt.varianten[i].name);
    if (name) { projekt.varianten[i].name = name; render(); }
  });
}

// ------------------------------------------------------- Kopf-Aktionen

function verdrahteKopf() {
  bind("projektName", "change", v => { projekt.name = v; speichernJetzt(); });
  $("varianteSelect").onchange = e => { projekt.aktiveVariante = parseInt(e.target.value, 10) || 0; auswahl = null; renderBald(); };
  $("btnVarianteNeu").onclick = () => { Store.varianteNeu(projekt); auswahl = null; render(); };
  $("btnVarianteKlon").onclick = () => { Store.varianteKlonen(projekt); auswahl = null; render(); };
  $("btnVarianteDel").onclick = () => {
    if (projekt.varianten.length > 1 && confirm("Aktive Variante löschen?")) {
      Store.varianteLoeschen(projekt, projekt.aktiveVariante); auswahl = null; render();
    }
  };
  // Report: Hauptknopf = alle Räume; das Menü bietet „nur aktiver Raum“.
  $("btnReport").onclick = () => reportOeffnen(false);
  $("btnReportMenue").onclick = e => { e.stopPropagation(); menueUmschalten(); };
  $("btnReportAlle").onclick = () => reportOeffnen(false);
  $("btnReportRaum").onclick = () => reportOeffnen(true);
  document.addEventListener("click", e => { if (!e.target.closest?.(".report-wahl")) menueUmschalten(false); });

  $("btnNeu").onclick = neuesProjekt;
  $("btnReset").onclick = () => {
    if (confirm("Zum Beispielprojekt zurücksetzen? Der aktuelle Stand wird vorher als Sicherung abgelegt.")) {
      const gesichert = vorherSichern();
      projektErsetzen(Store.beispielProjekt());
      meldung("Beispielprojekt geladen.", { aktion: rueckgaengigAngebot(gesichert) });
    }
  };
  $("btnEinpassen").onclick = () => {
    if (ansicht === "raum") plan.einpassen();
    else if (ansicht === "gebaeude") gebaeude.einpassen();
    else if (ansicht === "3d") modell3d?.resize();
    else wolke3d?.resize();
  };
  $("btnAufnehmen").onclick = () => raumAufnehmen();
  $("btnFlaecheZu").onclick = () => { if (plan.messungAbschliessen) plan.messungAbschliessen(); };
  $("btnAR").onclick = arMitKunde;
  $("btnScan").onclick = scanStarten;
  $("btnExport").onclick = exportJson;
  $("bannerExport").onclick = exportJson;
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

function menueUmschalten(an) {
  const m = $("reportMenue"), k = $("btnReportMenue");
  if (!m) return;
  const zeigen = an ?? m.hidden;
  m.hidden = !zeigen;
  k.setAttribute("aria-expanded", String(zeigen));
}

/** Bericht öffnen: alle Räume, oder nur den aktiven. Drucken → PDF macht der Browser bzw. die App. */
function reportOeffnen(nurAktiverRaum) {
  menueUmschalten(false);
  const opts = nurAktiverRaum ? { raumIds: [raum().id] } : {};
  let weg;
  try {
    weg = typeof Report.berichtOeffnen === "function"
      ? Report.berichtOeffnen(projekt, opts)
      : Report.bericht(projekt, Store.aktiveVariante(projekt), befunde, "", { width: 900, height: 560 });
  } catch (e) {
    console.error("RAUMWERK: Report fehlgeschlagen.", e);
    alert("Der Report konnte nicht erstellt werden.");
    return;
  }
  Promise.resolve(weg).then(w => {
    if (w === "datei") meldung("Report als HTML-Datei gespeichert – öffnen und „Drucken / Als PDF speichern“ wählen.");
    else if (w === "fehler") alert("Der Report konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.");
  }, () => alert("Der Report konnte nicht geöffnet werden."));
}

/** Projekt ersetzen (Import, Neu, Zurücksetzen) – Zustand der Oberfläche zurücksetzen. */
function projektErsetzen(neu) {
  projekt = neu; auswahl = null; zugEntwurf = null; palettenLeeren();
  setModus("auswahl"); setAnsicht("raum");
}

function vorherSichern() {
  try { return typeof Store.vorherSichern === "function" && Store.vorherSichern(projekt); }
  catch (_) { return false; /* die Sicherung ist eine Zugabe – ersetzt wird trotzdem nur nach Rückfrage */ }
}

/** „Rückgängig“ nach Import/Neu/Zurücksetzen: die Sicherung zurückholen (wenn es eine gibt). */
function rueckgaengigAngebot(gesichert) {
  if (!gesichert || typeof Store.vorherLaden !== "function") return null;
  return {
    text: "Rückgängig", fn: () => {
      const alt = Store.vorherLaden();
      if (!alt) { alert("Die Sicherung ist nicht mehr lesbar."); return; }
      vorherSichern();
      projektErsetzen(alt);
      meldung(`„${alt.name || "Projekt"}“ wiederhergestellt.`);
    }
  };
}

function neuesProjekt() {
  const name = prompt("Neues, leeres Projekt anlegen. Name:", "Neues Projekt");
  if (name == null) return;
  const gesichert = vorherSichern();
  const titel = name.trim() || "Neues Projekt";
  let neu;
  if (typeof Store.leeresProjekt === "function") neu = Store.leeresProjekt(titel);
  else {   // Rückfall, falls der Store die Funktion (noch) nicht hat
    neu = Store.beispielProjekt();
    const r = neu.raeume[0];
    Object.assign(r, { name: "Raum 1", nummer: "", breiteM: 4, tiefeM: 3, aufbauM: 0, farbe: "#cfe8e9" });
    Object.assign(neu, { name: titel, raeume: [r], aktiverRaum: r.id, oeffnungen: [], einbauten: [], fotos: [], verbindungen: [] });
    neu.varianten = [{ id: Store.neueId("var"), name: "Variante A", platzhalter: [] }];
    neu.aktiveVariante = 0;
  }
  projektErsetzen(neu);
  meldung(`„${titel}“ angelegt.${gesichert ? " Der vorige Stand wurde gesichert." : ""}`,
    { aktion: [{ text: "Ersten Raum aufnehmen", fn: () => raumAufnehmen() }, rueckgaengigAngebot(gesichert)] });
}

/** Projekt als JSON sichern – zum Teilen oder als Backup (kundenlink-tauglich). */
async function exportJson() {
  const name = ((projekt.name || "raumwerk").replace(/[^\wÄÖÜäöüß\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "raumwerk") + ".json";
  const text = JSON.stringify(projekt, null, 2);
  const N = window.__native;
  try {
    const ok = N && typeof N.teilen === "function" ? await N.teilen(name, "application/json", text) : herunterladen(name, text);
    if (!ok) alert("Der Export konnte nicht gespeichert werden.");
  } catch (_) {
    alert("Der Export konnte nicht gespeichert werden.");
  }
}

function herunterladen(name, text) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch (_) { return false; }
}

/**
 * Ein gesichertes Projekt wieder einlesen. Streng: Was kein Projekt ist, wird
 * mit Begründung abgewiesen, und das aktuelle Projekt bleibt unangetastet.
 * Vor dem Ersetzen wird gefragt und der aktuelle Stand gesichert.
 */
function importJson(datei) {
  if (!datei) return;
  const leser = new FileReader();
  leser.onload = () => {
    let roh, neu;
    try { roh = JSON.parse(leser.result); }
    catch (_) { alert(`Import abgebrochen: „${datei.name}“ ist keine lesbare JSON-Datei.\n\nDas aktuelle Projekt bleibt unverändert.`); return; }
    try { neu = strengLesen(roh); }
    catch (e) { alert(`Import abgebrochen: ${e?.message || "Die Datei ist kein gültiges RAUMWERK-Projekt."}\n\nDas aktuelle Projekt bleibt unverändert.`); return; }
    const n = neu.raeume.length;
    if (!confirm(`Projekt „${neu.name || datei.name}“ (${n} ${n === 1 ? "Raum" : "Räume"}) laden?\nDas aktuelle Projekt „${projekt.name || "ohne Namen"}“ wird ersetzt – vorher wird es gesichert.`)) return;
    const gesichert = vorherSichern();
    projektErsetzen(neu);
    meldung(`„${neu.name || datei.name}“ geladen.`, { aktion: rueckgaengigAngebot(gesichert) });
  };
  leser.onerror = () => alert("Die Datei konnte nicht gelesen werden.");
  leser.readAsText(datei);
  $("fileImport").value = "";
}

function strengLesen(o) {
  if (typeof Store.ausObjektStreng === "function") return Store.ausObjektStreng(o);
  // Rückfall ohne strenge Prüfung im Store: das Nötigste selbst prüfen.
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("Die Datei enthält kein RAUMWERK-Projekt.");
  const liste = Array.isArray(o.raeume) ? o.raeume : o.raum ? [o.raum] : [];
  if (!liste.length) throw new Error("Die Datei enthält keine Räume.");
  return Store.ausObjekt(o);
}

// -------------------------------------------------------- Tastatur

window.addEventListener("keydown", e => {
  if (assistentOffen) return;                     // der Assistent hat eigene Tasten
  if (!$("lightbox").hidden && e.key === "Escape") { lightboxSchliessen(); return; }
  if (e.key === "Escape" && !$("reportMenue").hidden) { menueUmschalten(false); return; }
  if (e.target.matches("input, select, textarea")) return;
  const ph = gewaehltPlatzhalter();
  const ein = gewaehltEinbau();
  if (e.key === "Escape") { palettenLeeren(); auswahl = null; setModus("auswahl"); render(); }
  else if ((ph || ein) && (e.key === "Delete" || e.key === "Backspace")) {
    if (e.target.matches("button, a")) return;    // Rücktaste auf einem Knopf löscht nichts
    if (ph) Store.aktiveVariante(projekt).platzhalter = Store.aktiveVariante(projekt).platzhalter.filter(p => p.id !== ph.id);
    else projekt.einbauten = projekt.einbauten.filter(x => x.id !== ein.id);
    auswahl = null; render();
  } else if (ph && (e.key === "r" || e.key === "R")) {
    ph.drehungGrad = (((Number(ph.drehungGrad) || 0) + (e.shiftKey ? -15 : 15)) % 360 + 360) % 360; render();
  }
});

window.addEventListener("resize", () => {
  if (ansicht === "raum") plan.zeichne();
  else if (ansicht === "gebaeude") gebaeude.zeichne();
  else if (ansicht === "3d") modell3d?.resize();
  else wolke3d?.resize();
});

// ------------------------------------------------------- Hilfsfunktionen

function bind(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, e => fn(e.target.value)); }
/** Zahl für ein Eingabefeld: höchstens zwei Stellen, deutsches Komma. */
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "").replace(".", ",") : ""; };
const komma = (v, n = 2) => { const x = Number(v); return Number.isFinite(x) ? x.toFixed(n).replace(".", ",") : "–"; };
const cm = m => `${Math.round(Number(m) * 100)}`;
const runde = v => Math.round(v * 100) / 100;
const winkelText = d => { const n = Number(d) || 0; return String(Math.round(n * 10) / 10).replace(".", ","); };
function datumKurz(iso) { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("de-DE"); }

/** Zahl aus einer Eingabe – Komma oder Punkt, Leerzeichen und „m“ egal; sonst NaN. */
function zahlLesen(t) {
  const s = String(t ?? "").trim().replace(/\s+/g, "").replace(/m$/i, "").replace(",", ".");
  return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
}

/** Zahlenfeld als Textfeld (Komma erlaubt; am Handy Zifferntastatur). */
function zahlInput(attr, wert, platzhalter = "") {
  const v = wert == null || wert === "" ? "" : num(wert);
  return `<input ${attr} type="text" inputmode="decimal" autocomplete="off" value="${esc(v)}"${platzhalter ? ` placeholder="${esc(platzhalter)}"` : ""}>`;
}

/** Feld als ungültig markieren – der alte Wert im Modell bleibt. */
function markieren(el, meldungText) {
  el.classList.add("ungueltig");
  el.setAttribute("aria-invalid", "true");
  el.title = meldungText;
  const weg = () => { el.classList.remove("ungueltig"); el.removeAttribute("aria-invalid"); el.removeEventListener("input", weg); };
  el.addEventListener("input", weg);
}

/**
 * Zahlenfeld verdrahten: nur Plausibles (min…max, in m) wird übernommen;
 * Unsinn markiert das Feld und lässt den gespeicherten Wert stehen.
 * `leer: true` erlaubt ein leeres Feld (→ null).
 */
function zahlBinden(el, { min = 0.05, max = 100, leer = false } = {}, uebernehmenMit) {
  if (!el) return;
  el.addEventListener("change", () => {
    const t = el.value.trim();
    if (t === "") {
      if (leer) { uebernehmenMit(null); return; }
      markieren(el, "Bitte eine Zahl eintragen."); return;
    }
    const n = zahlLesen(t);
    if (!(n >= min && n <= max)) { markieren(el, `Bitte eine Zahl von ${komma(min)} bis ${komma(max, 0)} m (Komma oder Punkt).`); return; }
    uebernehmenMit(n);
  });
}

function speicherLesen(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function speicherSchreiben(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ohne Speicher geht es auch */ } }

// ------------------------------------------------------------- Start

verdrahteKopf();
render();
requestAnimationFrame(() => plan.einpassen());

// Als App installierbar machen (PWA) – die Hülle startet dann auch offline.
// Kommt eine neue Version, bietet die App das Neuladen an.
if ("serviceWorker" in navigator) {
  const hatteSteuerung = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => { /* ohne SW läuft die App normal weiter */ });
  navigator.serviceWorker.addEventListener?.("controllerchange", () => {
    if (hatteSteuerung) meldung("Eine neue Version von RAUMWERK ist geladen.", { aktion: { text: "Neu laden", fn: () => location.reload() } });
  });
}
