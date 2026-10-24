/*
 * RAUMWERK · App – Controller (Designrichtung „Ziegelwerk“, Konzept v2 §6).
 *
 * Eigenständige Feld-Oberfläche für Android. Navigation ist das **Seitenmenü
 * (Drawer)** über die Bereiche Projekte · Plan · Scan · AR-Planung · 3D ·
 * Normprüfung · Doku. Die Fachlogik ist dieselbe wie in der Web-Workstation
 * (Store, Geometrie, Normen, Plan, 3D, Scan, Sensorik) – nur die Gestaltung
 * ist bewusst getrennt.
 *
 * Kern der Feld-App ist das **Aufmessen ohne Würfel** (assistent.js): Raum
 * per Handy anzielen, mit dem Bandmaß Wand für Wand eintragen oder als
 * Rechteck – danach steht ein maßstäblicher Raum mit Türen, Fenstern und
 * Installation, jede Wand mit ihrer Maß-Herkunft. Nachmessen geht jederzeit.
 *
 * Aus dem Konzept übernommen:
 *  · §10 Höhenbezug umschaltbar: Rohboden ⇄ Fertigfußboden (Estrich/Belag).
 *  · §13 Normprüfung als Kern, nicht als Beiwerk.
 *  · Offline-first: alles lokal, der Zustand wird sofort gespeichert.
 */

import * as Store from "../store.js";
import { Plan } from "../plan2d.js";
import { berichtOeffnen } from "../report.js";
import * as Verbindung from "../verbindung.js";
import { starteAssistent } from "../assistent.js";
import { uebernehmen, nachmessen, waendeMitHerkunft } from "../uebernahme.js";
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
const NAT = () => window.__native || {};
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
const OEFF_ARTEN = [["TUER", "Tür"], ["FENSTER", "Fenster"], ["DURCHGANG", "Durchgang"], ["TOR", "Tor"]];
const artWort = a => (OEFF_ARTEN.find(x => x[0] === a) || [a, a])[1];

/** Zahl aus einer Eingabe – Komma oder Punkt; NaN bei Unsinn. */
const zahl = t => { const n = parseFloat(String(t ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const komma = (v, n = 2) => Number(v).toFixed(n).replace(".", ",");
const fmtCm = m => `${Math.round(m * 100)} cm`;

// --------------------------------------------------------- Zustand
let projekt = Store.laden();
let screen = "projekte";
let auswahl = null;
let werkzeug = "auswahl";
let paletteWahl = null, einbauWahl = null;
let plan = null, modell3d = null, modus3d = "drehen";
let assistentOffen = false;
/** Höhenbezug (Konzept §10): "ffb" = ab Fertigfußboden, "roh" = ab Rohboden. */
let bezug = (() => { try { return localStorage.getItem("raumwerk.bezug") || "ffb"; } catch (_) { return "ffb"; } })();

const raeume = () => projekt.raeume;
const raum = () => projekt.raeume.find(r => r.id === projekt.aktiverRaum) || projekt.raeume[0];
const platzhalter = () => Store.platzhalter(projekt);
const platzhalterAkt = () => platzhalter().filter(p => p.raumId === raum().id);
const einbautenAkt = () => projekt.einbauten.filter(e => e.raumId === raum().id);
const oeffnungenAkt = () => projekt.oeffnungen.filter(o => o.raumId === raum().id);
const fotosAkt = () => projekt.fotos.filter(f => f.raumId === raum().id);
const tuerOeffnungenRaum = id => projekt.verbindungen
  .flatMap(v => Verbindung.oeffnungen(v, raeume())).filter(o => o.raumId === id);
const aufbau = r => Number((r || raum()).aufbauM) || 0;
const warnungenFuer = r => pruefe(r, platzhalter().filter(p => p.raumId === r.id))
  .filter(b => b.schwere === Schwere.WARNUNG).length;

let speicherWarnungGezeigt = false;
function speichern() {
  const ok = Store.speichern(projekt);
  if (!ok && !speicherWarnungGezeigt) {
    speicherWarnungGezeigt = true;
    if (confirm("Der Gerätespeicher ist voll (viele Fotos?). Änderungen gehen sonst beim Schließen verloren.\n\nJetzt das Projekt exportieren?")) exportieren();
  }
  if (ok) speicherWarnungGezeigt = false;
  return ok;
}

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
  { id: "scan", name: "Fotos & Scan", sub: "Bildserie für Doku und Photogrammetrie",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><circle cx="12" cy="12" r="3"/></svg>` },
  { id: "ar", name: "AR-Planung", sub: "Vor Ort mit dem Kunden",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>` },
  { id: "3d", name: "3D-Modell", sub: "Raum-Abbild begehen",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 12 21 7M12 12v10M12 12 3 7"/></svg>` },
  { id: "pruefung", name: "Normprüfung", sub: "VDE/DIN · Kern-USP",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>` },
  { id: "doku", name: "Doku", sub: "Fotos, Report, Weitergabe",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 15 5-4 4 3 3-2 6 4"/><circle cx="9" cy="9.5" r="1.4"/></svg>` }
];

function zeigeScreen(name) {
  screen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("aktiv", s.dataset.screen === name));
  const b = BEREICHE.find(x => x.id === name) || BEREICHE[0];
  $("#kopfKrume").textContent = b.krume || `${raum() ? raum().name : ""} · ${raum() ? komma(G.flaeche(raum()), 1) : "0"} m²`;
  $("#kopfName").textContent = b.name;
  if (name !== "3d" && modell3d) { modell3d.dispose(); modell3d = null; }   // Akku schonen
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
  const offenSeit = performance.now();
  const schleier = el("div", { class: "drawer-schleier", onclick: () => { if (performance.now() - offenSeit > 400) schliesseDrawer(); } });
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
      el("span", null, "FELD · OFFLINE-FIRST · v0.4")),
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
    kennzahl("sand", "FLÄCHE", komma(gesamt, 1) + " m²")));

  w.append(el("div", { class: "rubrik" }, "Räume · " + (projekt.name || "Projekt")));
  const liste = el("div", { class: "mauerliste" });
  for (const r of raeume()) {
    const n = warnungenFuer(r);
    const geraete = platzhalter().filter(p => p.raumId === r.id).length;
    const einb = projekt.einbauten.filter(e => e.raumId === r.id).length;
    const oeff = projekt.oeffnungen.filter(o => o.raumId === r.id).length;
    liste.append(el("button", { class: "stein",
      onclick: () => { projekt.aktiverRaum = r.id; auswahl = null; speichern(); raumSheet(r); } },
      el("span", { class: "stein-kachel" }, (r.name || "R").slice(0, 1).toUpperCase()),
      el("span", { class: "stein-haupt" },
        el("span", { class: "stein-name" }, r.name || "Raum"),
        el("span", { class: "stein-meta" },
          `${r.nummer || "—"} · ${komma(G.flaeche(r), 1)} m² · ${G.wandLaengen(r).length} Wände · H ${komma(Number(r.hoeheM) || 0, 2)} m`),
        el("span", { class: "marken" },
          aufmassMarke(r),
          el("span", { class: "marke" }, `${oeff} ÖFFN.`),
          el("span", { class: "marke" }, `${einb + geraete} ELEM.`),
          n ? el("span", { class: "marke stoss" }, `${n} VERSTOSS`) : el("span", { class: "marke ok" }, "NORM OK"))),
      el("span", { class: "karte-wert" }, r.id === raum().id ? "AKTIV" : "")));
  }
  w.append(liste);

  // Einstieg ins Aufmessen – ehrlich: kein Würfel nötig.
  w.append(el("div", { class: "karte aufmass-karte" },
    el("div", { class: "rubrik", style: "margin-bottom:6px" }, "Raum aufmessen – ohne Würfel"),
    el("div", { class: "hinweis-text", style: "margin:0 0 10px" },
      "Handy auf Brusthöhe, Fadenkreuz auf die Raumecken – oder Wand für Wand mit dem Bandmaß. Ein einziges Bandmaß (oder die Raumhöhe vom Laser) macht den gezielten Raum zentimetergenau."),
    el("button", { class: "knopf prim", onclick: fabRaumTippen }, "Neuen Raum aufnehmen")));
}
function kennzahl(art, titel, wert) {
  return el("div", { class: "kennzahl " + art }, el("span", null, titel), el("b", null, wert));
}
/** Marke für die Herkunft der Maße eines Raums. */
function aufmassMarke(r) {
  const m = r.aufmass && r.aufmass.methode;
  if (m === "zielen") {
    const k = r.aufmass.klasse || (r.aufmass.kalibriert ? "PLAN" : "SKIZZE");
    return el("span", { class: "marke " + (k === "AUFMASS" ? "ok" : "pruef") },
      k === "AUFMASS" ? "GEZIELT · AUFMASS ✓" : k === "PLAN" ? "GEZIELT · PLAN" : "GEZIELT · SKIZZE");
  }
  if (m === "band") return el("span", { class: "marke ok" }, "BANDMASS");
  if (m === "rechteck") return el("span", { class: "marke ok" }, "RECHTECK");
  return el("span", { class: "marke" }, "EINGEGEBEN");
}

/** Freistehende Räume rechts neben alle bestehenden des Geschosses setzen – nie übereinander. */
function freierPlatz(geschoss) {
  const aufEbene = raeume().filter(r => r.geschoss === geschoss);
  if (!aufEbene.length) return { xM: 0, yM: 0 };
  const rechts = Math.max(...aufEbene.map(r => (Number(r.xM) || 0) + G.breite(r)));
  return { xM: Math.round((rechts + 1) * 100) / 100, yM: 0 };
}

/** Neuer Raum: erst aufmessen, dann anlegen – ein Abbruch hinterlässt nichts. */
function raumNeu(seite, mitAufmass = true) {
  const basis = raum();
  const neu = {
    id: Store.neueId("raum"), name: `Raum ${raeume().length + 1}`, nummer: "",
    geschoss: basis ? basis.geschoss : 0, breiteM: 3, breiteVorneM: null, tiefeM: 3,
    schraege: "KEINE", umriss: "", hoeheM: basis ? basis.hoeheM : 2.5,
    aufbauM: basis ? basis.aufbauM : 0, xM: 0, yM: 0, drehungGrad: 0, farbe: "#e6d8b5", notiz: ""
  };
  const platzieren = () => {
    const lage = basis && seite ? anlegen(neu, basis, seite) : freierPlatz(neu.geschoss);
    Object.assign(neu, lage);
    // „Links“/„Davor“ würden durch die Klemmung auf ≥ 0 überlappen: dann alle Räume verschieben.
    if (basis && seite && (seite === Seite.LINKS || seite === Seite.DAVOR)) {
      const soll = seite === Seite.LINKS ? (Number(basis.xM) || 0) - G.breite(neu) : (Number(basis.yM) || 0) - G.tiefe(neu);
      const dx = seite === Seite.LINKS && soll < 0 ? -soll : 0, dy = seite === Seite.DAVOR && soll < 0 ? -soll : 0;
      if (dx || dy) {
        for (const r of raeume()) { r.xM = Math.round(((Number(r.xM) || 0) + dx) * 100) / 100; r.yM = Math.round(((Number(r.yM) || 0) + dy) * 100) / 100; }
        Object.assign(neu, anlegen(neu, basis, seite));
      }
    }
  };
  schliesseSheet();
  if (!mitAufmass) {
    platzieren(); raeume().push(neu);
    projekt.aktiverRaum = neu.id; auswahl = null; speichern(); renderProjekte(); raumSheet(neu);
    return;
  }
  aufmessen(neu, ergebnis => {
    raeume().push(neu);
    const hinweise = uebernehmen(projekt, neu.id, ergebnis, Store.neueId);
    platzieren();
    projekt.aktiverRaum = neu.id; auswahl = null; speichern();
    zeigeScreen("plan");
    toast(hinweise[0] || `${neu.name}: ${komma(G.flaeche(neu), 1)} m² aufgenommen`);
  });
}

/** Startet den Aufmaß-Assistenten für einen (neuen oder bestehenden) Raum. */
function aufmessen(r, fertig) {
  if (assistentOffen) return;
  assistentOffen = true;
  starteAssistent({
    raum: r, neueId: Store.neueId,
    onUebernehmen: e => { assistentOffen = false; fertig(e); },
    onAbbruch: () => { assistentOffen = false; }
  });
}

function fabRaumTippen() {
  if (!raeume().length) return raumNeu(null);
  oeffneSheet("Neuer Raum", inhalt => {
    inhalt.append(el("p", { class: "hinweis-text" },
      "Wo liegt der neue Raum? Danach wird er aufgemessen – per Handy, Bandmaß oder als Rechteck."));
    const g = el("div", { class: "richtung-gitter" });
    for (const [s, t] of [[Seite.LINKS, "◀ Links"], [Seite.RECHTS, "Rechts ▶"], [Seite.DAVOR, "▲ Davor"], [Seite.DAHINTER, "▼ Dahinter"]])
      g.append(el("button", { class: "richtung-knopf", onclick: () => raumNeu(s) }, t));
    inhalt.append(el("div", { class: "rubrik" }, "Angrenzend an „" + (raum().name || "aktiver Raum") + "“"), g,
      el("button", { class: "knopf prim", style: "margin-top:12px", onclick: () => raumNeu(null) }, "Freistehend aufnehmen"),
      el("button", { class: "knopf zweit", style: "margin-top:10px", onclick: () => raumNeu(null, false) }, "Ohne Aufmaß anlegen (3 × 3 m)"));
  });
}

// =========================================================== RAUM-BLATT
/** Zahlenfeld mit Komma, Plausibilitätsprüfung und „alter Wert bleibt“. */
function zahlFeld(label, wert, setzen, { min = 0.01, max = 100, leerErlaubt = false, platzhalter = "" } = {}) {
  const inp = el("input", { type: "text", inputmode: "decimal", value: wert == null || wert === "" ? "" : komma(wert, 2), placeholder: platzhalter,
    autocomplete: "off" });
  inp.addEventListener("change", () => {
    const roh = inp.value.trim();
    if (roh === "" && leerErlaubt) { inp.classList.remove("falsch"); setzen(null); return; }
    const n = zahl(roh);
    if (!Number.isFinite(n) || n < min || n > max) { inp.classList.add("falsch"); toast(`BITTE ${komma(min, 2)}–${komma(max, 0)} M`); return; }
    inp.classList.remove("falsch"); setzen(n);
  });
  return el("div", { class: "feld" }, el("label", null, label), inp);
}
function textFeld(label, wert, setzen, attrs = {}) {
  return el("div", { class: "feld" }, el("label", null, label),
    el("input", Object.assign({ value: wert ?? "", oninput: e => setzen(e.target.value) }, attrs)));
}

function raumSheet(r) {
  oeffneSheet(r.name || "Raum", inhalt => {
    const neuMalen = () => { schliesseSheet(true); raumSheet(r); };
    inhalt.append(textFeld("Name", r.name, v => { r.name = v; speichern(); if (plan) planAktualisieren(); }));
    inhalt.append(el("div", { class: "feld-reihe" },
      textFeld("Raumnummer", r.nummer, v => { r.nummer = v; speichern(); }),
      textFeld("Geschoss", String(r.geschoss ?? 0), v => { const n = parseInt(v, 10); if (Number.isFinite(n)) { r.geschoss = n; speichern(); } },
        { inputmode: "numeric" })));

    // ---- Maße: Aufmessen + Wände mit Herkunft + Nachmessen
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:6px" }, "Maße"));
    const umfang = G.wandLaengen(r).reduce((a, b) => a + b, 0);
    inhalt.append(el("div", { class: "masszeile" },
      el("span", null, el("b", null, komma(G.flaeche(r), 2) + " m²"), " Fläche"),
      el("span", null, el("b", null, komma(umfang, 2) + " m"), " Umfang"),
      el("span", null, el("b", null, komma(Number(r.hoeheM) || 0, 2) + " m"), " Höhe")));
    inhalt.append(el("button", { class: "knopf prim", onclick: () => {
      schliesseSheet();
      aufmessen(r, e => {
        const h = uebernehmen(projekt, r.id, e, Store.neueId);
        speichern(); zeigeScreen("plan"); toast(h[0] || "AUFMASS ÜBERNOMMEN");
      });
    } }, r.aufmass ? "Neu aufmessen" : "Raum aufmessen"));

    const wl = waendeMitHerkunft(r);
    const wandListe = el("div", { class: "mauerliste wandliste", style: "margin-top:12px" });
    wl.forEach((w, i) => {
      const herkunft = w.quelle === "band" ? "BANDMASS" : w.quelle === "gezielt"
        ? `GEZIELT ± ${Math.max(1, Math.round((w.sigmaM || 0) * 100))} CM` : "EINGEGEBEN";
      const inp = el("input", { type: "text", inputmode: "decimal", placeholder: "Bandmaß", autocomplete: "off",
        "aria-label": `Wand ${i + 1} mit dem Bandmaß` });
      inp.addEventListener("change", () => {
        const n = zahl(inp.value);
        if (!(n >= 0.05 && n <= 100)) { inp.classList.add("falsch"); toast("LÄNGE IN METERN, Z. B. 4,12"); return; }
        const hinweise = nachmessen(projekt, r.id, i, n, Store.neueId);
        speichern(); if (plan) planAktualisieren();
        toast(hinweise[0] || `WAND ${i + 1}: ${komma(n, 2)} M ÜBERNOMMEN`);
        neuMalen();
      });
      wandListe.append(el("div", { class: "stein wand-stein" },
        el("span", { class: "wand-nr" }, String(i + 1)),
        el("span", { class: "stein-haupt" },
          el("span", { class: "wand-laenge" }, komma(w.laenge, 2) + " m"),
          el("span", { class: "wand-herkunft " + w.quelle }, herkunft)),
        inp));
    });
    inhalt.append(wandListe,
      el("p", { class: "hinweis-text", style: "margin-top:6px" },
        "Bandmaß eintragen, wo du nachmisst – gemessene Wände bleiben fest, der Rest wird ausgeglichen."));

    inhalt.append(el("div", { class: "feld-reihe" },
      zahlFeld("Raumhöhe (m)", r.hoeheM, n => { r.hoeheM = n; speichern(); if (plan) planAktualisieren(); }, { min: 1.5, max: 20 }),
      zahlFeld("Aufbau/Estrich (m)", aufbau(r), n => { r.aufbauM = n ?? 0; speichern(); neuMalen(); }, { min: 0, max: 0.5, leerErlaubt: true })));

    // Höhenbezug – Konzept §10
    inhalt.append(el("div", { class: "rubrik" }, "Höhenbezug"));
    inhalt.append(el("div", { class: "segmente" },
      el("button", { class: bezug === "roh" ? "an" : "", onclick: () => setBezug("roh", r) }, "Rohboden"),
      el("button", { class: bezug === "ffb" ? "an" : "", onclick: () => setBezug("ffb", r) }, "Fertigfußboden")));
    inhalt.append(el("div", { class: "bezug-bild" },
      el("div", { class: "bezug-skizze" }, el("div", { class: "bezug-belag" }), el("div", { class: "bezug-marke" }, "FFB")),
      el("div", { class: "bezug-text" }, "Estrich + Belag ", el("b", null, `${Math.round(aufbau(r) * 1000)} mm`),
        `. Alle Montagehöhen rechnen ${bezugWort()}.`)));

    // ---- Öffnungen
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:16px" }, "Türen & Fenster"));
    const eigene = projekt.oeffnungen.filter(o => o.raumId === r.id);
    if (eigene.length) {
      const ol = el("div", { class: "mauerliste" });
      for (const o of eigene) ol.append(el("button", { class: "stein", onclick: () => oeffnungSheet(r, o) },
        el("span", { class: "palette-glyph" }, artWort(o.art).slice(0, 2).toUpperCase()),
        el("span", { class: "stein-haupt" },
          el("span", { class: "stein-name", style: "font-size:15px" }, `${artWort(o.art)} · Wand ${(o.wandIndex ?? 0) + 1}`),
          el("span", { class: "stein-meta" },
            `${fmtCm(o.breiteM)} × ${fmtCm(o.hoeheM)}${Number(o.bruestungM) > 0 ? ` · Brüstung ${fmtCm(o.bruestungM)}` : ""} · ab ${komma(o.abstandM, 2)} m`))));
      inhalt.append(ol);
    } else inhalt.append(el("p", { class: "hinweis-text" }, "Noch keine Türen oder Fenster. Beim Aufmessen per Handy werden sie mit angezielt – oder hier eintragen."));
    inhalt.append(el("div", { class: "knopf-reihe", style: "margin-top:8px" },
      el("button", { class: "knopf zweit", onclick: () => oeffnungSheet(r, null, "TUER") }, "+ Tür"),
      el("button", { class: "knopf zweit", onclick: () => oeffnungSheet(r, null, "FENSTER") }, "+ Fenster")));

    inhalt.append(el("button", { class: "knopf prim", style: "margin-top:16px",
      onclick: () => { schliesseSheet(); zeigeScreen("plan"); } }, "Im Plan bearbeiten"));
    if (raeume().length > 1)
      inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: () => raumLoeschen(r) }, "Raum löschen"));
  });
}

/** Tür/Fenster anlegen oder bearbeiten – mit Norm-Vorgaben je Art. */
function oeffnungSheet(r, o, artNeu, entwurf) {
  const neu = !o;
  const n = G.wandLaengen(r).length;
  const d = entwurf || (o ? { ...o } : {
    id: Store.neueId("oef"), raumId: r.id, art: artNeu || "TUER", wandIndex: 0, abstandM: 0.3,
    ...Normmasse.oeffnung(artNeu || "TUER")
  });
  oeffneSheet(neu ? `${artWort(d.art)} hinzufügen` : `${artWort(d.art)} bearbeiten`, inhalt => {
    const artSeg = el("div", { class: "segmente" });
    for (const [k, t] of OEFF_ARTEN) artSeg.append(el("button", { class: d.art === k ? "an" : "", onclick: () => {
      if (d.art === k) return;
      d.art = k; Object.assign(d, Normmasse.oeffnung(k));      // Maße der neuen Art als Vorschlag
      schliesseSheet(true); oeffnungSheet(r, o, null, d);
    } }, t));
    inhalt.append(artSeg);
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:14px" }, "Wand"));
    const laengen = G.wandLaengen(r);
    const wandChips = el("div", { class: "presets" });
    for (let i = 0; i < n; i++) wandChips.append(el("button", { class: "preset" + (d.wandIndex === i ? " an" : ""), onclick: e => {
      d.wandIndex = i; wandChips.querySelectorAll(".preset").forEach(b => b.classList.toggle("an", b === e.currentTarget));
    } }, `W${i + 1} · ${komma(laengen[i], 2)}`));
    inhalt.append(wandChips, el("p", { class: "hinweis-text", style: "margin-top:6px" },
      "Die Nummern stehen im Plan an den Wänden (im Uhrzeigersinn); der Abstand zählt ab dem Wandanfang."));
    inhalt.append(el("div", { class: "feld-reihe" },
      zahlFeld("Abstand ab Ecke (m)", d.abstandM, v => { d.abstandM = v; }, { min: 0, max: 100 }),
      zahlFeld("Breite (m)", d.breiteM, v => { d.breiteM = v; }, { min: 0.2, max: 20 })));
    inhalt.append(el("div", { class: "feld-reihe" },
      zahlFeld("Höhe (m)", d.hoeheM, v => { d.hoeheM = v; }, { min: 0.2, max: 10 }),
      zahlFeld("Brüstung (m)", d.bruestungM, v => { d.bruestungM = v ?? 0; }, { min: 0, max: 5, leerErlaubt: true })));
    inhalt.append(el("button", { class: "knopf prim", onclick: () => {
      // Ein noch fokussiertes Feld erst festschreiben (change feuert beim Verlassen).
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      setTimeout(() => {
        const lang = laengen[d.wandIndex] || 0;
        if (d.abstandM + d.breiteM > lang + 0.01) { toast(`PASST NICHT: WAND ${d.wandIndex + 1} IST ${komma(lang, 2)} M LANG`); return; }
        if (neu) projekt.oeffnungen.push(d);
        else Object.assign(o, d);
        speichern(); if (plan) planAktualisieren();
        schliesseSheet(true); raumSheet(r);
      }, 0);
    } }, "Speichern"));
    if (!neu) inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: () => {
      projekt.oeffnungen = projekt.oeffnungen.filter(x => x.id !== o.id);
      speichern(); if (plan) planAktualisieren(); schliesseSheet(true); raumSheet(r);
    } }, "Entfernen"));
  });
}

function setBezug(b, r) {
  bezug = b;
  try { localStorage.setItem("raumwerk.bezug", b); } catch (_) {}
  schliesseSheet(true); if (r) raumSheet(r);
}
function raumLoeschen(r) {
  if (!confirm(`Raum „${r.name}“ mit allen Türen, Elementen und Fotos löschen?`)) return;
  projekt.raeume = raeume().filter(x => x.id !== r.id);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== r.id);
  projekt.einbauten = projekt.einbauten.filter(e => e.raumId !== r.id);
  projekt.fotos = projekt.fotos.filter(f => f.raumId !== r.id);
  projekt.verbindungen = projekt.verbindungen.filter(v => v.raumA !== r.id && v.raumB !== r.id);
  for (const v of projekt.varianten) v.platzhalter = v.platzhalter.filter(p => p.raumId !== r.id);
  if (projekt.aktiverRaum === r.id) projekt.aktiverRaum = raeume()[0]?.id;
  speichern(); schliesseSheet(); renderProjekte();
}

// =========================================================== PLAN
function planInit() {
  if (plan) return;
  // Blätter erst nach dem Loslassen öffnen: sonst landet der nachfolgende
  // „Klick“ des Fingers auf dem frisch eingeblendeten Schleier und schließt es.
  const spaeter = fn => setTimeout(fn, 60);
  plan = new Plan($("#planSvg"), {
    onSelect: id => { auswahl = id ? { typ: "platzhalter", id } : null; planAktualisieren(); if (id) spaeter(inspektorSheet); },
    onEinbauSelect: id => { auswahl = { typ: "einbau", id }; planAktualisieren(); spaeter(inspektorSheet); },
    onPlace: onPlace,
    onPlatzhalterMove: (id, patch) => { const p = platzhalter().find(x => x.id === id); if (p) { Object.assign(p, patch); speichern(); planAktualisieren(); } },
    onEinbauMove: (id, patch) => { const e = projekt.einbauten.find(x => x.id === id); if (e) { Object.assign(e, patch); speichern(); planAktualisieren(); } },
    onMessung: e => { flaecheKnopf(); toast(e.art === "strecke" ? `MIND. ${komma(e.laengeM, 2)} M`
      : `${komma(e.flaecheM2, 2)} M² · UMFANG ${komma(e.umfangM, 2)} M`, 4200); },
    onFotoMove: (id, patch) => { const f = projekt.fotos.find(x => x.id === id); if (f) { Object.assign(f, patch); speichern(); planAktualisieren(); } },
    onFotoOeffnen: id => { const f = projekt.fotos.find(x => x.id === id); if (f) spaeter(() => fotoSheet(f)); }
  });
  // „Fläche schließen“ erscheint, sobald drei Punkte gesetzt sind.
  $("#planSvg").addEventListener("pointerup", () => setTimeout(flaecheKnopf, 0));
}
function planZeigen() {
  planInit();
  // Erst das Modell setzen, dann einpassen – sonst passt er den vorigen Raum ein.
  planAktualisieren();
  requestAnimationFrame(() => { plan.einpassen(); flaecheKnopf(); });
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
function flaecheKnopf() {
  const k = $("#planFlaecheZu");
  if (!k || !plan) return;
  k.hidden = !(werkzeug === "messen-flaeche" && (plan.messpunkte || []).length >= 3);
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
  setWerkzeug("auswahl"); speichern(); planAktualisieren(); setTimeout(inspektorSheet, 60);
}
function setWerkzeug(m) {
  werkzeug = m;
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.classList.toggle("an", b.dataset.modus === m));
  if (plan) plan.setModus(m);
  flaecheKnopf();
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
            el("small", null, `${komma(k.breiteM, 2)}×${komma(k.tiefeM, 2)} M`))));
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
      const bef = e.befestigung || Normmasse.befestigung(e.art);
      inhalt.append(el("p", { class: "hinweis-text", style: "margin-top:14px" },
        bef === "WAND" ? `An Wand ${(e.wandIndex ?? 0) + 1}, ${komma(Number(e.abstandM) || 0, 2)} m ab Ecke · im Plan verschiebbar.`
          : `Befestigung ${bef} · im Plan verschiebbar.`));
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
      const dreh = el("button", { class: "knopf zweit", onclick: () => {
        ph.drehungGrad = ((Number(ph.drehungGrad) || 0) + 90) % 360; speichern(); planAktualisieren();
        dreh.textContent = `Drehen · ${ph.drehungGrad}°`;
      } }, `Drehen · ${Number(ph.drehungGrad) || 0}°`);
      inhalt.append(dreh);
      if (komp) inhalt.append(el("p", { class: "hinweis-text", style: "margin-top:12px" },
        `${komma(komp.breiteM, 2)} × ${komma(komp.tiefeM, 2)} × ${komma(komp.hoeheM, 2)} m · ${komp.kategorie}`));
      inhalt.append(el("button", { class: "knopf gefahr", onclick: () => {
        const arr = platzhalter(); const i = arr.findIndex(p => p.id === ph.id);
        if (i >= 0) arr.splice(i, 1); nachLoeschen();
      } }, "Löschen"));
    });
  }
}
function nachLoeschen() { auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); }

// =========================================================== SCAN (Fotos)
function renderScan() {
  const w = $("#screenScan"); w.innerHTML = "";
  const info = NAT().geraete ? NAT().geraete() : null;
  w.append(el("div", { class: "rubrik" }, "Bildserie"));
  const k = el("div", { class: "karte" });
  k.append(el("p", { class: "hinweis-text", style: "margin-top:0" },
    "Geführte Bildserie rundum – für die Dokumentation und die spätere Photogrammetrie. Die Maße des Raums kommen aus dem Aufmessen (Projekte → Raum aufnehmen); ein Referenzwürfel ist nicht nötig."));
  if (info) {
    const ir = (info.kameras || []).filter(c => c.mono).length;
    k.append(el("div", { class: "marken", style: "margin-bottom:12px" },
      el("span", { class: "marke" }, `${(info.hersteller || "").toUpperCase()} ${(info.modell || "").toUpperCase()}`.trim().slice(0, 22)),
      el("span", { class: "marke" }, `${(info.kameras || []).length} KAMERAS`),
      ir ? el("span", { class: "marke pruef" }, `${ir}× MONO/IR`) : null));
  }
  k.append(el("button", { class: "knopf prim", onclick: scanStarten }, "Bildserie starten"));
  w.append(k);

  const scans = projekt.scans || [];
  if (scans.length) {
    w.append(el("div", { class: "rubrik" }, `Aufnahmen · ${scans.length}`));
    const liste = el("div", { class: "mauerliste" });
    scans.slice().reverse().forEach(s => liste.append(el("div", { class: "befund" },
      el("div", { class: "befund-punkt ok" }),
      el("div", { class: "befund-text" },
        el("b", null, `${Number(s.anzahl) || 0} Bilder · ${Number(s.abgedeckteSektoren) || 0}/${Number(s.sektoren) || 12} Sektoren`),
        el("span", null, `${new Date(s.erstellt).toLocaleString("de-DE")}${s.wuerfelKanteM ? ` · BLOCK ${Math.round(s.wuerfelKanteM * 100)} CM` : ""}`)))));
    w.append(liste);
  }
}
async function scanStarten() {
  try {
    const mod = await import("../scan.js");
    await mod.starteScan({ raum: raum(),
      speichern: m => { projekt.scans = projekt.scans || []; projekt.scans.push(m); speichern(); },
      fotoHinzufuegen: (datenUrl, titel) => fotoAufnehmen(datenUrl, titel),
      onEnde: () => renderScan() });
  } catch (_) { toast("SCAN NICHT MÖGLICH – KAMERA NÖTIG"); }
}

// =========================================================== AR
function renderAr() {
  const w = $("#screenAr"); w.innerHTML = "";
  w.append(el("div", { class: "rubrik" }, "AR-Planung vor Ort"));
  const k = el("div", { class: "karte" });
  k.append(el("p", { class: "hinweis-text", style: "margin-top:0" },
    "Vorschau: Elemente über dem Kamerabild einblenden und mit dem Kunden besprechen. Höhen rechnen live " + bezugWort() + ". Die Ausrichtung ist eine Vorschau, kein Vermessungsergebnis."));
  k.append(el("div", { class: "bezug-bild", style: "margin-bottom:14px" },
    el("div", { class: "bezug-skizze" }, el("div", { class: "bezug-belag" }), el("div", { class: "bezug-marke" }, "FFB")),
    el("div", { class: "bezug-text" }, "Aufbau ", el("b", null, `${Math.round(aufbau() * 1000)} mm`),
      ` · ${einbautenAkt().length} Positionen im Raum `, el("b", null, raum().name || "Raum"), ".")));
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
      oeffnungen: oeffnungenAkt().concat(tuerOeffnungenRaum(raum().id)),
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
  joystickMalen();
  requestAnimationFrame(() => modell3d && modell3d.resize());
}
/** Daumen-Joystick fürs Begehen – auf dem Handy gibt es kein WASD. */
function joystickMalen() {
  const c = $("#dreidFlaeche");
  let j = c.querySelector(".joystick");
  if (modus3d !== "begehen") { if (j) j.remove(); return; }
  if (j) return;
  const knopf = el("div", { class: "joystick-knopf" });
  j = el("div", { class: "joystick", "aria-label": "Gehen" }, knopf);
  c.append(j);
  let id = null;
  const setze = (x, z) => { if (modell3d) modell3d.setPad(x, z); knopf.style.transform = `translate(${x * 34}px, ${-z * 34}px)`; };
  j.addEventListener("pointerdown", e => { id = e.pointerId; j.setPointerCapture(e.pointerId); bewege(e); e.stopPropagation(); });
  j.addEventListener("pointermove", e => { if (e.pointerId === id) bewege(e); });
  const los = () => { id = null; setze(0, 0); };
  j.addEventListener("pointerup", los); j.addEventListener("pointercancel", los);
  function bewege(e) {
    const r = j.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), z = -(e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    setze(x, z);
  }
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

  w.append(el("div", { class: "knopf-reihe", style: "margin-bottom:14px" },
    el("button", { class: "knopf prim", onclick: fotoWaehlen }, "Foto aufnehmen"),
    el("button", { class: "knopf zweit", onclick: reportErzeugen }, "Report (PDF)")));

  w.append(el("div", { class: "rubrik" }, "Verortete Fotos"));
  if (!fotos.length) {
    w.append(el("div", { class: "karte leer" }, "Noch keine Fotos in diesem Raum. Typenschilder, Klemmen, Leitungswege – ein Foto spart die zweite Anfahrt."));
  } else {
    for (const f of fotos) {
      const karte = el("button", { class: "karte status status-warn foto-karte", style: "padding:0;overflow:hidden;width:100%;text-align:left",
        onclick: () => fotoSheet(f) });
      if (bildUrlOk(f.datenUrl)) karte.append(el("img", { src: f.datenUrl, alt: "",
        style: "display:block;width:100%;height:150px;object-fit:cover" }));
      karte.append(el("div", { style: "padding:11px 13px" },
        el("div", { class: "karte-titel", style: "font-size:16px" }, f.titel || "Foto"),
        f.notiz ? el("div", { class: "hinweis-text", style: "margin:3px 0 0" }, f.notiz) : null));
      w.append(karte);
    }
  }
}

const bildUrlOk = u => typeof u === "string" && /^data:image\/(png|jpe?g|webp|gif)[;,]/.test(u);

function fotoWaehlen() {
  // Ohne „capture": Android bietet Kamera UND Galerie an (Typenschild-Foto liegt oft schon vor).
  const inp = el("input", { type: "file", accept: "image/*", multiple: "", style: "display:none" });
  inp.addEventListener("change", async () => {
    const dateien = [...(inp.files || [])];
    inp.remove();
    for (const d of dateien) {
      try { fotoAufnehmen(await bildSkaliert(d), d.name.replace(/\.[^.]+$/, "")); }
      catch (_) { toast("BILD NICHT LESBAR"); }
    }
    renderDoku();
  });
  document.body.append(inp); inp.click();
}
/** Foto ins Projekt – als Pin in der Raummitte; im Plan an die Stelle ziehen. */
function fotoAufnehmen(datenUrl, titel) {
  if (!bildUrlOk(datenUrl)) return null;
  const f = { id: Store.neueId("foto"), raumId: raum().id, relX: 0.5, relY: 0.5,
    titel: titel || `Foto ${fotosAkt().length + 1}`, datenUrl, notiz: "" };
  projekt.fotos.push(f);
  speichern();
  toast("FOTO GESPEICHERT · PIN IM PLAN AN DIE STELLE ZIEHEN", 3500);
  return f;
}
/** Bild einlesen und verkleinern – hält den Gerätespeicher klein. */
function bildSkaliert(datei, maxKante = 1280, qualitaet = 0.75) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxKante / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", qualitaet));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bild")); };
    img.src = url;
  });
}
function fotoSheet(f) {
  oeffneSheet(f.titel || "Foto", inhalt => {
    if (bildUrlOk(f.datenUrl)) inhalt.append(el("img", { src: f.datenUrl, alt: "", class: "foto-gross" }));
    inhalt.append(textFeld("Titel", f.titel, v => { f.titel = v; speichern(); }));
    inhalt.append(el("div", { class: "feld" }, el("label", null, "Notiz"),
      el("textarea", { rows: "3", class: "notiz", oninput: e => { f.notiz = e.target.value; speichern(); } }, f.notiz || "")));
    inhalt.append(el("button", { class: "knopf zweit", onclick: () => { schliesseSheet(); zeigeScreen("plan"); toast("PIN AN DIE STELLE ZIEHEN"); } }, "Im Plan verorten"));
    inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: () => {
      if (!confirm("Foto löschen?")) return;
      projekt.fotos = projekt.fotos.filter(x => x.id !== f.id); speichern(); schliesseSheet();
      if (screen === "doku") renderDoku(); else planAktualisieren();
    } }, "Foto löschen"));
  });
}

// =========================================================== Menü/Projekt
function menueSheet() {
  oeffneSheet("Projekt", inhalt => {
    inhalt.append(textFeld("Projektname", projekt.name, v => { projekt.name = v; speichern(); }));
    inhalt.append(el("div", { class: "rubrik" }, "Variante · " + Store.aktiveVariante(projekt).name));
    const liste = el("div", { class: "mauerliste" });
    projekt.varianten.forEach((v, i) => liste.append(el("button", { class: "stein",
      onclick: () => { projekt.aktiveVariante = i; auswahl = null; speichern(); schliesseSheet(); planAktualisieren(); } },
      el("span", { class: "stein-haupt" }, el("span", { class: "stein-name", style: "font-size:15px" }, v.name)),
      el("span", { class: "karte-wert" }, i === projekt.aktiveVariante ? "AKTIV" : `${v.platzhalter.length}`))));
    inhalt.append(liste);
    inhalt.append(el("div", { class: "knopf-reihe", style: "margin-top:12px" },
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteKlonen(projekt); speichern(); schliesseSheet(true); menueSheet(); } }, "Duplizieren"),
      el("button", { class: "knopf zweit", onclick: () => { Store.varianteNeu(projekt); speichern(); schliesseSheet(true); menueSheet(); } }, "Neu")));
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:18px" }, "Weitergeben"));
    inhalt.append(el("button", { class: "knopf prim", onclick: reportErzeugen }, "Report als PDF (alle Räume)"));
    inhalt.append(el("div", { class: "knopf-reihe", style: "margin-top:10px" },
      el("button", { class: "knopf zweit", onclick: exportieren }, "Export / Teilen"),
      el("button", { class: "knopf zweit", onclick: importieren }, "Import")));
    inhalt.append(el("div", { class: "rubrik", style: "margin-top:18px" }, "Neu beginnen"));
    inhalt.append(el("button", { class: "knopf zweit", onclick: neuesProjekt }, "Neues leeres Projekt"));
    inhalt.append(el("button", { class: "knopf gefahr", style: "margin-top:10px", onclick: zuruecksetzen }, "Beispielprojekt laden"));
  });
}
function reportErzeugen() {
  schliesseSheet();
  try { berichtOeffnen(projekt, {}); }
  catch (_) { toast("REPORT NICHT MÖGLICH"); }
}
function dateiName(endung) {
  return (projekt.name || "raumwerk").replace(/[^\wäöüÄÖÜß\-]+/g, "_").slice(0, 60) + endung;
}
function exportieren() {
  schliesseSheet();
  const n = NAT();
  const text = JSON.stringify(projekt, null, 2);
  const p = n.teilen ? n.teilen(dateiName(".json"), "application/json", text) : Promise.resolve(false);
  p.then(ok => toast(ok ? "PROJEKT WEITERGEGEBEN" : "EXPORT NICHT MÖGLICH"));
}
function importieren() {
  const inp = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let neu;
      try { neu = Store.ausObjektStreng(JSON.parse(r.result)); }
      catch (e) { alert("Die Datei ist kein gültiges RAUMWERK-Projekt.\n" + (e && e.message ? e.message : "")); return; }
      if (!confirm(`Projekt „${neu.name || "ohne Namen"}“ (${neu.raeume.length} Räume) laden? Der aktuelle Stand wird vorher gesichert.`)) return;
      Store.vorherSichern(projekt);
      projekt = neu; auswahl = null; speichern(); schliesseSheet(); zeigeScreen("projekte");
      toast("PROJEKT GELADEN");
    };
    r.readAsText(f);
  });
  document.body.append(inp); inp.click();
}
function neuesProjekt() {
  if (!confirm("Neues, leeres Projekt beginnen? Der aktuelle Stand wird gesichert – exportiere ihn vorher, wenn du ihn behalten willst.")) return;
  Store.vorherSichern(projekt);
  projekt = Store.leeresProjekt("Neues Projekt"); auswahl = null; paletteWahl = einbauWahl = null;
  speichern(); schliesseSheet(); zeigeScreen("projekte");
  raumSheet(raum());
}
function zuruecksetzen() {
  if (!confirm("Beispielprojekt laden? Der aktuelle Stand wird gesichert, aber ersetzt.")) return;
  Store.vorherSichern(projekt);
  projekt = Store.beispielProjekt(); auswahl = null; paletteWahl = einbauWahl = null;
  speichern(); schliesseSheet(); zeigeScreen("projekte");
}

// =========================================================== Sheet
let sheetEls = null;
function oeffneSheet(titel, bau) {
  schliesseSheet(true);
  const offenSeit = performance.now();
  // Ein Klick unmittelbar nach dem Öffnen ist der Rest der Geste, die das
  // Blatt geöffnet hat – nicht der Wunsch, es zu schließen.
  const schleier = el("div", { class: "sheet-schleier", onclick: () => { if (performance.now() - offenSeit > 450) schliesseSheet(); } });
  const inhalt = el("div", { class: "sheet-inhalt" });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-label": titel },
    el("div", { class: "sheet-griff" }),
    el("div", { class: "sheet-kopf" }, el("h3", null, titel),
      el("button", { class: "sheet-zu", onclick: () => schliesseSheet(), "aria-label": "Schließen",
        html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>` })),
    inhalt);
  document.body.append(schleier, sheet);
  bau(inhalt);
  requestAnimationFrame(() => { schleier.classList.add("zeig"); sheet.classList.add("zeig"); });
  sheetEls = { schleier, sheet };
}
function schliesseSheet(sofort = false) {
  if (!sheetEls) return;
  const { schleier, sheet } = sheetEls; sheetEls = null;
  if (sofort) { schleier.remove(); sheet.remove(); return; }
  schleier.classList.remove("zeig"); sheet.classList.remove("zeig");
  setTimeout(() => { schleier.remove(); sheet.remove(); }, 240);
}

// =========================================================== Toast
let toastT = 0;
function toast(t, dauer = 2600) {
  let n = $("#toast");
  if (!n) { n = el("div", { id: "toast", class: "toast", role: "status" }); document.body.append(n); }
  n.textContent = t; n.classList.add("zeig");
  clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove("zeig"), dauer);
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
  $("#planFlaecheZu").onclick = () => { if (plan && plan.messungAbschliessen) plan.messungAbschliessen(); flaecheKnopf(); };
  document.querySelectorAll("#planWerkzeuge button").forEach(b => b.onclick = () => setWerkzeug(b.dataset.modus));
  document.querySelectorAll("#dreidModus button").forEach(b => b.onclick = () => {
    modus3d = b.dataset.modus;
    document.querySelectorAll("#dreidModus button").forEach(x => x.classList.toggle("an", x === b));
    if (modell3d) modell3d.setMode(modus3d);
    joystickMalen();
  });
  window.addEventListener("online", syncMalen);
  window.addEventListener("offline", syncMalen);
  window.addEventListener("resize", () => {
    if (screen === "plan" && plan) plan.einpassen();
    if (screen === "3d" && modell3d) modell3d.resize();
  });
  // Zurück-Taste (App): erst Blatt/Menü schließen, dann zur Projektliste.
  const n = NAT();
  if (n.beiZurueck) n.beiZurueck(() => {
    if (assistentOffen) return false;          // der Assistent hat einen eigenen Hörer
    if (sheetEls) { schliesseSheet(); return true; }
    if (drawerEls) { schliesseDrawer(); return true; }
    if (screen !== "projekte") { zeigeScreen("projekte"); return true; }
    return false;
  });
}

verdrahten();
syncMalen();
zeigeScreen("projekte");
