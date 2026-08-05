/*
 * RAUMWERK · Mobile-App – Controller.
 *
 * Eine eigenständige, für das Smartphone gebaute Oberfläche. Sie nutzt exakt
 * dieselbe erprobte Fachlogik wie die PC-Ansicht (Store, Geometrie, Normen,
 * Plan-Renderer, 3D, Scan, Sensor-Brücke), präsentiert sie aber als echte App:
 * eine Ansicht zur Zeit, Tab-Leiste unten, Bearbeiten über hochziehbare Sheets.
 */

import * as Store from "../store.js";
import { Plan } from "../plan2d.js";
import { bericht } from "../report.js";
import * as Verbindung from "../verbindung.js";
import * as G from "../../geometrie.js";
import { KATALOG, finde } from "../../komponenten.js";
import * as Normmasse from "../../normmasse.js";
import { pruefe, Schwere } from "../../pruefung.js";
import { anlegen, einrasten, Seite } from "../../platzierung.js";

// --------------------------------------------------------- kleine Helfer
const $ = s => document.querySelector(s);
function el(tag, props, ...kinder) {
  const n = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kinder.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const ARTEN_ARR = [...Normmasse.ARTEN.entries()];
const EINBAU_HAEUFIG = ["STECKDOSE", "STECKDOSE_2FACH", "SCHALTER", "WECHSELSCHALTER",
  "TASTER", "NETZWERKDOSE", "LAMPE", "WANDLEUCHTE", "RAUCHMELDER", "SICHERUNGSKASTEN"];

// --------------------------------------------------------- Zustand
let projekt = Store.laden();
let screen = "raeume";
let auswahl = null;          // { typ:"platzhalter"|"einbau", id }
let werkzeug = "auswahl";    // auswahl | messen-strecke | messen-flaeche | platzieren
let paletteWahl = null;      // Komponenten-Schlüssel (Klötzchen)
let einbauWahl = null;       // Einbau-Art
let plan = null;             // Plan-Instanz (lazy)
let modell3d = null;         // 3D (lazy)
let modus3d = "drehen";

// --------------------------------------------------------- abgeleitete Sichten
const raeume = () => projekt.raeume;
const raum = () => projekt.raeume.find(r => r.id === projekt.aktiverRaum) || projekt.raeume[0];
const platzhalter = () => Store.platzhalter(projekt);
const platzhalterAkt = () => platzhalter().filter(p => p.raumId === raum().id);
const einbautenAkt = () => projekt.einbauten.filter(e => e.raumId === raum().id);
const oeffnungenAkt = () => projekt.oeffnungen.filter(o => o.raumId === raum().id);
const fotosAkt = () => projekt.fotos.filter(f => f.raumId === raum().id);
const tuerOeffnungenAlle = () => projekt.verbindungen.flatMap(v => Verbindung.oeffnungen(v, raeume()));
const tuerOeffnungenRaum = id => tuerOeffnungenAlle().filter(o => o.raumId === id);
const speichern = () => Store.speichern(projekt);

function warnungenFuer(r) {
  const phs = platzhalter().filter(p => p.raumId === r.id);
  return pruefe(r, phs).filter(b => b.schwere === Schwere.WARNUNG).length;
}

// --------------------------------------------------------- Navigation
function zeigeScreen(name) {
  screen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("aktiv", s.dataset.screen === name));
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.toggle("an", b.dataset.ziel === name));
  if (name === "raeume") renderRaeume();
  else if (name === "plan") planZeigen();
  else if (name === "scan") renderScan();
  else if (name === "3d") dreiDZeigen();
  else if (name === "pruefung") renderPruefung();
  kopfAktualisieren();
}

function kopfAktualisieren() {
  $("#kopfRaum").textContent = raum() ? `${raum().name}${raum().nummer ? " · " + raum().nummer : ""}` : "—";
  $("#kopfProjekt").textContent = projekt.name || "RAUMWERK";
}

// =========================================================== RÄUME
function renderRaeume() {
  const wrap = $("#screenRaeume");
  wrap.innerHTML = "";
  wrap.append(el("div", { class: "abschnitt-titel" }, "Gebäude & Räume"));
  for (const r of raeume()) {
    const warn = warnungenFuer(r);
    const geraete = platzhalter().filter(p => p.raumId === r.id).length;
    const aktiv = r.id === raum().id;
    const karte = el("button", { class: "karte raum-karte" + (aktiv ? " raum-karte-aktiv" : ""),
      onclick: () => { projekt.aktiverRaum = r.id; auswahl = null; speichern(); kopfAktualisieren(); raumSheet(r); } },
      el("span", { class: "raum-icon", html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>` }),
      el("span", { class: "raum-haupt" },
        el("b", null, r.name || "Raum"),
        el("span", null, `${r.nummer || "—"} · EG${r.geschoss ? "+" + r.geschoss : ""} · ${G.flaeche(r).toFixed(1)} m²`),
        el("span", { class: "raum-chips" },
          el("span", { class: "chip" }, `${geraete} Geräte`),
          warn ? el("span", { class: "chip warn" }, `${warn} Warnung${warn > 1 ? "en" : ""}`)
               : el("span", { class: "chip ok" }, "norm-frei"))),
      el("span", { class: "raum-pfeil", html: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>` }));
    wrap.append(karte);
  }
  wrap.append(el("button", { class: "knopf zweit", style: "margin-top:6px",
    onclick: () => { projekt.aktiverRaum = raum().id; zeigeScreen("plan"); } }, "Zum Plan des aktiven Raums →"));
}

function raumAnlegen(seite) {
  const basis = raum();
  const neu = {
    id: Store.neueId("raum"), name: `Raum ${raeume().length + 1}`, nummer: "", geschoss: basis ? basis.geschoss : 0,
    breiteM: 3, breiteVorneM: null, tiefeM: 3, schraege: "KEINE", umriss: "",
    hoeheM: basis ? basis.hoeheM : 2.5, aufbauM: basis ? basis.aufbauM : 0, xM: 0, yM: 0, drehungGrad: 0,
    farbe: "#e6d8b5", notiz: ""
  };
  if (basis && seite) Object.assign(neu, anlegen(neu, basis, seite));
  raeume().push(neu);
  projekt.aktiverRaum = neu.id;
  auswahl = null; speichern();
  schliesseSheet();
  renderRaeume(); kopfAktualisieren();
  raumSheet(neu);
}

function fabRaumTippen() {
  if (!raeume().length) { raumAnlegen(null); return; }
  oeffneSheet("Raum anlegen", inhalt => {
    inhalt.append(el("p", { class: "hinweis-text" }, "Wo liegt der neue Raum – bündig an den aktiven angelegt (ohne Schieben)?"));
    const gitter = el("div", { class: "richtung-gitter" });
    for (const [seite, txt] of [[Seite.LINKS, "◀ Links"], [Seite.RECHTS, "Rechts ▶"], [Seite.DAVOR, "▲ Davor"], [Seite.DAHINTER, "▼ Dahinter"]])
      gitter.append(el("button", { class: "richtung-knopf", onclick: () => raumAnlegen(seite) }, txt));
    inhalt.append(gitter);
    inhalt.append(el("button", { class: "knopf zweit", style: "margin-top:12px", onclick: () => raumAnlegen(null) }, "Freistehend anlegen"));
  });
}

// Raum bearbeiten (Sheet)
function raumSheet(r) {
  oeffneSheet(r.name || "Raum", inhalt => {
    const feld = (label, key, attrs = {}) => {
      const inp = el("input", Object.assign({ value: r[key] ?? "", oninput: e => {
        r[key] = attrs.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
        speichern(); kopfAktualisieren(); if (plan) planAktualisieren();
      } }, attrs));
      return el("div", { class: "feld" }, el("label", null, label), inp);
    };
    inhalt.append(feld("Name", "name"));
    inhalt.append(el("div", { class: "feld-reihe" }, feld("Raumnummer", "nummer"), feld("Geschoss", "geschoss", { type: "number", step: "1", inputmode: "numeric" })));
    inhalt.append(el("div", { class: "feld-reihe" },
      feld("Höhe (m)", "hoeheM", { type: "number", step: "0.01", inputmode: "decimal" }),
      feld("Estrich/Aufbau (m)", "aufbauM", { type: "number", step: "0.01", inputmode: "decimal" })));

    // Form: Rechteck / Trapez
    const trapez = r.breiteVorneM != null && r.breiteVorneM !== "";
    const formSeg = el("div", { class: "segmente", style: "margin-bottom:12px" },
      el("button", { class: !trapez ? "an" : "", onclick: () => { r.breiteVorneM = null; speichern(); planAktualisieren(); raumSheetNeu(r); } }, "Rechteck"),
      el("button", { class: trapez ? "an" : "", onclick: () => { r.breiteVorneM = Number(r.breiteM) || 3; speichern(); planAktualisieren(); raumSheetNeu(r); } }, "Trapez"));
    inhalt.append(el("div", { class: "feld" }, el("label", null, "Form"), formSeg));

    inhalt.append(el("div", { class: "feld-reihe" },
      feld(trapez ? "Breite hinten (m)" : "Breite (m)", "breiteM", { type: "number", step: "0.01", inputmode: "decimal" }),
      feld("Tiefe (m)", "tiefeM", { type: "number", step: "0.01", inputmode: "decimal" })));
    if (trapez) inhalt.append(feld("Breite vorne (m)", "breiteVorneM", { type: "number", step: "0.01", inputmode: "decimal" }));

    inhalt.append(el("button", { class: "knopf prim", style: "margin-top:8px",
      onclick: () => { schliesseSheet(); zeigeScreen("plan"); } }, "Im Plan bearbeiten"));
    if (raeume().length > 1)
      inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: () => raumLoeschen(r) }, "Raum löschen"));
  });
}
function raumSheetNeu(r) { schliesseSheet(); raumSheet(r); }
function raumLoeschen(r) {
  if (!confirm(`Raum „${r.name}" löschen?`)) return;
  projekt.raeume = raeume().filter(x => x.id !== r.id);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== r.id);
  projekt.einbauten = projekt.einbauten.filter(e => e.raumId !== r.id);
  projekt.fotos = projekt.fotos.filter(f => f.raumId !== r.id);
  for (const v of projekt.varianten) v.platzhalter = v.platzhalter.filter(p => p.raumId !== r.id);
  if (projekt.aktiverRaum === r.id) projekt.aktiverRaum = raeume()[0]?.id;
  speichern(); schliesseSheet(); renderRaeume(); kopfAktualisieren();
}

// =========================================================== PLAN
function planInit() {
  if (plan) return;
  plan = new Plan($("#planSvg"), {
    onSelect: id => { auswahl = id ? { typ: "platzhalter", id } : null; planAktualisieren(); if (id) inspektorSheet(); },
    onEinbauSelect: id => { auswahl = { typ: "einbau", id }; planAktualisieren(); inspektorSheet(); },
    onPlace: (x, y) => onPlace(x, y),
    onPlatzhalterMove: (id, patch) => { const ph = platzhalter().find(p => p.id === id); if (ph) { Object.assign(ph, patch); speichern(); planAktualisieren(); } },
    onEinbauMove: (id, patch) => { const e = projekt.einbauten.find(x => x.id === id); if (e) { Object.assign(e, patch); speichern(); planAktualisieren(); } },
    onMessung: e => toast(e.art === "strecke" ? `Strecke: mind. ${e.laengeM.toFixed(2)} m`
      : `Fläche: ${e.flaecheM2.toFixed(2)} m² · Umfang ${e.umfangM.toFixed(2)} m`),
    onFotoMove: (id, patch) => { const f = projekt.fotos.find(x => x.id === id); if (f) { Object.assign(f, patch); speichern(); } },
    onFotoOeffnen: () => {}
  });
}
function planZeigen() {
  planInit();
  requestAnimationFrame(() => { plan.einpassen(); planAktualisieren(); });
}
function planAktualisieren() {
  if (!plan) return;
  const befunde = pruefe(raum(), platzhalterAkt());
  plan.setModell({
    raum: raum(),
    oeffnungen: oeffnungenAkt().concat(tuerOeffnungenRaum(raum().id)),
    einbauten: einbautenAkt(),
    platzhalter: platzhalterAkt(),
    fotos: fotosAkt(),
    befunde,
    auswahl
  }).zeichne();
}

function onPlace(x, y) {
  if (einbauWahl) {
    const art = einbauWahl;
    const e = { id: Store.neueId("ein"), raumId: raum().id, art, befestigung: Normmasse.befestigung(art), hoeheM: Normmasse.hoehe(art), relX: 0.5, relY: 0.5 };
    Object.assign(e, plan.einrastEinbauVorschlag(e, x, y));
    projekt.einbauten.push(e);
    auswahl = { typ: "einbau", id: e.id };
  } else if (paletteWahl) {
    const ph = { id: Store.neueId("ph"), raumId: raum().id, komponente: paletteWahl, xM: x, yM: y, drehungGrad: 0, bezeichnung: "" };
    Object.assign(ph, plan.einrastVorschlag(ph, x, y));
    platzhalter().push(ph);
    auswahl = { typ: "platzhalter", id: ph.id };
  } else return;
  paletteWahl = einbauWahl = null;
  setWerkzeug("auswahl");
  speichern(); planAktualisieren(); inspektorSheet();
}

function setWerkzeug(m) {
  werkzeug = m;
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.classList.toggle("an", b.dataset.modus === m));
  if (plan) plan.setModus(m);
}

// Palette-Sheet (Klötzchen + Einbauten)
function paletteSheet() {
  oeffneSheet("Setzen", inhalt => {
    let tab = "einbau";
    const tabs = el("div", { class: "palette-tabs" },
      el("button", { class: "an", onclick: () => wechsel("einbau") }, "Installation"),
      el("button", { onclick: () => wechsel("klotz") }, "Geräte / Möbel"));
    const gitter = el("div", { class: "palette-gitter" });
    inhalt.append(tabs, gitter);
    function wechsel(t) { tab = t; tabs.children[0].classList.toggle("an", t === "einbau"); tabs.children[1].classList.toggle("an", t === "klotz"); male(); }
    function male() {
      gitter.innerHTML = "";
      if (tab === "einbau") {
        for (const art of EINBAU_HAEUFIG) gitter.append(el("button", { class: "palette-knopf",
          onclick: () => { einbauWahl = art; paletteWahl = null; setWerkzeug("platzieren"); schliesseSheet(); toast("In den Plan tippen zum Setzen"); } },
          el("b", null, Normmasse.ARTEN.get(art) || art), el("small", null, hoeheText(art))));
      } else {
        for (const k of KATALOG) gitter.append(el("button", { class: "palette-knopf",
          onclick: () => { paletteWahl = k.schluessel; einbauWahl = null; setWerkzeug("platzieren"); schliesseSheet(); toast("In den Plan tippen zum Setzen"); } },
          el("b", null, k.name), el("small", null, `${k.breiteM}×${k.tiefeM} m`)));
      }
    }
    male();
  });
}
function hoeheText(art) { const h = Normmasse.hoehe(art); return h == null ? "an der Decke" : `${Math.round(h * 100)} cm`; }

// Inspektor-Sheet (Auswahl bearbeiten)
function inspektorSheet() {
  if (!auswahl) return;
  if (auswahl.typ === "einbau") {
    const e = projekt.einbauten.find(x => x.id === auswahl.id); if (!e) return;
    oeffneSheet(Normmasse.ARTEN.get(e.art) || e.art, inhalt => {
      const hAkt = e.hoeheM != null && e.hoeheM !== "" ? Number(e.hoeheM) : (Normmasse.hoehe(e.art) ?? Number(raum().hoeheM));
      const wert = el("b", null, `${Math.round(hAkt * 100)} cm`);
      const range = el("input", { type: "range", min: "0", max: String(Number(raum().hoeheM) || 3), step: "0.01", value: String(hAkt), style: "width:100%",
        oninput: ev => { e.hoeheM = Math.round(Number(ev.target.value) * 100) / 100; wert.textContent = `${Math.round(e.hoeheM * 100)} cm`; speichern(); planAktualisieren(); } });
      inhalt.append(el("div", { class: "feld" }, el("label", null, "Höhe über fertigem Boden ", wert), range));
      inhalt.append(el("p", { class: "hinweis-text" }, `Befestigung: ${e.befestigung || Normmasse.befestigung(e.art)}`));
      inhalt.append(loeschKnopf(() => { projekt.einbauten = projekt.einbauten.filter(x => x.id !== e.id); nachLoeschen(); }));
    });
  } else {
    const ph = platzhalter().find(p => p.id === auswahl.id); if (!ph) return;
    const komp = finde(ph.komponente);
    oeffneSheet(komp ? komp.name : "Gerät", inhalt => {
      inhalt.append(el("div", { class: "feld" }, el("label", null, "Bezeichnung"),
        el("input", { value: ph.bezeichnung || "", placeholder: "optional", oninput: e => { ph.bezeichnung = e.target.value; speichern(); planAktualisieren(); } })));
      inhalt.append(el("button", { class: "knopf zweit", onclick: () => { ph.drehungGrad = ((Number(ph.drehungGrad) || 0) + 90) % 360; speichern(); planAktualisieren(); } },
        `Drehen (${Number(ph.drehungGrad) || 0}°)`));
      if (komp) inhalt.append(el("p", { class: "hinweis-text" }, `Maße: ${komp.breiteM} × ${komp.tiefeM} m · ${komp.kategorie}`));
      inhalt.append(loeschKnopf(() => { const arr = platzhalter(); const i = arr.findIndex(p => p.id === ph.id); if (i >= 0) arr.splice(i, 1); nachLoeschen(); }));
    });
  }
}
function loeschKnopf(fn) { return el("button", { class: "knopf gefahr", style: "margin-top:12px", onclick: fn }, "Löschen"); }
function nachLoeschen() { auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); }

// =========================================================== SCAN
function renderScan() {
  const wrap = $("#screenScan");
  wrap.innerHTML = "";
  wrap.append(el("div", { class: "abschnitt-titel" }, "Raumaufnahme"));
  const info = window.__native && window.__native.geraete ? window.__native.geraete() : null;
  const karte = el("div", { class: "karte" });
  karte.append(el("p", { class: "hinweis-text", style: "margin-top:0" },
    "Referenzwürfel in den Raum stellen, dem Pfeil folgen – die App nimmt aus allen Richtungen auf und verschlagwortet jede Aufnahme mit Lage und Ort (für die Photogrammetrie)."));
  if (info) karte.append(el("p", { class: "hinweis-text" },
    `Gerät: ${info.hersteller || ""} ${info.modell || ""} · ${(info.kameras || []).length} Kameras${(info.kameras || []).some(k => k.mono) ? " · Mono/IR erkannt" : ""}`));
  karte.append(el("button", { class: "knopf prim", onclick: scanStarten }, "Scan starten"));
  wrap.append(karte);

  const scans = projekt.scans || [];
  if (scans.length) {
    wrap.append(el("div", { class: "abschnitt-titel" }, `Aufnahmen (${scans.length})`));
    const liste = el("div", { class: "karte", style: "padding:0" });
    scans.slice().reverse().forEach(s => liste.append(el("div", { class: "befund" },
      el("div", { class: "befund-punkt ok", html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>` }),
      el("div", { class: "befund-text" },
        el("b", null, `${s.anzahl} Bilder · ${s.abgedeckteSektoren || 0}/${s.sektoren || 12} Sektoren`),
        el("span", null, `${new Date(s.erstellt).toLocaleString("de-DE")} · Würfel ${Math.round((s.wuerfelKanteM || 0) * 100)} cm`)))));
    wrap.append(liste);
  }
}
async function scanStarten() {
  try {
    const mod = await import("../scan.js");
    await mod.starteScan({
      raum: raum(),
      speichern: m => { projekt.scans = projekt.scans || []; projekt.scans.push(m); speichern(); },
      onEnde: () => renderScan()
    });
  } catch (_) { toast("Scan nicht möglich (Kamera nötig)"); }
}

// =========================================================== 3D
function raeumeFuer3d() {
  return raeume().map(r => ({
    id: r.id, name: r.name, number: r.nummer, floor: r.geschoss,
    corners: G.ecken(r), posX: Number(r.xM) || 0, posY: Number(r.yM) || 0,
    rotationDeg: Number(r.drehungGrad) || 0, heightM: Number(r.hoeheM) || 2.5, color: r.farbe,
    openings: projekt.oeffnungen.filter(o => o.raumId === r.id).concat(tuerOeffnungenRaum(r.id)).map(o => ({
      wallIndex: o.wandIndex ?? 0, offsetM: Number(o.abstandM) || 0, widthM: Number(o.breiteM) || 0,
      sillM: Number(o.bruestungM) || 0, heightM: Number(o.hoeheM) || 0 })),
    fixtures: projekt.einbauten.filter(e => e.raumId === r.id).map(e => ({
      id: e.id, roomId: r.id, type: e.art, mount: e.befestigung || Normmasse.befestigung(e.art),
      wallIndex: e.wandIndex ?? 0, offsetM: Number(e.abstandM) || 0,
      heightM: e.hoeheM != null ? Number(e.hoeheM) : null, relX: Number(e.relX ?? 0.5), relY: Number(e.relY ?? 0.5) }))
  }));
}
async function dreiDZeigen() {
  const container = $("#dreidFlaeche");
  if (!modell3d) {
    try {
      const mod = await import("../../modell3d.js");
      modell3d = mod.createModel(container, {
        onSelect: d => { if (d) { projekt.aktiverRaum = d.id; speichern(); kopfAktualisieren(); } },
        onMoved: d => { const r = raeume().find(x => x.id === d.id); if (r) { r.xM = d.posX; r.yM = d.posY; speichern(); } },
        snap: (mr, nx, ny) => { const r = raeume().find(x => x.id === mr.id); return r ? einrasten(r, nx, ny, raeume()) : [nx, ny]; }
      });
    } catch (_) { container.innerHTML = `<div class="dreid-fehler">3D-Ansicht nicht ladbar.</div>`; return; }
  }
  modell3d.setRooms(raeumeFuer3d());
  modell3d.setMode(modus3d);
  requestAnimationFrame(() => modell3d.resize());
}

// =========================================================== PRÜFUNG
function renderPruefung() {
  const wrap = $("#screenPruefung");
  wrap.innerHTML = "";
  wrap.append(el("div", { class: "abschnitt-titel" }, `Normprüfung · ${raum().name}`));
  const befunde = pruefe(raum(), platzhalterAkt());
  const warn = befunde.filter(b => b.schwere === Schwere.WARNUNG).length;
  wrap.append(el("div", { class: "banner " + (warn ? "schlecht" : "gut") },
    el("b", null, warn ? String(warn) : "✓"),
    el("span", null, warn ? `Warnung${warn > 1 ? "en" : ""} – Freiräume prüfen` : "Alle geprüften Freiräume eingehalten")));
  if (!befunde.length) {
    wrap.append(el("div", { class: "karte leer", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/></svg><div>Noch keine prüfbaren Geräte im Raum.<br>Setze im Plan ein Klötzchen.</div>` }));
    return;
  }
  const liste = el("div", { class: "karte", style: "padding:0" });
  for (const b of befunde) {
    const kl = b.schwere === Schwere.WARNUNG ? "warn" : b.schwere === Schwere.HINWEIS ? "hinweis" : "ok";
    const sym = b.schwere === Schwere.WARNUNG ? "!" : b.schwere === Schwere.HINWEIS ? "i" : "✓";
    const quelle = [b.quelle, b.regelVersion ? "Regelwerk " + b.regelVersion : null].filter(Boolean).join(" · ");
    liste.append(el("div", { class: "befund" },
      el("div", { class: "befund-punkt " + kl }, sym),
      el("div", { class: "befund-text" }, el("b", null, b.text || "Prüfung"),
        quelle ? el("span", null, quelle) : null)));
  }
  wrap.append(liste);
}

// =========================================================== Menü
function menueSheet() {
  oeffneSheet("Projekt", inhalt => {
    const eintrag = (icon, txt, fn, klasse = "") => el("button", { class: "liste-eintrag " + klasse, onclick: fn },
      el("span", { html: icon }), el("span", null, txt));
    inhalt.append(
      eintrag(ICON.pdf, "Report als PDF", reportErzeugen),
      eintrag(ICON.export, "Projekt exportieren (JSON)", exportieren),
      eintrag(ICON.import, "Projekt importieren", importieren),
      eintrag(ICON.variante, `Variante: ${Store.aktiveVariante(projekt).name}`, variantenSheet),
      eintrag(ICON.reset, "Auf Beispiel zurücksetzen", zuruecksetzen, "gefahr"));
  });
}
function variantenSheet() {
  oeffneSheet("Varianten", inhalt => {
    projekt.varianten.forEach((v, i) => inhalt.append(el("button", { class: "liste-eintrag" + (i === projekt.aktiveVariante ? " aktiv" : ""),
      onclick: () => { projekt.aktiveVariante = i; auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); kopfAktualisieren(); } },
      el("span", { html: ICON.variante }), el("span", null, v.name))));
    inhalt.append(el("div", { class: "knopf-reihe", style: "margin-top:14px" },
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteKlonen(projekt); speichern(); schliesseSheet(); variantenSheet(); } }, "Duplizieren"),
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteNeu(projekt); speichern(); schliesseSheet(); variantenSheet(); } }, "Neu (leer)")));
    if (projekt.varianten.length > 1)
      inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px",
        onclick: () => { Store.varianteLoeschen(projekt, projekt.aktiveVariante); speichern(); schliesseSheet(); variantenSheet(); planAktualisieren(); } }, "Aktive Variante löschen"));
  });
}
function reportErzeugen() {
  schliesseSheet();
  zeigeScreen("plan");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    plan.einpassen();
    const r = $("#planSvg").getBoundingClientRect();
    bericht(projekt, Store.aktiveVariante(projekt), pruefe(raum(), platzhalterAkt()), $("#planSvg").innerHTML,
      { width: Math.round(r.width) || 900, height: Math.round(r.height) || 560 });
  }));
}
function exportieren() {
  const blob = new Blob([JSON.stringify(projekt, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: (projekt.name || "raumwerk").replace(/\s+/g, "_") + ".json" });
  document.body.append(a); a.click(); a.remove(); schliesseSheet();
}
function importieren() {
  const inp = el("input", { type: "file", accept: "application/json,.json", style: "display:none",
    onchange: e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
      r.onload = () => { try { projekt = Store.ausObjekt(JSON.parse(r.result)); auswahl = null; speichern(); schliesseSheet(); zeigeScreen("raeume"); } catch (_) { toast("Datei nicht lesbar"); } };
      r.readAsText(f); } });
  document.body.append(inp); inp.click(); inp.remove();
}
function zuruecksetzen() {
  if (!confirm("Auf das Beispielprojekt zurücksetzen? Der aktuelle Stand geht verloren.")) return;
  projekt = Store.beispielProjekt(); auswahl = null; paletteWahl = einbauWahl = null;
  speichern(); schliesseSheet(); zeigeScreen("raeume");
}

// =========================================================== AR
async function arStarten() {
  try {
    const mod = await import("../ar.js");
    await mod.starte({
      raum: raum(), platzhalter: platzhalterAkt(), einbauten: einbautenAkt(),
      findeKomponente: finde, neueId: Store.neueId,
      einbauHinzufuegen: e => projekt.einbauten.push(e),
      onAenderung: () => { speichern(); planAktualisieren(); },
      onEnde: () => planAktualisieren()
    });
  } catch (_) { toast("AR nicht möglich (Kamera/WebGL nötig)"); }
}

// =========================================================== Sheet-Mechanik
let sheetEls = null;
function oeffneSheet(titel, bauInhalt) {
  schliesseSheet();
  const backdrop = el("div", { class: "backdrop", onclick: schliesseSheet });
  const inhalt = el("div", { class: "sheet-inhalt" });
  const sheet = el("div", { class: "sheet" },
    el("div", { class: "sheet-griff" }),
    el("div", { class: "sheet-kopf" }, el("h3", null, titel),
      el("button", { class: "sheet-zu", onclick: schliesseSheet, html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>` })),
    inhalt);
  document.body.append(backdrop, sheet);
  bauInhalt(inhalt);
  requestAnimationFrame(() => { backdrop.classList.add("zeig"); sheet.classList.add("zeig"); });
  sheetEls = { backdrop, sheet };
}
function schliesseSheet() {
  if (!sheetEls) return;
  const { backdrop, sheet } = sheetEls; sheetEls = null;
  backdrop.classList.remove("zeig"); sheet.classList.remove("zeig");
  setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
}

// =========================================================== Toast
let toastT = 0;
function toast(txt) {
  const t = $("#planToast");
  if (!t) return;
  t.textContent = txt; t.classList.add("zeig");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("zeig"), 2200);
}

// =========================================================== Icons
const ICON = {
  pdf: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  export: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`,
  import: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`,
  variante: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V9"/></svg>`,
  reset: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`
};

// =========================================================== Start
function verdrahten() {
  document.querySelectorAll("#tabbar button").forEach(b => b.onclick = () => zeigeScreen(b.dataset.ziel));
  $("#btnMenue").onclick = menueSheet;
  $("#kopfTitel").onclick = () => zeigeScreen("raeume");
  $("#fabRaum").onclick = fabRaumTippen;
  $("#fabPalette").onclick = paletteSheet;
  $("#planEinpassen").onclick = () => { if (plan) plan.einpassen(); };
  $("#planAR").onclick = arStarten;
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.onclick = () => setWerkzeug(b.dataset.modus));
  document.querySelectorAll("#dreidModus button").forEach(b => b.onclick = () => {
    modus3d = b.dataset.modus;
    document.querySelectorAll("#dreidModus button").forEach(x => x.classList.toggle("an", x === b));
    if (modell3d) modell3d.setMode(modus3d);
  });
  window.addEventListener("resize", () => { if (screen === "plan" && plan) plan.einpassen(); if (screen === "3d" && modell3d) modell3d.resize(); });
}

verdrahten();
kopfAktualisieren();
renderRaeume();
