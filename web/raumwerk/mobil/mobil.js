/*
 * RAUMWERK · App – Controller (Designrichtung „Ziegelwerk", Konzept v2 §6).
 *
 * Eigenständige Feld-Oberfläche für Android. Navigation ist das **Seitenmenü
 * (Drawer)** über die Bereiche Projekte · Plan · Scan · AR-Planung · 3D ·
 * Normprüfung · Doku. Die Fachlogik ist dieselbe wie in der Web-Workstation
 * (Store, Geometrie, Normen, Plan, 3D, Scan, Sensorik) – nur die Gestaltung
 * ist bewusst getrennt.
 *
 * Aus dem Konzept übernommen:
 *  · §10 Höhenbezug umschaltbar: Rohboden ⇄ Fertigfußboden (Estrich/Belag).
 *  · §13 Normprüfung als Kern, nicht als Beiwerk.
 *  · Offline-first: alles lokal, der Zustand wird sofort gespeichert.
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

// --------------------------------------------------------- Helfer
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
const EINBAU_HAEUFIG = ["STECKDOSE", "STECKDOSE_2FACH", "SCHALTER", "WECHSELSCHALTER",
  "TASTER", "NETZWERKDOSE", "LAMPE", "WANDLEUCHTE", "RAUCHMELDER", "SICHERUNGSKASTEN"];
/** Kurzglyphe für die Palette – zwei Zeichen im Mono-Kreis. */
const GLYPH = {
  STECKDOSE: "SD", STECKDOSE_2FACH: "S2", STECKDOSE_3FACH: "S3", STECKDOSE_CEE: "CE",
  SCHALTER: "SC", WECHSELSCHALTER: "WS", KREUZSCHALTER: "KS", TASTER: "TA", DIMMER: "DI",
  BEWEGUNGSMELDER: "BM", LAMPE: "LA", WANDLEUCHTE: "WL", NOTLEUCHTE: "NL",
  NETZWERKDOSE: "NW", ANTENNENDOSE: "AN", TELEFONDOSE: "TE", RAUCHMELDER: "RM",
  SICHERUNGSKASTEN: "UV", KLIMA: "KL", HEIZKOERPER: "HK", THERMOSTAT: "TH"
};
const glyph = a => GLYPH[a] || String(a).slice(0, 2).toUpperCase();

// --------------------------------------------------------- Zustand
let projekt = Store.laden();
let screen = "projekte";
let auswahl = null;
let werkzeug = "auswahl";
let paletteWahl = null, einbauWahl = null;
let plan = null, modell3d = null, modus3d = "drehen";
/** Höhenbezug (Konzept §10): "ffb" = ab Fertigfußboden, "roh" = ab Rohboden. */
let bezug = localStorage.getItem("raumwerk.bezug") || "ffb";

const raeume = () => projekt.raeume;
const raum = () => projekt.raeume.find(r => r.id === projekt.aktiverRaum) || projekt.raeume[0];
const platzhalter = () => Store.platzhalter(projekt);
const platzhalterAkt = () => platzhalter().filter(p => p.raumId === raum().id);
const einbautenAkt = () => projekt.einbauten.filter(e => e.raumId === raum().id);
const oeffnungenAkt = () => projekt.oeffnungen.filter(o => o.raumId === raum().id);
const fotosAkt = () => projekt.fotos.filter(f => f.raumId === raum().id);
const tuerOeffnungenRaum = id => projekt.verbindungen
  .flatMap(v => Verbindung.oeffnungen(v, raeume())).filter(o => o.raumId === id);
const speichern = () => Store.speichern(projekt);
const aufbau = r => Number((r || raum()).aufbauM) || 0;
const warnungenFuer = r => pruefe(r, platzhalter().filter(p => p.raumId === r.id))
  .filter(b => b.schwere === Schwere.WARNUNG).length;

/** Eingebaute Höhe → Anzeige im gewählten Bezug. */
function hoeheRoh(e) {
  if (e.hoeheM != null && e.hoeheM !== "") return Number(e.hoeheM);
  const bef = e.befestigung || Normmasse.befestigung(e.art);
  if (bef === "DECKE") return Number(raum().hoeheM) || 2.5;
  if (bef === "BODEN") return 0;
  const h = Normmasse.hoehe(e.art);
  return h == null ? (Number(raum().hoeheM) || 2.5) : h;
}
const hoeheAnzeige = e => hoeheRoh(e) + (bezug === "roh" ? aufbau() : 0);
const bezugWort = () => bezug === "roh" ? "ab Rohboden" : "ab Fertigfußboden";

// --------------------------------------------------------- Navigation
const BEREICHE = [
  { id: "projekte", name: "Projekte", sub: "Objekte, Räume, Varianten", krume: "RAUMWERK · FELD",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>` },
  { id: "plan", name: "Plan", sub: "Grundriss, Elemente, Messen",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/></svg>` },
  { id: "scan", name: "Scan", sub: "Video-Schwenk oder Einzelfotos",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><circle cx="12" cy="12" r="3"/></svg>` },
  { id: "ar", name: "AR-Planung", sub: "Vor Ort mit dem Kunden",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>` },
  { id: "3d", name: "3D-Modell", sub: "Raum-Abbild begehen",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 12 21 7M12 12v10M12 12 3 7"/></svg>` },
  { id: "pruefung", name: "Normprüfung", sub: "VDE/DIN · Kern-USP",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>` },
  { id: "doku", name: "Doku", sub: "Fotos, Baufortschritt",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 15 5-4 4 3 3-2 6 4"/><circle cx="9" cy="9.5" r="1.4"/></svg>` }
];

function zeigeScreen(name) {
  screen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("aktiv", s.dataset.screen === name));
  const b = BEREICHE.find(x => x.id === name) || BEREICHE[0];
  $("#kopfKrume").textContent = b.krume || `${raum() ? raum().name : ""} · ${raum() ? G.flaeche(raum()).toFixed(1) : "0"} m²`;
  $("#kopfName").textContent = b.name;
  if (name === "projekte") renderProjekte();
  else if (name === "plan") planZeigen();
  else if (name === "scan") renderScan();
  else if (name === "ar") renderAr();
  else if (name === "3d") dreiDZeigen();
  else if (name === "pruefung") renderPruefung();
  else if (name === "doku") renderDoku();
}

// --------------------------------------------------------- Drawer
let drawerEls = null;
function oeffneDrawer() {
  if (drawerEls) return;
  const schleier = el("div", { class: "drawer-schleier", onclick: schliesseDrawer });
  const liste = el("div", { class: "drawer-liste" });
  for (const b of BEREICHE) {
    const offen = b.id === "pruefung" ? warnungenFuer(raum()) : 0;
    liste.append(el("button", { class: "drawer-eintrag" + (b.id === screen ? " an" : ""),
      onclick: () => { schliesseDrawer(); zeigeScreen(b.id); } },
      el("span", { html: b.icon }),
      el("span", { class: "de-haupt" }, el("b", null, b.name), el("span", null, b.sub)),
      offen ? el("span", { class: "drawer-marke" }, String(offen)) : null));
  }
  const dunkel = document.documentElement.getAttribute("data-thema") === "dunkel";
  const schalter = el("span", { class: "schalter" + (dunkel ? " an" : "") }, el("i"));
  const drawer = el("div", { class: "drawer" },
    el("div", { class: "drawer-kopf" }, el("b", null, "RAUMWERK"),
      el("span", null, "FELD · OFFLINE-FIRST · v0.3")),
    liste,
    el("div", { class: "drawer-fuss" },
      el("button", { class: "schalter-zeile", onclick: () => {
        const an = document.documentElement.getAttribute("data-thema") !== "dunkel";
        document.documentElement.setAttribute("data-thema", an ? "dunkel" : "hell");
        try { localStorage.setItem("raumwerk.thema", an ? "dunkel" : "hell"); } catch (_) {}
        schalter.classList.toggle("an", an);
        if (plan) planAktualisieren();
      } }, schalter, el("span", null, "Dark Mode (Baustelle)")),
      el("button", { class: "schalter-zeile", onclick: () => { schliesseDrawer(); menueSheet(); },
        html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span>Projekt · Report, Export, Varianten</span>` })));
  document.body.append(schleier, drawer);
  requestAnimationFrame(() => { schleier.classList.add("zeig"); drawer.classList.add("zeig"); });
  drawerEls = { schleier, drawer };
}
function schliesseDrawer() {
  if (!drawerEls) return;
  const { schleier, drawer } = drawerEls; drawerEls = null;
  schleier.classList.remove("zeig"); drawer.classList.remove("zeig");
  setTimeout(() => { schleier.remove(); drawer.remove(); }, 240);
}

// =========================================================== PROJEKTE
function renderProjekte() {
  const w = $("#screenProjekte"); w.innerHTML = "";
  const gesamt = raeume().reduce((s, r) => s + G.flaeche(r), 0);
  const warn = raeume().reduce((s, r) => s + warnungenFuer(r), 0);
  w.append(el("div", { class: "kennzahlen" },
    kennzahl("dunkel", "RÄUME", String(raeume().length)),
    kennzahl("braun", "WARNUNGEN", String(warn)),
    kennzahl("sand", "FLÄCHE", gesamt.toFixed(1) + " m²")));

  w.append(el("div", { class: "rubrik" }, "Räume · " + (projekt.name || "Projekt")));
  const liste = el("div", { class: "mauerliste" });
  for (const r of raeume()) {
    const n = warnungenFuer(r);
    const geraete = platzhalter().filter(p => p.raumId === r.id).length;
    const einb = projekt.einbauten.filter(e => e.raumId === r.id).length;
    liste.append(el("button", { class: "stein",
      onclick: () => { projekt.aktiverRaum = r.id; auswahl = null; speichern(); raumSheet(r); } },
      el("span", { class: "stein-kachel" }, (r.name || "R").slice(0, 1).toUpperCase()),
      el("span", { class: "stein-haupt" },
        el("span", { class: "stein-name" }, r.name || "Raum"),
        el("span", { class: "stein-meta" },
          `${r.nummer || "—"} · ${G.flaeche(r).toFixed(1)} m² · ${G.breite(r).toFixed(2)}×${G.tiefe(r).toFixed(2)} m`),
        el("span", { class: "marken" },
          el("span", { class: "marke" }, `${geraete} GERÄTE`),
          el("span", { class: "marke" }, `${einb} POSITIONEN`),
          n ? el("span", { class: "marke stoss" }, `${n} VERSTOSS`) : el("span", { class: "marke ok" }, "NORM OK"))),
      el("span", { class: "karte-wert" }, r.id === raum().id ? "AKTIV" : "")));
  }
  w.append(liste);

  // Referenzobjekt (Konzept §8) – ehrlich als Hinweis, nicht als Fake-Status.
  w.append(el("div", { class: "karte", style: "margin-top:16px;border-style:dashed;border-color:var(--ziegel)" },
    el("div", { class: "rubrik", style: "margin-bottom:6px" }, "Referenzobjekt"),
    el("div", { class: "hinweis-text", style: "margin:0" },
      "30×30-Block im Raum aufstellen: er liefert Maßstab, AR-Anker und Ausrichtung in einem. Kantenlänge im Scan einstellbar.")));
}
function kennzahl(art, titel, wert) {
  return el("div", { class: "kennzahl " + art }, el("span", null, titel), el("b", null, wert));
}

function raumAnlegen(seite) {
  const basis = raum();
  const neu = {
    id: Store.neueId("raum"), name: `Raum ${raeume().length + 1}`, nummer: "",
    geschoss: basis ? basis.geschoss : 0, breiteM: 3, breiteVorneM: null, tiefeM: 3,
    schraege: "KEINE", umriss: "", hoeheM: basis ? basis.hoeheM : 2.5,
    aufbauM: basis ? basis.aufbauM : 0, xM: 0, yM: 0, drehungGrad: 0, farbe: "#e6d8b5", notiz: ""
  };
  if (basis && seite) Object.assign(neu, anlegen(neu, basis, seite));
  raeume().push(neu);
  projekt.aktiverRaum = neu.id; auswahl = null; speichern();
  schliesseSheet(); renderProjekte(); raumSheet(neu);
}
function fabRaumTippen() {
  if (!raeume().length) return raumAnlegen(null);
  oeffneSheet("Raum anlegen", inhalt => {
    inhalt.append(el("p", { class: "hinweis-text" },
      "Bündig an den aktiven Raum angelegt – ohne Schieben."));
    const g = el("div", { class: "richtung-gitter" });
    for (const [s, t] of [[Seite.LINKS, "◀ Links"], [Seite.RECHTS, "Rechts ▶"], [Seite.DAVOR, "▲ Davor"], [Seite.DAHINTER, "▼ Dahinter"]])
      g.append(el("button", { class: "richtung-knopf", onclick: () => raumAnlegen(s) }, t));
    inhalt.append(g, el("button", { class: "knopf zweit", style: "margin-top:12px", onclick: () => raumAnlegen(null) }, "Freistehend anlegen"));
  });
}

function raumSheet(r) {
  oeffneSheet(r.name || "Raum", inhalt => {
    const feld = (label, key, attrs = {}) => el("div", { class: "feld" }, el("label", null, label),
      el("input", Object.assign({ value: r[key] ?? "", oninput: e => {
        r[key] = attrs.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
        speichern(); if (plan) planAktualisieren();
      } }, attrs)));
    inhalt.append(feld("Name", "name"));
    inhalt.append(el("div", { class: "feld-reihe" },
      feld("Raumnummer", "nummer"), feld("Geschoss", "geschoss", { type: "number", step: "1", inputmode: "numeric" })));

    // Höhenbezug – Konzept §10
    inhalt.append(el("div", { class: "rubrik" }, "Höhenbezug"));
    const seg = el("div", { class: "segmente" },
      el("button", { class: bezug === "roh" ? "an" : "", onclick: () => setBezug("roh", r) }, "Rohboden"),
      el("button", { class: bezug === "ffb" ? "an" : "", onclick: () => setBezug("ffb", r) }, "Fertigfußboden"));
    inhalt.append(seg);
    inhalt.append(el("div", { class: "bezug-bild" },
      el("div", { class: "bezug-skizze" }, el("div", { class: "bezug-belag" }), el("div", { class: "bezug-marke" }, "FFB")),
      el("div", { class: "bezug-text", html:
        `Estrich + Belag <b>${Math.round(aufbau(r) * 1000)} mm</b>. Alle Montagehöhen rechnen ${bezugWort()}.` })));
    inhalt.append(el("div", { class: "feld-reihe", style: "margin-top:12px" },
      feld("Raumhöhe (m)", "hoeheM", { type: "number", step: "0.01", inputmode: "decimal" }),
      feld("Aufbau/Estrich (m)", "aufbauM", { type: "number", step: "0.01", inputmode: "decimal" })));

    const trapez = r.breiteVorneM != null && r.breiteVorneM !== "";
    inhalt.append(el("div", { class: "rubrik" }, "Form"));
    inhalt.append(el("div", { class: "segmente" },
      el("button", { class: !trapez ? "an" : "", onclick: () => { r.breiteVorneM = null; speichern(); if (plan) planAktualisieren(); schliesseSheet(); raumSheet(r); } }, "Rechteck"),
      el("button", { class: trapez ? "an" : "", onclick: () => { r.breiteVorneM = Number(r.breiteM) || 3; speichern(); if (plan) planAktualisieren(); schliesseSheet(); raumSheet(r); } }, "Trapez")));
    inhalt.append(el("div", { class: "feld-reihe", style: "margin-top:12px" },
      feld(trapez ? "Breite hinten (m)" : "Breite (m)", "breiteM", { type: "number", step: "0.01", inputmode: "decimal" }),
      feld("Tiefe (m)", "tiefeM", { type: "number", step: "0.01", inputmode: "decimal" })));
    if (trapez) inhalt.append(feld("Breite vorne (m)", "breiteVorneM", { type: "number", step: "0.01", inputmode: "decimal" }));

    inhalt.append(el("button", { class: "knopf prim", style: "margin-top:6px",
      onclick: () => { schliesseSheet(); zeigeScreen("plan"); } }, "Im Plan bearbeiten"));
    if (raeume().length > 1)
      inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: () => raumLoeschen(r) }, "Raum löschen"));
  });
}
function setBezug(b, r) {
  bezug = b;
  try { localStorage.setItem("raumwerk.bezug", b); } catch (_) {}
  schliesseSheet(); if (r) raumSheet(r);
}
function raumLoeschen(r) {
  if (!confirm(`Raum „${r.name}" löschen?`)) return;
  projekt.raeume = raeume().filter(x => x.id !== r.id);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== r.id);
  projekt.einbauten = projekt.einbauten.filter(e => e.raumId !== r.id);
  projekt.fotos = projekt.fotos.filter(f => f.raumId !== r.id);
  for (const v of projekt.varianten) v.platzhalter = v.platzhalter.filter(p => p.raumId !== r.id);
  if (projekt.aktiverRaum === r.id) projekt.aktiverRaum = raeume()[0]?.id;
  speichern(); schliesseSheet(); renderProjekte();
}

// =========================================================== PLAN
function planInit() {
  if (plan) return;
  plan = new Plan($("#planSvg"), {
    onSelect: id => { auswahl = id ? { typ: "platzhalter", id } : null; planAktualisieren(); if (id) inspektorSheet(); },
    onEinbauSelect: id => { auswahl = { typ: "einbau", id }; planAktualisieren(); inspektorSheet(); },
    onPlace: onPlace,
    onPlatzhalterMove: (id, patch) => { const p = platzhalter().find(x => x.id === id); if (p) { Object.assign(p, patch); speichern(); planAktualisieren(); } },
    onEinbauMove: (id, patch) => { const e = projekt.einbauten.find(x => x.id === id); if (e) { Object.assign(e, patch); speichern(); planAktualisieren(); } },
    onMessung: e => toast(e.art === "strecke" ? `MIND. ${e.laengeM.toFixed(2)} M`
      : `${e.flaecheM2.toFixed(2)} M² · UMFANG ${e.umfangM.toFixed(2)} M`),
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
  plan.setModell({
    raum: raum(),
    oeffnungen: oeffnungenAkt().concat(tuerOeffnungenRaum(raum().id)),
    einbauten: einbautenAkt(), platzhalter: platzhalterAkt(), fotos: fotosAkt(),
    befunde: pruefe(raum(), platzhalterAkt()), auswahl
  }).zeichne();
}
function onPlace(x, y) {
  if (einbauWahl) {
    const art = einbauWahl;
    const e = { id: Store.neueId("ein"), raumId: raum().id, art,
      befestigung: Normmasse.befestigung(art), hoeheM: Normmasse.hoehe(art), relX: .5, relY: .5 };
    Object.assign(e, plan.einrastEinbauVorschlag(e, x, y));
    projekt.einbauten.push(e);
    auswahl = { typ: "einbau", id: e.id };
  } else if (paletteWahl) {
    const ph = { id: Store.neueId("ph"), raumId: raum().id, komponente: paletteWahl,
      xM: x, yM: y, drehungGrad: 0, bezeichnung: "" };
    Object.assign(ph, plan.einrastVorschlag(ph, x, y));
    platzhalter().push(ph);
    auswahl = { typ: "platzhalter", id: ph.id };
  } else return;
  paletteWahl = einbauWahl = null;
  setWerkzeug("auswahl"); speichern(); planAktualisieren(); inspektorSheet();
}
function setWerkzeug(m) {
  werkzeug = m;
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.classList.toggle("an", b.dataset.modus === m));
  if (plan) plan.setModus(m);
}

function paletteSheet() {
  oeffneSheet("Element platzieren", inhalt => {
    let tab = "einbau";
    const tabs = el("div", { class: "palette-tabs" },
      el("button", { class: "an", onclick: () => wechsel("einbau") }, "Installation"),
      el("button", { onclick: () => wechsel("klotz") }, "Geräte / Möbel"));
    const gitter = el("div", { class: "palette-gitter" });
    inhalt.append(tabs, gitter);
    function wechsel(t) { tab = t; tabs.children[0].classList.toggle("an", t === "einbau"); tabs.children[1].classList.toggle("an", t === "klotz"); male(); }
    function male() {
      gitter.innerHTML = "";
      if (tab === "einbau") for (const art of EINBAU_HAEUFIG)
        gitter.append(el("button", { class: "palette-knopf", onclick: () => scharf({ einbau: art }) },
          el("span", { class: "palette-glyph" }, glyph(art)),
          el("span", { class: "pk-haupt" }, el("b", null, Normmasse.ARTEN.get(art) || art),
            el("small", null, hoeheText(art)))));
      else for (const k of KATALOG)
        gitter.append(el("button", { class: "palette-knopf", onclick: () => scharf({ klotz: k.schluessel }) },
          el("span", { class: "palette-glyph" }, glyph(k.schluessel)),
          el("span", { class: "pk-haupt" }, el("b", null, k.name),
            el("small", null, `${k.breiteM}×${k.tiefeM} M`))));
    }
    male();
  });
}
function scharf(w) {
  einbauWahl = w.einbau || null; paletteWahl = w.klotz || null;
  setWerkzeug("platzieren"); schliesseSheet(); toast("IN DEN PLAN TIPPEN");
}
function hoeheText(art) {
  const h = Normmasse.hoehe(art);
  if (h == null) return "AN DER DECKE";
  return `${Math.round((h + (bezug === "roh" ? aufbau() : 0)) * 100)} CM ${bezug === "roh" ? "ÜB. ROH" : "ÜB. FFB"}`;
}

function inspektorSheet() {
  if (!auswahl) return;
  if (auswahl.typ === "einbau") {
    const e = projekt.einbauten.find(x => x.id === auswahl.id); if (!e) return;
    oeffneSheet(Normmasse.ARTEN.get(e.art) || e.art, inhalt => {
      const max = Number(raum().hoeheM) || 3;
      const wert = el("span", { class: "ar-hoehe-wert", style: "color:var(--ziegel)" }, fmtCm(hoeheAnzeige(e)));
      inhalt.append(el("div", { style: "display:flex;align-items:baseline;gap:8px;margin-bottom:2px" },
        el("div", { class: "rubrik", style: "margin:0;flex:1" }, "Höhe " + bezugWort()), wert));
      const range = el("input", { type: "range", min: "0", max: String(max + (bezug === "roh" ? aufbau() : 0)),
        step: "0.01", value: String(hoeheAnzeige(e)), style: "width:100%;accent-color:var(--ziegel);height:34px",
        oninput: ev => {
          const anzeige = Number(ev.target.value);
          e.hoeheM = Math.round((anzeige - (bezug === "roh" ? aufbau() : 0)) * 100) / 100;
          wert.textContent = fmtCm(hoeheAnzeige(e));
          speichern(); planAktualisieren();
        } });
      inhalt.append(range);
      // Schnellwahl typischer Höhen
      const presets = el("div", { class: "presets" });
      for (const [lbl, m] of [["30 CM", .3], ["105 CM", 1.05], ["115 CM", 1.15], ["DECKE", max]])
        presets.append(el("button", { class: "preset", onclick: () => {
          e.hoeheM = m; range.value = String(hoeheAnzeige(e)); wert.textContent = fmtCm(hoeheAnzeige(e));
          speichern(); planAktualisieren();
        } }, lbl));
      inhalt.append(presets);
      inhalt.append(el("p", { class: "hinweis-text", style: "margin-top:14px" },
        `Befestigung ${e.befestigung || Normmasse.befestigung(e.art)} · Position im Plan frei verschiebbar.`));
      inhalt.append(el("button", { class: "knopf gefahr", onclick: () => {
        projekt.einbauten = projekt.einbauten.filter(x => x.id !== e.id); nachLoeschen();
      } }, "Löschen"));
    });
  } else {
    const ph = platzhalter().find(p => p.id === auswahl.id); if (!ph) return;
    const komp = finde(ph.komponente);
    oeffneSheet(komp ? komp.name : "Gerät", inhalt => {
      inhalt.append(el("div", { class: "feld" }, el("label", null, "Bezeichnung"),
        el("input", { value: ph.bezeichnung || "", placeholder: "optional",
          oninput: e => { ph.bezeichnung = e.target.value; speichern(); planAktualisieren(); } })));
      inhalt.append(el("button", { class: "knopf zweit", onclick: () => {
        ph.drehungGrad = ((Number(ph.drehungGrad) || 0) + 90) % 360; speichern(); planAktualisieren();
      } }, `Drehen · ${Number(ph.drehungGrad) || 0}°`));
      if (komp) inhalt.append(el("p", { class: "hinweis-text", style: "margin-top:12px" },
        `${komp.breiteM} × ${komp.tiefeM} × ${komp.hoeheM} m · ${komp.kategorie}`));
      inhalt.append(el("button", { class: "knopf gefahr", onclick: () => {
        const arr = platzhalter(); const i = arr.findIndex(p => p.id === ph.id);
        if (i >= 0) arr.splice(i, 1); nachLoeschen();
      } }, "Löschen"));
    });
  }
}
const fmtCm = m => `${Math.round(m * 100)} cm`;
function nachLoeschen() { auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); }

// =========================================================== SCAN
function renderScan() {
  const w = $("#screenScan"); w.innerHTML = "";
  const info = window.__native && window.__native.geraete ? window.__native.geraete() : null;
  w.append(el("div", { class: "rubrik" }, "Erfassung"));
  const k = el("div", { class: "karte" });
  k.append(el("p", { class: "hinweis-text", style: "margin-top:0" },
    "30×30-Block in den Raum stellen – er liefert Maßstab, AR-Anker und Ausrichtung. Die App führt per Pfeil durch die noch offenen Richtungen und verschlagwortet jede Aufnahme mit Lage und Ort."));
  if (info) {
    const ir = (info.kameras || []).filter(c => c.mono).length;
    k.append(el("div", { class: "marken", style: "margin-bottom:12px" },
      el("span", { class: "marke" }, `${(info.hersteller || "").toUpperCase()} ${(info.modell || "").toUpperCase()}`.trim().slice(0, 22)),
      el("span", { class: "marke" }, `${(info.kameras || []).length} KAMERAS`),
      ir ? el("span", { class: "marke pruef" }, `${ir}× MONO/IR`) : null));
  }
  k.append(el("button", { class: "knopf prim", onclick: scanStarten }, "Scan starten"));
  w.append(k);

  const scans = projekt.scans || [];
  if (scans.length) {
    w.append(el("div", { class: "rubrik" }, `Aufnahmen · ${scans.length}`));
    const liste = el("div", { class: "mauerliste" });
    scans.slice().reverse().forEach(s => liste.append(el("div", { class: "befund" },
      el("div", { class: "befund-punkt ok" }),
      el("div", { class: "befund-text" },
        el("b", null, `${s.anzahl} Bilder · ${s.abgedeckteSektoren || 0}/${s.sektoren || 12} Sektoren`),
        el("span", null, `${new Date(s.erstellt).toLocaleString("de-DE")} · BLOCK ${Math.round((s.wuerfelKanteM || 0) * 100)} CM`)))));
    w.append(liste);
  }
}
async function scanStarten() {
  try {
    const mod = await import("../scan.js");
    await mod.starteScan({ raum: raum(),
      speichern: m => { projekt.scans = projekt.scans || []; projekt.scans.push(m); speichern(); },
      onEnde: () => renderScan() });
  } catch (_) { toast("SCAN NICHT MÖGLICH – KAMERA NÖTIG"); }
}

// =========================================================== AR
function renderAr() {
  const w = $("#screenAr"); w.innerHTML = "";
  w.append(el("div", { class: "rubrik" }, "AR-Planung vor Ort"));
  const k = el("div", { class: "karte" });
  k.append(el("p", { class: "hinweis-text", style: "margin-top:0" },
    "Elemente am realen Ort einblenden und mit dem Kunden setzen. Höhen rechnen live " + bezugWort() + "."));
  k.append(el("div", { class: "bezug-bild", style: "margin-bottom:14px" },
    el("div", { class: "bezug-skizze" }, el("div", { class: "bezug-belag" }), el("div", { class: "bezug-marke" }, "FFB")),
    el("div", { class: "bezug-text", html:
      `Aufbau <b>${Math.round(aufbau() * 1000)} mm</b> · ${einbautenAkt().length} Positionen im Raum <b>${raum().name}</b>.` })));
  k.append(el("button", { class: "knopf prim", onclick: arStarten }, "AR öffnen"));
  w.append(k);

  if (einbautenAkt().length) {
    w.append(el("div", { class: "rubrik" }, "Positionen"));
    const liste = el("div", { class: "mauerliste" });
    for (const e of einbautenAkt()) liste.append(el("button", { class: "stein",
      onclick: () => { auswahl = { typ: "einbau", id: e.id }; inspektorSheet(); } },
      el("span", { class: "palette-glyph" }, glyph(e.art)),
      el("span", { class: "stein-haupt" },
        el("span", { class: "stein-name", style: "font-size:15px" }, Normmasse.ARTEN.get(e.art) || e.art),
        el("span", { class: "stein-meta" }, (e.befestigung || Normmasse.befestigung(e.art))),
      ),
      el("span", { class: "karte-wert", style: "font-size:15px;color:var(--ziegel);font-weight:600" }, fmtCm(hoeheAnzeige(e)))));
    w.append(liste);
  }
}
async function arStarten() {
  try {
    const mod = await import("../ar.js");
    await mod.starte({ raum: raum(), platzhalter: platzhalterAkt(), einbauten: einbautenAkt(),
      findeKomponente: finde, neueId: Store.neueId,
      einbauHinzufuegen: e => projekt.einbauten.push(e),
      onAenderung: () => { speichern(); planAktualisieren(); },
      onEnde: () => { renderAr(); planAktualisieren(); } });
  } catch (_) { toast("AR NICHT MÖGLICH – KAMERA/WEBGL NÖTIG"); }
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
      heightM: e.hoeheM != null ? Number(e.hoeheM) : null,
      relX: Number(e.relX ?? .5), relY: Number(e.relY ?? .5) }))
  }));
}
async function dreiDZeigen() {
  const c = $("#dreidFlaeche");
  if (!modell3d) {
    try {
      const mod = await import("../../modell3d.js");
      modell3d = mod.createModel(c, {
        onSelect: d => { if (d) { projekt.aktiverRaum = d.id; speichern(); } },
        onMoved: d => { const r = raeume().find(x => x.id === d.id); if (r) { r.xM = d.posX; r.yM = d.posY; speichern(); } },
        snap: (mr, nx, ny) => { const r = raeume().find(x => x.id === mr.id); return r ? einrasten(r, nx, ny, raeume()) : [nx, ny]; }
      });
    } catch (_) { c.innerHTML = `<div class="dreid-fehler">3D-Ansicht nicht ladbar.</div>`; return; }
  }
  modell3d.setRooms(raeumeFuer3d());
  modell3d.setMode(modus3d);
  requestAnimationFrame(() => modell3d.resize());
}

// =========================================================== PRÜFUNG
function renderPruefung() {
  const w = $("#screenPruefung"); w.innerHTML = "";
  const befunde = pruefe(raum(), platzhalterAkt());
  const warn = befunde.filter(b => b.schwere === Schwere.WARNUNG).length;
  w.append(el("div", { class: "rubrik" }, `VDE/DIN · ${raum().name}`));
  w.append(el("div", { class: "banner " + (warn ? "schlecht" : "gut") },
    el("b", null, warn ? String(warn) : "OK"),
    el("span", null, warn ? "Freiraum unterschritten – Positionen prüfen"
      : "Alle geprüften Freiräume eingehalten (konservativ gerechnet)")));
  if (!befunde.length) {
    w.append(el("div", { class: "karte leer" }, "Noch keine prüfpflichtigen Geräte im Raum. Setze im Plan ein Element."));
    return;
  }
  const rang = { WARNUNG: 0, HINWEIS: 1, OK: 2 };
  const liste = el("div", { class: "mauerliste" });
  for (const b of [...befunde].sort((a, c) => rang[a.schwere] - rang[c.schwere])) {
    const kl = b.schwere === Schwere.WARNUNG ? "stoss" : b.schwere === Schwere.HINWEIS ? "warn" : "ok";
    const quelle = [b.quelle, b.regelVersion ? "REGELWERK " + b.regelVersion : null].filter(Boolean).join(" · ");
    liste.append(el("div", { class: "befund" },
      el("div", { class: "befund-punkt " + kl }),
      el("div", { class: "befund-text" }, el("b", null, b.text || "Prüfung"),
        quelle ? el("span", null, quelle.toUpperCase()) : null)));
  }
  w.append(liste);
}

// =========================================================== DOKU
function renderDoku() {
  const w = $("#screenDoku"); w.innerHTML = "";
  const fotos = fotosAkt();
  w.append(el("div", { class: "rubrik" }, `Doku · ${raum().name}`));
  const gesetzt = einbautenAkt().length, geraete = platzhalterAkt().length;
  w.append(el("div", { class: "karte" },
    el("div", { class: "karte-kopf" },
      el("div", { class: "rubrik", style: "margin:0;flex:1" }, "Bestand im Raum"),
      el("div", { class: "karte-wert", style: "font-size:15px;color:var(--ziegel);font-weight:600" }, `${gesetzt + geraete}`)),
    el("p", { class: "hinweis-text", style: "margin:8px 0 0" },
      `${gesetzt} Installations-Positionen · ${geraete} Geräte · ${fotos.length} Fotos verortet.`)));

  w.append(el("div", { class: "rubrik" }, "Verortete Fotos"));
  if (!fotos.length) {
    w.append(el("div", { class: "karte leer" }, "Noch keine Fotos in diesem Raum."));
  } else {
    for (const f of fotos) {
      const karte = el("div", { class: "karte status status-warn", style: "padding:0;overflow:hidden" });
      if (f.datenUrl) karte.append(el("img", { src: f.datenUrl, alt: "",
        style: "display:block;width:100%;height:150px;object-fit:cover" }));
      karte.append(el("div", { style: "padding:11px 13px" },
        el("div", { class: "karte-titel", style: "font-size:16px" }, f.titel || "Foto"),
        f.notiz ? el("div", { class: "hinweis-text", style: "margin:3px 0 0" }, f.notiz) : null));
      w.append(karte);
    }
  }
  w.append(el("button", { class: "knopf zweit", onclick: reportErzeugen }, "Report als PDF"));
}

// =========================================================== Menü/Projekt
function menueSheet() {
  oeffneSheet("Projekt", inhalt => {
    inhalt.append(el("div", { class: "feld" }, el("label", null, "Projektname"),
      el("input", { value: projekt.name || "", oninput: e => { projekt.name = e.target.value; speichern(); } })));
    inhalt.append(el("div", { class: "rubrik" }, "Variante · " + Store.aktiveVariante(projekt).name));
    const liste = el("div", { class: "mauerliste" });
    projekt.varianten.forEach((v, i) => liste.append(el("button", { class: "stein",
      onclick: () => { projekt.aktiveVariante = i; auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); } },
      el("span", { class: "stein-haupt" }, el("span", { class: "stein-name", style: "font-size:15px" }, v.name)),
      el("span", { class: "karte-wert" }, i === projekt.aktiveVariante ? "AKTIV" : `${v.platzhalter.length}`))));
    inhalt.append(liste);
    inhalt.append(el("div", { class: "knopf-reihe", style: "margin-top:12px" },
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteKlonen(projekt); speichern(); schliesseSheet(); menueSheet(); } }, "Duplizieren"),
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteNeu(projekt); speichern(); schliesseSheet(); menueSheet(); } }, "Neu")));
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:18px" }, "Daten"));
    inhalt.append(el("div", { class: "knopf-reihe" },
      el("button", { class: "knopf zweit", onclick: exportieren }, "Export"),
      el("button", { class: "knopf zweit", onclick: importieren }, "Import")));
    inhalt.append(el("button", { class: "knopf prim", style: "margin-top:10px", onclick: reportErzeugen }, "Report als PDF"));
    inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: zuruecksetzen }, "Auf Beispiel zurücksetzen"));
  });
}
function reportErzeugen() {
  schliesseSheet(); zeigeScreen("plan");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    plan.einpassen();
    const r = $("#planSvg").getBoundingClientRect();
    bericht(projekt, Store.aktiveVariante(projekt), pruefe(raum(), platzhalterAkt()), $("#planSvg").innerHTML,
      { width: Math.round(r.width) || 900, height: Math.round(r.height) || 560 });
  }));
}
function exportieren() {
  const b = new Blob([JSON.stringify(projekt, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(b), download: (projekt.name || "raumwerk").replace(/\s+/g, "_") + ".json" });
  document.body.append(a); a.click(); a.remove(); schliesseSheet();
}
function importieren() {
  const inp = el("input", { type: "file", accept: "application/json,.json", style: "display:none",
    onchange: e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
      r.onload = () => { try { projekt = Store.ausObjekt(JSON.parse(r.result)); auswahl = null; speichern(); schliesseSheet(); zeigeScreen("projekte"); }
        catch (_) { toast("DATEI NICHT LESBAR"); } };
      r.readAsText(f); } });
  document.body.append(inp); inp.click(); inp.remove();
}
function zuruecksetzen() {
  if (!confirm("Auf das Beispielprojekt zurücksetzen? Der aktuelle Stand geht verloren.")) return;
  projekt = Store.beispielProjekt(); auswahl = null; paletteWahl = einbauWahl = null;
  speichern(); schliesseSheet(); zeigeScreen("projekte");
}

// =========================================================== Sheet
let sheetEls = null;
function oeffneSheet(titel, bau) {
  schliesseSheet();
  const schleier = el("div", { class: "sheet-schleier", onclick: schliesseSheet });
  const inhalt = el("div", { class: "sheet-inhalt" });
  const sheet = el("div", { class: "sheet" },
    el("div", { class: "sheet-griff" }),
    el("div", { class: "sheet-kopf" }, el("h3", null, titel),
      el("button", { class: "sheet-zu", onclick: schliesseSheet,
        html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>` })),
    inhalt);
  document.body.append(schleier, sheet);
  bau(inhalt);
  requestAnimationFrame(() => { schleier.classList.add("zeig"); sheet.classList.add("zeig"); });
  sheetEls = { schleier, sheet };
}
function schliesseSheet() {
  if (!sheetEls) return;
  const { schleier, sheet } = sheetEls; sheetEls = null;
  schleier.classList.remove("zeig"); sheet.classList.remove("zeig");
  setTimeout(() => { schleier.remove(); sheet.remove(); }, 240);
}

// =========================================================== Toast
let toastT = 0;
function toast(t) {
  const n = $("#planToast"); if (!n) return;
  n.textContent = t; n.classList.add("zeig");
  clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove("zeig"), 2200);
}

// =========================================================== Sync-Anzeige
function syncMalen() {
  // Offline-first: der lokale Stand ist die Wahrheit. Ehrlich beschriftet –
  // ein Server-Abgleich ist noch nicht angebunden.
  const online = navigator.onLine;
  $("#syncPunkt").style.background = online ? "#8FB98A" : "var(--signal)";
  $("#syncText").textContent = online ? "LOKAL" : "OFFLINE";
}

// =========================================================== Start
function verdrahten() {
  $("#btnDrawer").onclick = oeffneDrawer;
  $("#kopfTitel").onclick = () => zeigeScreen("projekte");
  $("#btnSync").onclick = () => toast(navigator.onLine
    ? "ALLES LOKAL GESPEICHERT · KEIN SERVER ANGEBUNDEN"
    : "OFFLINE · ALLE ÄNDERUNGEN LIEGEN LOKAL BEREIT");
  $("#fabRaum").onclick = fabRaumTippen;
  $("#fabPalette").onclick = paletteSheet;
  $("#planEinpassen").onclick = () => { if (plan) plan.einpassen(); };
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.onclick = () => setWerkzeug(b.dataset.modus));
  document.querySelectorAll("#dreidModus button").forEach(b => b.onclick = () => {
    modus3d = b.dataset.modus;
    document.querySelectorAll("#dreidModus button").forEach(x => x.classList.toggle("an", x === b));
    if (modell3d) modell3d.setMode(modus3d);
  });
  window.addEventListener("online", syncMalen);
  window.addEventListener("offline", syncMalen);
  window.addEventListener("resize", () => {
    if (screen === "plan" && plan) plan.einpassen();
    if (screen === "3d" && modell3d) modell3d.resize();
  });
}

verdrahten();
syncMalen();
zeigeScreen("projekte");
