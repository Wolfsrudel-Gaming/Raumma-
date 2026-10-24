/*
 * AR-Besprechung / Elektro-Planung vor Ort.
 *
 * Zweck: am PC den Elektroplan zeichnen (wo kommt welche Steckdose, welcher
 * Schalter, welche Leuchte hin – jeweils auf welcher Höhe), dann vor Ort mit
 * dem Kunden die Einbauten an die echte Wand setzen und die Höhen prüfen.
 *
 * Ablauf im Magic-Window (Kamerabild + Lagesensor, ohne ARCore):
 *  1. **Ausrichten**: eine Wand des aufgemessenen Raums wählen (Standard: die
 *     längste), mit dem Fadenkreuz erst ihre linke, dann ihre rechte
 *     Bodenecke anzielen und auslösen (Knopf oder Lautstärketaste). Mit der
 *     Kamerahöhe ergibt jedes Zielen einen Bodenpunkt; zwei Punkte legen
 *     Standpunkt und Drehung im Raum fest, und die bekannte Wandlänge eicht
 *     die Kamerahöhe (web/ausrichten.js).
 *  2. **Vorschau**: Die Kamera bleibt am Standpunkt und dreht nur noch mit
 *     dem Lagesensor (App: Spiel-Rotationsvektor, Browser: deviceorientation,
 *     beides über window.__native.beiLage – dieselbe Lage, mit der auch
 *     zielen.js rechnet). Das Fadenkreuz setzt Einbauten: Der Zielstrahl
 *     trifft die Wand (Wand, Abstand, Höhe), die Decke oder den Boden.
 *  Ohne Lagesensor: Ansicht von Hand (ziehen = drehen, zwei Finger = schieben).
 *  WebXR-Welttracking bleibt als Aufwertung, wo das Gerät es kann.
 *
 * Zwei Dinge sind für Elektro entscheidend und hier eingebaut:
 *  · **Bodenaufbau / Estrich** (`raum.aufbauM`): Höhen zählen ab dem *fertigen*
 *    Boden. Der fertige Boden liegt als Ebene über dem Rohboden; jeder Einbau
 *    sitzt um den Aufbau höher, als das nackte Kamerabild es zeigt.
 *  · **Kamerahöhe**: Sie wird beim Ausrichten aus der Wandlänge geeicht und
 *    gilt über dem Boden, der im Bild zu sehen ist (Rohboden oder fertiger
 *    Boden).
 *
 * Ehrlich bleiben: Das ist eine Vorschau am echten Raum, ausgerichtet an zwei
 * gezielten Ecken – kein Vermessungsergebnis.
 *
 * three.js-Welt: x = Raum-x, y = Höhe über Rohboden, z = Raum-y (Meter).
 */

import * as THREE from "../lib/three.module.min.js";
import * as Geometrie from "../geometrie.js";
import * as Normmasse from "../normmasse.js";
import * as Z from "../zielen.js";
import * as Au from "../ausrichten.js";
import { pruefe, grundriss } from "../pruefung.js";
import { fuer, Richtung } from "../regelwerk.js";

// Einbau-Arten, die in der AR-Palette angeboten werden (Elektro-Schwerpunkt).
const PALETTE = ["STECKDOSE", "STECKDOSE_2FACH", "SCHALTER", "WECHSELSCHALTER",
  "TASTER", "NETZWERKDOSE", "LAMPE", "WANDLEUCHTE", "RAUCHMELDER", "SICHERUNGSKASTEN"];

const SCHLUESSEL_HOEHE = "raumwerk.kamerahoehe";       // geteilt mit dem Aufmaß-Assistenten
const SCHLUESSEL_BILDWINKEL = "raumwerk.bildwinkel";

const FARBE = {
  umriss: 0xe8b44a, kante: 0xf1e9dd, boden: 0xcfe8e9, geraet: 0x2b7a78, geraetKante: 0x17494d,
  warn: 0xc0392b, zone: 0x2e8b57, einbau: 0x3a6ea5, wahl: 0xffa500, ziel: 0xe8b44a,
  oeffnung: 0x7fbf4d
};

export async function xrMoeglich() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar")); }
  catch (_) { return false; }
}

export async function starte(opts) {
  const raum = opts.raum;
  const phs = opts.platzhalter || [];
  const einbauten = (opts.einbauten || []).slice();   // eigene Liste, Objekt-Refs
  const oeffnungen = (opts.oeffnungen || []).filter(o => o && Number(o.breiteM) > 0);
  const finde = opts.findeKomponente;
  const aufbau = () => Number(raum.aufbauM) || 0;
  const raumHoehe = () => Number(raum.hoeheM) || 2.5;
  const deckeZ = () => aufbau() + raumHoehe();        // lichte Höhe zählt ab fertigem Boden
  const eckenR = Geometrie.ecken(raum);
  const nat = window.__native || null;
  const weg = [];                                    // Abmeldungen fürs Beenden
  const aenderung = () => opts.onAenderung && opts.onAenderung();

  const st = {
    modus: "ausrichten",            // "ausrichten" | "ausgerichtet" | "hand"
    wand: Au.laengsteWand(eckenR),
    ecke1: null, ecke2: null,       // gezielte Blickrichtungen (Sensorwelt)
    pose: null,                     // Ergebnis von Au.loese
    hoeheVonHand: false,            // Kamerahöhe nach dem Ausrichten von Hand gesetzt
    kamerahoehe: gespeicherteHoehe(),
    bildwinkel: gespeicherterBildwinkel(),
    bodenRoh: aufbau() > 0,         // Estrich fehlt noch: im Bild ist der Rohboden
    gierKorr: 0, versatz: [0, 0],   // Feinjustage nach dem Ausrichten
    hand: null,                     // { x, y, gier, neigung } – Ansicht ohne Sensor
    handAuto: false, handBenutzt: false,
    lage: null, qGeraet: null, puffer: [], sensor: false,
    meldung: "", laeuft: true, xrSession: null, kamera: null, raf: 0
  };

  const overlay = document.createElement("div");
  overlay.className = "ar-overlay";
  overlay.innerHTML = `
    <style>${STIL}</style>
    <video class="ar-video" playsinline muted autoplay></video>
    <canvas class="ar-canvas"></canvas>
    <div class="ar-ui">
      <div class="ar-kreuz" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="ar-ziel" hidden></div>
      <div class="ar-oben">
        <div class="ar-palette"></div>
        <div class="ar-titel" hidden><b>Ausrichten</b><span></span></div>
        <button class="ar-zu">Beenden</button>
      </div>
      <div class="ar-stand" hidden></div>
      <div class="ar-hinweis"></div>
      <div class="ar-hoehe" hidden>
        <span class="ar-hoehe-name"></span>
        <input class="ar-hoehe-range" type="range" min="0" max="2.5" step="0.01">
        <span class="ar-hoehe-wert"></span>
      </div>
      <div class="ar-regler">
        <div class="ar-ausr">
          <div class="ar-waende"></div>
          <div class="ar-ausr-mitte">
            <svg class="ar-mini" viewBox="0 0 120 84" aria-label="Grundriss mit gewählter Wand"></svg>
            <div class="ar-felder">
              <label class="ar-feld">Kamerahöhe <span><input class="ar-kamh" type="text" inputmode="decimal" autocomplete="off"> m</span></label>
              <label class="ar-feld">Bildwinkel <span><input class="ar-bw" type="text" inputmode="numeric" autocomplete="off"> °</span></label>
              <label class="ar-roh" hidden><input type="checkbox" class="ar-roh-an"> Estrich fehlt – Rohboden im Bild</label>
            </div>
          </div>
          <div class="ar-knoepfe">
            <button class="ar-knopf ar-neben ar-rueck" title="Letzte Ecke verwerfen">↶</button>
            <button class="ar-knopf ar-haupt ar-ausloeser">Ecke 1 auslösen</button>
            <button class="ar-knopf ar-neben ar-ohne" title="Ohne Lagesensor von Hand ausrichten">Von Hand</button>
          </div>
        </div>
        <div class="ar-plan" hidden>
          <div class="ar-knoepfe">
            <button class="ar-knopf ar-neben ar-neu">Neu ausrichten</button>
            <button class="ar-knopf ar-haupt ar-setzen" disabled>Setzen</button>
            <button class="ar-xr" hidden>Welt-Tracking</button>
          </div>
          <details class="ar-fein"><summary>Feinjustage</summary>
            <div class="ar-fein-knoepfe">
              <button data-fein="dreh-l" title="Modell nach links drehen">⟲</button>
              <button data-fein="dreh-r" title="Modell nach rechts drehen">⟳</button>
              <button data-fein="links" title="Modell nach links schieben">←</button>
              <button data-fein="rechts" title="Modell nach rechts schieben">→</button>
              <button data-fein="weg" title="Modell weiter weg schieben">↑</button>
              <button data-fein="her" title="Modell näher heranholen">↓</button>
            </div>
            <label>Kamerahöhe <input class="ar-kam" type="range" min="0.5" max="2.2" step="0.01"> <span class="ar-kam-wert"></span></label>
            <label>Bildwinkel <input class="ar-bw2" type="range" min="40" max="110" step="1"> <span class="ar-bw-wert"></span></label>
          </details>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = s => overlay.querySelector(s);
  const video = $(".ar-video");
  const canvas = $(".ar-canvas");
  const ui = $(".ar-ui");
  const hinweis = $(".ar-hinweis");
  const hoehePanel = $(".ar-hoehe");
  const zielEl = $(".ar-ziel");

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); }
  catch (e) { overlay.remove(); throw e; }    // ohne WebGL kein halbes Overlay stehen lassen
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2));
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.rotation.order = "YXZ";

  // Alles in Raumkoordinaten; im Magic-Window ist die Gruppe die Welt selbst,
  // unter WebXR wird sie an den Startpunkt der Sitzung gelegt.
  const raumGruppe = new THREE.Group();
  scene.add(raumGruppe);

  let auswahl = null;    // { typ: "einbau"|"box", id }
  let armiert = null;    // Einbau-Art zum Setzen

  // ------------------------------------------------------------ Raummodell

  // Rohboden-Umriss (dünn) und fertiger Boden als Ebene über dem Rohboden.
  const rohLinie = eckenR.map(([x, y]) => new THREE.Vector3(x, 0.002, y));
  rohLinie.push(rohLinie[0].clone());
  raumGruppe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rohLinie),
    new THREE.LineBasicMaterial({ color: FARBE.geraet })));
  const bodenForm = new THREE.Shape(eckenR.map(([x, y]) => new THREE.Vector2(x, y)));
  const fertigBoden = new THREE.Mesh(new THREE.ShapeGeometry(bodenForm),
    new THREE.MeshBasicMaterial({ color: FARBE.boden, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
  fertigBoden.rotation.x = Math.PI / 2;
  fertigBoden.position.y = aufbau() + 0.001;
  raumGruppe.add(fertigBoden);

  // Raumkanten als schmale Balken – 1-px-Linien sind auf dem Handy kaum zu sehen.
  const umriss = new THREE.Group();
  raumGruppe.add(umriss);
  const matBoden = new THREE.MeshBasicMaterial({ color: FARBE.umriss, transparent: true, opacity: 0.95 });
  const matKante = new THREE.MeshBasicMaterial({ color: FARBE.kante, transparent: true, opacity: 0.6 });
  const matOeffnung = new THREE.MeshBasicMaterial({ color: FARBE.oeffnung, transparent: true, opacity: 0.9 });
  function umrissBauen() {
    for (const m of umriss.children.slice()) { umriss.remove(m); m.geometry.dispose(); }
    const zb = bodenZ() + 0.004, zd = deckeZ();
    eckenR.forEach((a, i) => {
      const b = eckenR[(i + 1) % eckenR.length];
      umriss.add(balken([a[0], zb, a[1]], [b[0], zb, b[1]], 0.02, matBoden));
      umriss.add(balken([a[0], zd, a[1]], [b[0], zd, b[1]], 0.012, matKante));
      umriss.add(balken([a[0], 0, a[1]], [a[0], zd, a[1]], 0.012, matKante));
    });
    // Türen und Fenster als Rahmen auf ihrer Wand – Orientierung im Kamerabild
    // und Kontrolle, ob die Ausrichtung stimmt. Höhen zählen ab fertigem Boden.
    for (const o of oeffnungen) {
      const r = oeffnungRahmen(o);
      if (!r) continue;
      const [p0, p1] = r.unten, [p2, p3] = r.oben;
      umriss.add(balken(p0, p1, 0.015, matOeffnung), balken(p2, p3, 0.015, matOeffnung),
        balken(p0, p2, 0.015, matOeffnung), balken(p1, p3, 0.015, matOeffnung));
    }
  }

  function oeffnungRahmen(o) {
    const n = eckenR.length;
    const i = Number(o.wandIndex);
    if (!n || !Number.isInteger(i) || i < 0 || i >= n) return null;
    const a = eckenR[i], b = eckenR[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len <= 0) return null;
    const von = Math.max(0, Math.min(len, Number(o.abstandM) || 0));
    const bis = Math.max(von, Math.min(len, von + Number(o.breiteM)));
    if (bis - von < 0.05) return null;
    // 1 cm in den Raum abrücken, damit der Rahmen nicht in der Wand verschwindet.
    const mx = eckenR.reduce((s, p) => s + p[0], 0) / n, my = eckenR.reduce((s, p) => s + p[1], 0) / n;
    let nx = -dy / len, ny = dx / len;
    if ((mx - a[0]) * nx + (my - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
    const fenster = o.art === "FENSTER";
    const br = o.bruestungM == null || o.bruestungM === "" ? NaN : Number(o.bruestungM);
    const unten = aufbau() + (Number.isFinite(br) ? br : fenster ? 0.9 : 0);
    const hoehe = Number(o.hoeheM) > 0 ? Number(o.hoeheM) : (fenster ? 1.2 : 2.01);
    const oben = Math.min(deckeZ(), unten + hoehe);
    const punkt = (t, z) => [a[0] + dx / len * t + nx * 0.01, z, a[1] + dy / len * t + ny * 0.01];
    return { unten: [punkt(von, unten), punkt(bis, unten)], oben: [punkt(von, oben), punkt(bis, oben)] };
  }

  // Geräte-Klötzchen (Kontext) + Freiraumzonen.
  const boxen = new Map();
  let zonen = [];
  for (const ph of phs) {
    const komp = finde(ph.komponente); if (!komp) continue;
    const b = Number(komp.breiteM), t = Number(komp.tiefeM), h = Number(komp.hoeheM);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b, h, t),
      new THREE.MeshBasicMaterial({ color: FARBE.geraet, transparent: true, opacity: 0.35 }));
    mesh.rotation.y = -(Number(ph.drehungGrad) || 0) * Math.PI / 180;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: FARBE.geraetKante }));
    mesh.add(edges);
    mesh.userData = { phId: ph.id, h, edges, warn: false };
    raumGruppe.add(mesh);
    boxen.set(ph.id, mesh);
  }

  // Einbauten (Elektro) als Wandmarker mit Steg = Höhe über fertigem Boden.
  const marker = new Map();
  for (const e of einbauten) baueMarker(e);

  // Vorschau: wo der Einbau im Fadenkreuz landen würde.
  const zielMarke = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03),
    new THREE.MeshBasicMaterial({ color: FARBE.ziel, transparent: true, opacity: 0.75, depthTest: false }));
  zielMarke.visible = false;
  raumGruppe.add(zielMarke);

  // ---------------------------------------------------------- Aufbau/Höhen

  function bodenZ() { return st.bodenRoh ? 0 : aufbau(); }
  function gespeicherterNeigungsfehler() {
    try { const g = JSON.parse(localStorage.getItem("raumwerk.geraet") || "null"); return g && Number.isFinite(g.neigungsfehlerGrad) ? g.neigungsfehlerGrad : 0; }
    catch (_) { return 0; }
  }
  function kamerahoeheJetzt() { return st.modus === "ausgerichtet" && st.pose ? st.pose.kamerahoeheM : st.kamerahoehe; }
  function augeZ() { return bodenZ() + kamerahoeheJetzt(); }

  function hoeheEinbau(e) {
    if (e.hoeheM != null && e.hoeheM !== "") return Number(e.hoeheM);
    const bef = e.befestigung || Normmasse.befestigung(e.art);
    if (bef === "DECKE") return raumHoehe();
    if (bef === "BODEN") return 0;
    const h = Normmasse.hoehe(e.art);
    return h == null ? raumHoehe() : h;
  }

  function einbauPos(e) {
    const l = Geometrie.lageImRaum(raum, e);
    return { x: l.x, z: l.y, h: aufbau() + hoeheEinbau(e), winkel: l.winkel };
  }

  function baueMarker(e) {
    const grp = new THREE.Group();
    const stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: FARBE.einbau }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.04),
      new THREE.MeshBasicMaterial({ color: FARBE.einbau }));
    box.userData = { einbauId: e.id };
    grp.add(stem, box);
    raumGruppe.add(grp);
    marker.set(e.id, { grp, box, stem, e });
    markerAktualisieren(e);
  }

  function markerAktualisieren(e) {
    const m = marker.get(e.id); if (!m) return;
    const p = einbauPos(e);
    m.box.position.set(p.x, p.h, p.z);
    m.box.rotation.set(0, -(p.winkel || 0) * Math.PI / 180, 0);   // flach an der Wand
    m.stem.geometry.setFromPoints([new THREE.Vector3(p.x, aufbau(), p.z), new THREE.Vector3(p.x, p.h, p.z)]);
    const farbe = auswahl?.typ === "einbau" && auswahl.id === e.id ? FARBE.wahl : FARBE.einbau;
    m.box.material.color.setHex(farbe);
    m.stem.material.color.setHex(farbe);
  }

  // ---------------------------------------------------- Normprüfung (Boxen)

  function neuBewerten() {
    const befunde = pruefe(raum, phs);
    const warn = {};
    befunde.forEach(b => { if (b.schwere === "WARNUNG") warn[b.platzhalterId] = true; });
    for (const [id, mesh] of boxen) {
      mesh.userData.warn = !!warn[id];
      mesh.material.color.setHex(warn[id] ? FARBE.warn : FARBE.geraet);
      mesh.userData.edges.material.color.setHex(auswahl?.typ === "box" && auswahl.id === id ? FARBE.wahl : (warn[id] ? FARBE.warn : FARBE.geraetKante));
      // Geräte stehen auf dem fertigen Boden.
      mesh.position.set(Number(boxPh(id).xM), aufbau() + mesh.userData.h / 2, Number(boxPh(id).yM));
    }
    for (const z of zonen) { raumGruppe.remove(z); z.geometry.dispose(); z.material.dispose(); }
    zonen = [];
    for (const ph of phs) {
      const komp = finde(ph.komponente); if (!komp) continue;
      const pts = zonePunkte(ph, komp); if (!pts) continue;
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])))),
        new THREE.MeshBasicMaterial({ color: warn[ph.id] ? FARBE.warn : FARBE.zone, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = Math.PI / 2; mesh.position.y = aufbau() + 0.004;
      raumGruppe.add(mesh); zonen.push(mesh);
    }
  }
  const boxPh = id => phs.find(p => p.id === id);

  function zonePunkte(ph, komp) {
    const regel = fuer(komp.kategorie).find(r => r.richtung === Richtung.VORNE);
    if (!regel || !komp.bedienseiteVorn) return null;
    const e = grundriss(ph, komp);
    const bl = e[0], fr = e[2], fl = e[3];
    const nx = fl[0] - bl[0], ny = fl[1] - bl[1];
    const len = Math.hypot(nx, ny) || 1, d = Number(regel.abstandM);
    return [fr, fl, [fl[0] + nx / len * d, fl[1] + ny / len * d], [fr[0] + nx / len * d, fr[1] + ny / len * d]];
  }

  // ------------------------------------------------------------ Oberfläche

  function statusText() {
    let t;
    if (st.modus === "ausrichten") {
      t = `<b>Ausrichten an Wand ${st.wand + 1}</b> – Vorschau am echten Raum, kein Vermessungsergebnis.<br>`
        + (st.ecke1
          ? "Jetzt die <b>rechte Bodenecke</b> dieser Wand (Ecke 2) ins Fadenkreuz, ruhig halten, auslösen."
          : "Von innen gesehen die <b>linke Bodenecke</b> dieser Wand (Ecke 1) ins Fadenkreuz, ruhig halten, auslösen.")
        + (nat && nat.app ? " Auch mit der Lautstärketaste." : "");
    } else {
      const bef = pruefe(raum, phs).filter(b => b.schwere === "WARNUNG").length;
      t = `Estrich/Aufbau ${Math.round(aufbau() * 100)} cm · Höhen ab fertigem Boden<br>`
        + (armiert ? `„${Normmasse.ARTEN.get(armiert) || armiert}“: Fadenkreuz auf die Stelle, „Setzen“`
          : auswahl ? "Verschieben: Fadenkreuz auf die neue Stelle, „Hierher“ – oder Höhe unten einstellen"
            : "Oben ein Element wählen – oder einen Einbau antippen")
        + (bef ? ` · <b>${bef} Geräte-Warnung</b>` : "");
    }
    if (st.meldung) t += `<span class="ar-meldung">${st.meldung}</span>`;
    hinweis.innerHTML = t;
    // Ehrlich, oben und immer sichtbar: was diese Ansicht ist – und was nicht.
    const stand = $(".ar-stand");
    stand.hidden = st.modus === "ausrichten";
    stand.textContent = st.modus === "hand"
      ? "Vorschau, von Hand ausgerichtet – kein Vermessungsergebnis. Ziehen dreht, zwei Finger verschieben."
      : "Vorschau am echten Raum, ausgerichtet an zwei gezielten Ecken – kein Vermessungsergebnis.";
  }

  function oberflaeche() {
    const ausr = st.modus === "ausrichten";
    $(".ar-ausr").hidden = !ausr;
    $(".ar-plan").hidden = ausr;
    $(".ar-palette").hidden = ausr;
    $(".ar-titel").hidden = !ausr;
    $(".ar-titel span").textContent = st.ecke1 ? "Ecke 2 von 2" : "Ecke 1 von 2";
    $(".ar-ausloeser").textContent = st.ecke1 ? "Ecke 2 auslösen" : "Ecke 1 auslösen";
    $(".ar-rueck").disabled = !st.ecke1;
    $(".ar-waende").querySelectorAll(".ar-chip").forEach((b, i) => b.classList.toggle("aktiv", i === st.wand));
    $(".ar-neu").textContent = st.modus === "hand" && !st.sensor ? "Ausrichten" : "Neu ausrichten";
    $(".ar-kam").value = String(kamerahoeheJetzt());
    $(".ar-kam-wert").textContent = `${komma(kamerahoeheJetzt())} m`;
    $(".ar-bw2").value = String(st.bildwinkel);
    $(".ar-bw-wert").textContent = `${Math.round(st.bildwinkel)}°`;
    miniMalen();
    setzenKnopf();
    statusText();
  }

  function setzenKnopf() {
    const k = $(".ar-setzen");
    if (armiert) { k.disabled = false; k.textContent = `${Normmasse.ARTEN.get(armiert) || armiert} setzen`; }
    else if (auswahl) { k.disabled = false; k.textContent = "Hierher verschieben"; }
    else { k.disabled = true; k.textContent = "Setzen"; }
  }

  /** Kleiner Grundriss: gewählte Wand, Ecke 1 links, Ecke 2 rechts (von innen). */
  function miniMalen() {
    const svg = $(".ar-mini");
    const xs = eckenR.map(p => p[0]), ys = eckenR.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const bx = Math.max(Math.max(...xs) - minX, 0.1), by = Math.max(Math.max(...ys) - minY, 0.1);
    const W = 120, H = 84, rand = 11;
    const s = Math.min((W - 2 * rand) / bx, (H - 2 * rand) / by);
    const ox = (W - bx * s) / 2, oy = (H - by * s) / 2;
    const P = p => [ox + (p[0] - minX) * s, oy + (p[1] - minY) * s].map(v => Math.round(v * 10) / 10);
    const pts = eckenR.map(P), n = eckenR.length;
    const a = pts[st.wand], b = pts[(st.wand + 1) % n];
    svg.innerHTML = `<polygon class="ar-mini-raum" points="${pts.map(p => p.join(",")).join(" ")}"/>`
      + `<line class="ar-mini-wand" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`
      + `<circle class="ar-mini-ecke${st.ecke1 ? " voll" : ""}" cx="${a[0]}" cy="${a[1]}" r="6.5"/><text x="${a[0]}" y="${a[1] + 3}">1</text>`
      + `<circle class="ar-mini-ecke" cx="${b[0]}" cy="${b[1]}" r="6.5"/><text x="${b[0]}" y="${b[1] + 3}">2</text>`;
  }

  // ------------------------------------------------------------ Palette

  const paletteEl = $(".ar-palette");
  paletteEl.innerHTML = PALETTE.map(a => `<button class="ar-chip" data-art="${a}">${Normmasse.ARTEN.get(a) || a}</button>`).join("");
  function paletteMalen() {
    paletteEl.querySelectorAll(".ar-chip").forEach(b =>
      b.classList.toggle("aktiv", b.getAttribute("data-art") === armiert));
  }
  paletteEl.querySelectorAll(".ar-chip").forEach(b => b.onclick = () => {
    const a = b.getAttribute("data-art");
    armiert = armiert === a ? null : a;
    auswahl = null; st.meldung = "";
    if (armiert) $(".ar-fein").open = false;   // Fadenkreuz frei halten
    for (const [, m] of marker) markerAktualisieren(m.e);
    neuBewerten(); hoehePanelZeigen(); paletteMalen(); setzenKnopf(); statusText();
  });

  // Wände zum Ausrichten.
  $(".ar-waende").innerHTML = eckenR.map((_, i) =>
    `<button class="ar-chip" data-wand="${i}">Wand ${i + 1} · ${komma(Geometrie.wandLaengen(raum)[i] || 0)} m</button>`).join("");
  $(".ar-waende").querySelectorAll(".ar-chip").forEach(b => b.onclick = () => {
    st.wand = Number(b.getAttribute("data-wand")); st.ecke1 = null; st.meldung = ""; oberflaeche();
  });

  // ------------------------------------------------------ Höhen-Panel

  const hoeheRange = $(".ar-hoehe-range");
  hoeheRange.max = String(raumHoehe());
  function hoehePanelZeigen() {
    const e = auswahl?.typ === "einbau" ? einbauten.find(x => x.id === auswahl.id) : null;
    hoehePanel.hidden = !e;
    if (!e) return;
    $(".ar-hoehe-name").textContent = Normmasse.ARTEN.get(e.art) || e.art;
    hoeheRange.value = String(hoeheEinbau(e));
    $(".ar-hoehe-wert").textContent = `${Math.round(hoeheEinbau(e) * 100)} cm üb. FFB`;
  }
  hoeheRange.oninput = () => {
    const e = auswahl?.typ === "einbau" ? einbauten.find(x => x.id === auswahl.id) : null;
    if (!e) return;
    e.hoeheM = Math.round(Number(hoeheRange.value) * 100) / 100;
    $(".ar-hoehe-wert").textContent = `${Math.round(e.hoeheM * 100)} cm üb. FFB`;
    markerAktualisieren(e);
    aenderung();
  };

  // ------------------------------------------------- Lagesensor + Zielen

  function lageEmpfangen(o) {
    const v = Au.blickAusLage(o);
    const q = Au.geraetQuaternion(o);
    if (!v || !q || !v.every(Number.isFinite) || !q.every(Number.isFinite)) return;
    st.lage = o; st.qGeraet = q;
    const t = performance.now();
    st.puffer.push({ t, v });
    while (st.puffer.length && st.puffer[0].t < t - 1500) st.puffer.shift();
    if (!st.sensor) {
      st.sensor = true;
      // Kam der Sensor erst nach dem Rückfall auf „von Hand", zurück zum Ausrichten.
      if (st.modus === "hand" && st.handAuto && !st.handBenutzt) { st.modus = "ausrichten"; st.meldung = ""; oberflaeche(); }
    }
  }

  /** Gemittelte Blickrichtung kurz VOR dem Auslösen – der Druck selbst wackelt. */
  function blickJetzt(spaetMs = 60, fensterMs = 420) {
    const t = performance.now();
    let s = st.puffer.filter(p => p.t <= t - spaetMs && p.t >= t - spaetMs - fensterMs);
    if (s.length < 3) s = st.puffer.slice(-4);
    return Z.mitteln(s.map(p => p.v));
  }

  function erlaubnisAnfragen() {
    if (st.sensor) return;
    const DOE = window.DeviceOrientationEvent;
    try { if (DOE && typeof DOE.requestPermission === "function") DOE.requestPermission().catch(() => {}); }
    catch (_) { /* ohne Erlaubnis-API einfach weiter */ }
  }

  /** Eine Ecke beim Ausrichten auslösen. */
  function ausloesen() {
    erlaubnisAnfragen();
    if (st.modus !== "ausrichten") return;
    if (!st.sensor) { st.meldung = "Noch keine Lagedaten – Handy kurz bewegen. Ohne Sensor: „Von Hand“."; statusText(); return; }
    const m = blickJetzt();
    if (!m) return;
    if (m.streuungGrad > 3) { st.meldung = "Zu unruhig – Handy ruhig halten und noch einmal auslösen."; statusText(); return; }
    if (!Z.bodenpunkt(m.v, st.kamerahoehe)) { st.meldung = "Zu flach – das Fadenkreuz muss die Ecke am Boden treffen."; statusText(); return; }
    if (!st.ecke1) { st.ecke1 = m.v; st.meldung = ""; oberflaeche(); return; }
    st.ecke2 = m.v;
    st.hoeheVonHand = false;
    if (!loesen()) { st.ecke2 = null; statusText(); return; }
    st.modus = "ausgerichtet"; st.gierKorr = 0; st.versatz = [0, 0];
    oberflaeche();
  }

  function loesen() {
    const r = Au.loese({ ecken: eckenR, wandIndex: st.wand, vStart: st.ecke1, vEnde: st.ecke2,
      kamerahoeheM: st.kamerahoehe, skalaAnwenden: !st.hoeheVonHand,
      // Freihand: Linse vor der Körperachse; kalibrierter Neigungsfehler des Geräts.
      haltung: Au.haltungFreihand(gespeicherterNeigungsfehler()) });
    if (!r.ok) {
      st.meldung = r.grund === "gleich" ? "Beide Ziele liegen aufeinander – erst die linke, dann die rechte Ecke der Wand anzielen."
        : "Zu flach gezielt – die Ecken am Boden anzielen.";
      return false;
    }
    st.pose = r;
    const w = `Wand ${r.wandIndex + 1}`;
    const zusatz = r.getauscht ? " Die Ecken waren vertauscht angezielt – richtiggestellt."
      : r.ausserhalb ? " Achtung: Der Standpunkt liegt so außerhalb des Raums – Wand und Ecken prüfen, „Neu ausrichten“." : "";
    if (st.hoeheVonHand) st.meldung = `Kamerahöhe von Hand ${komma(r.kamerahoeheM)} m · die Ecken weichen bis ${Math.round(r.restM * 100)} cm ab.`;
    else if (r.skalaAngewandt) st.meldung = `${w}: gezielt ${komma(r.laengeGezieltM)} m, im Plan ${komma(r.laengeRaumM)} m → Kamerahöhe ${komma(r.kamerahoeheM)} m übernommen.`;
    else st.meldung = `Achtung: ${w} gezielt ${komma(r.laengeGezieltM)} m, im Plan ${komma(r.laengeRaumM)} m – passt nicht. Kamerahöhe bleibt ${komma(r.kamerahoeheM)} m. Richtige Wand und Ecken? „Neu ausrichten“.`;
    st.meldung += zusatz;
    return true;
  }

  /** Ausrichtung mit Feinjustage. */
  function poseJetzt() {
    const p = st.pose;
    return { drehungRad: p.drehungRad + st.gierKorr, verschiebung: [p.stand[0] + st.versatz[0], p.stand[1] + st.versatz[1]], kamerahoeheM: p.kamerahoeheM, modell: p.modell };
  }

  function handStarten(auto) {
    const n = eckenR.length;
    const c = [eckenR.reduce((s, p) => s + p[0], 0) / n, eckenR.reduce((s, p) => s + p[1], 0) / n];
    const A = eckenR[st.wand], B = eckenR[(st.wand + 1) % n];
    const ziel = [(A[0] + B[0]) / 2 - c[0], (A[1] + B[1]) / 2 - c[1]];
    // Ry(gier)·(0,0,−1) = (−sin, 0, −cos) soll auf die Wandmitte zeigen.
    st.hand = { x: c[0], y: c[1], gier: Math.atan2(-ziel[0], -ziel[1]), neigung: -0.35 };
    st.modus = "hand"; st.handAuto = !!auto; st.handBenutzt = false;
    st.meldung = auto ? "Kein Lagesensor gefunden – Ansicht von Hand ausrichten." : "";
    oberflaeche();
  }

  // ----------------------------------------------------- Setzen/Wählen

  function waehle(typ, id) {
    auswahl = typ ? { typ, id } : null;
    if (auswahl) $(".ar-fein").open = false;   // Fadenkreuz frei halten
    for (const [, m] of marker) markerAktualisieren(m.e);
    neuBewerten();
    hoehePanelZeigen();
    setzenKnopf();
  }

  const raycaster = new THREE.Raycaster();
  const _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

  /** Strahl einer Kamera (Mitte oder Bildpunkt) im Raumsystem [x, y, Höhe]. */
  function strahlAusKamera(cam, ndc) {
    cam.updateMatrixWorld();
    if (ndc) { raycaster.setFromCamera(ndc, cam); _o.copy(raycaster.ray.origin); _d.copy(raycaster.ray.direction); }
    else { cam.getWorldPosition(_o); cam.getWorldDirection(_d); }
    raumGruppe.updateMatrixWorld();
    _inv.copy(raumGruppe.matrixWorld).invert();
    _o.applyMatrix4(_inv); _d.transformDirection(_inv);
    return { o: [_o.x, _o.z, _o.y], d: [_d.x, _d.z, _d.y] };
  }

  /** Zielstrahl des Fadenkreuzes – mit dem Sensor gemittelt wie beim Ausrichten. */
  function fadenkreuzStrahl() {
    if (st.xrSession) return strahlAusKamera(renderer.xr.getCamera());
    if (st.modus === "ausgerichtet" && st.pose && st.qGeraet) {
      const m = blickJetzt(); if (!m) return null;
      // Strahl ab der Linse – sie sitzt vor der Körperachse und wandert beim Drehen mit.
      const k = Au.kameraImRaum(poseJetzt(), m.v);
      return { o: [k.o[0], k.o[1], bodenZ() + k.o[2]], d: k.d };
    }
    if (st.modus === "ausrichten") return null;
    return strahlAusKamera(camera);
  }

  function zielTreffer(strahl, bef) {
    const ziel = bef === "DECKE" ? "DECKE" : bef === "BODEN" ? "BODEN" : "WAND";
    return Au.treffer({ ursprung: strahl.o, richtung: strahl.d, ecken: eckenR,
      bodenZ: ziel === "BODEN" ? bodenZ() : 0, deckeZ: deckeZ(), ziel });
  }

  function trefferText(t) {
    if (t.art === "WAND") return `Wand ${t.index + 1} · ${komma(t.abstand)} m ab Ecke · ${Math.round((t.hoehe - aufbau()) * 100)} cm über FFB`;
    return `${t.art === "DECKE" ? "Decke" : "Boden"} · x ${komma(t.x)} · y ${komma(t.y)} m`;
  }
  const GRUND = {
    ueberDecke: "Über der Decke – tiefer zielen", unterBoden: "Das ist der Boden – auf die Wand zielen",
    keineWand: "Keine Wand im Fadenkreuz", nichtNachOben: "Zur Decke zielen",
    nichtNachUnten: "Zum Boden zielen", ausserhalb: "Außerhalb des Raums"
  };

  /** Ergebnis eines Treffers in den Einbau schreiben (Höhen ab fertigem Boden). */
  function anTreffer(e, t) {
    if (t.art === "WAND") {
      e.befestigung = "WAND";
      e.wandIndex = t.index;
      e.abstandM = Math.round(t.abstand * 100) / 100;
      e.hoeheM = Math.max(0, Math.round((t.hoehe - aufbau()) * 100) / 100);
    } else {
      e.relX = klemm01(t.x / (Geometrie.breite(raum) || 1));
      e.relY = klemm01(t.y / (Geometrie.tiefe(raum) || 1));
    }
  }

  function setzeMitStrahl(strahl) {
    if (!strahl) { st.meldung = "Kein Zielstrahl – erst ausrichten."; statusText(); return; }
    if (armiert) {
      const art = armiert, bef = Normmasse.befestigung(art);
      const t = zielTreffer(strahl, bef);
      if (!t.ok) { st.meldung = `${GRUND[t.grund] || "Kein Treffer"} – „${Normmasse.ARTEN.get(art) || art}“ bleibt gewählt.`; statusText(); return; }
      const e = { id: opts.neueId("ein"), raumId: raum.id, art, befestigung: bef, hoeheM: Normmasse.hoehe(art), relX: 0.5, relY: 0.5 };
      anTreffer(e, t);
      einbauten.push(e);
      opts.einbauHinzufuegen && opts.einbauHinzufuegen(e);
      baueMarker(e);
      armiert = null; paletteMalen();
      waehle("einbau", e.id);
      st.meldung = `${Normmasse.ARTEN.get(art) || art} gesetzt: ${trefferText(t)}.`;
      aenderung(); statusText(); return;
    }
    if (auswahl?.typ === "einbau") {
      const e = einbauten.find(x => x.id === auswahl.id); if (!e) return;
      const t = zielTreffer(strahl, e.befestigung || Normmasse.befestigung(e.art));
      if (!t.ok) { st.meldung = GRUND[t.grund] || "Kein Treffer"; statusText(); return; }
      anTreffer(e, t);
      markerAktualisieren(e); hoehePanelZeigen();
      st.meldung = `Verschoben: ${trefferText(t)}.`;
      aenderung(); statusText(); return;
    }
    if (auswahl?.typ === "box") {
      const ph = phs.find(p => p.id === auswahl.id); if (!ph) return;
      const t = zielTreffer(strahl, "BODEN");
      if (!t.ok) { st.meldung = GRUND[t.grund] || "Kein Treffer"; statusText(); return; }
      ph.xM = Math.round(Math.max(0, Math.min(Geometrie.breite(raum), t.x)) * 100) / 100;
      ph.yM = Math.round(Math.max(0, Math.min(Geometrie.tiefe(raum), t.y)) * 100) / 100;
      neuBewerten();
      aenderung(); statusText();
    }
  }

  function tippen(cx, cy) {
    if (st.modus === "ausrichten") { ausloesen(); return; }
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const cam = st.xrSession ? renderer.xr.getCamera() : camera;
    if (!armiert) {
      raycaster.setFromCamera(ndc, cam);
      const mt = raycaster.intersectObjects([...marker.values()].map(m => m.box), false);
      if (mt.length) {
        const id = mt[0].object.userData.einbauId;
        st.meldung = ""; waehle(auswahl?.typ === "einbau" && auswahl.id === id ? null : "einbau", id); statusText(); return;
      }
      const bt = raycaster.intersectObjects([...boxen.values()], false);
      if (bt.length) {
        const id = bt[0].object.userData.phId;
        st.meldung = ""; waehle(auswahl?.typ === "box" && auswahl.id === id ? null : "box", id); statusText(); return;
      }
      if (!auswahl) return;
    }
    // Gewählt oder scharf: Antippen setzt an die angetippte Stelle.
    setzeMitStrahl(strahlAusKamera(cam, ndc));
  }

  // -------------------------------------------------- Bedienung (Knöpfe)

  const kamh = $(".ar-kamh"), bw = $(".ar-bw");
  kamh.value = komma(st.kamerahoehe);
  bw.value = String(Math.round(st.bildwinkel));
  kamh.onchange = () => {
    const v = zahl(kamh.value);
    st.kamerahoehe = v > 0.3 && v < 2.5 ? v : st.kamerahoehe;
    kamh.value = komma(st.kamerahoehe);
    try { localStorage.setItem(SCHLUESSEL_HOEHE, String(st.kamerahoehe)); } catch (_) {}
  };
  bw.onchange = () => {
    const v = zahl(bw.value);
    st.bildwinkel = v >= 30 && v <= 120 ? v : st.bildwinkel;
    bw.value = String(Math.round(st.bildwinkel));
    try { localStorage.setItem(SCHLUESSEL_BILDWINKEL, String(st.bildwinkel)); } catch (_) {}
    groessen(); oberflaeche();
  };
  const roh = $(".ar-roh");
  roh.hidden = !(aufbau() > 0);
  $(".ar-roh-an").checked = st.bodenRoh;
  $(".ar-roh-an").onchange = e => { st.bodenRoh = !!e.target.checked; umrissBauen(); };

  $(".ar-ausloeser").onclick = ausloesen;
  $(".ar-rueck").onclick = () => { st.ecke1 = null; st.meldung = ""; oberflaeche(); };
  $(".ar-ohne").onclick = () => handStarten(false);
  $(".ar-neu").onclick = () => {
    st.modus = "ausrichten"; st.ecke1 = st.ecke2 = null; st.pose = null; st.hoeheVonHand = false;
    st.meldung = ""; armiert = null; paletteMalen(); waehle(null); oberflaeche();
  };
  $(".ar-setzen").onclick = () => setzeMitStrahl(fadenkreuzStrahl());

  $(".ar-kam").oninput = e => {
    const v = Number(e.target.value);
    if (st.modus === "ausgerichtet" && st.ecke1 && st.ecke2) {
      // Von Hand gesetzte Höhe: dieselben zwei Ziele, aber ohne Maßstab lösen.
      const annahme = st.kamerahoehe;
      st.hoeheVonHand = true; st.kamerahoehe = v;
      loesen();
      st.kamerahoehe = annahme;        // Annahme fürs nächste Ausrichten bleibt
    } else st.kamerahoehe = v;
    $(".ar-kam-wert").textContent = `${komma(kamerahoeheJetzt())} m`;
    statusText();
  };
  $(".ar-bw2").oninput = e => {
    st.bildwinkel = Number(e.target.value); bw.value = String(Math.round(st.bildwinkel));
    try { localStorage.setItem(SCHLUESSEL_BILDWINKEL, String(st.bildwinkel)); } catch (_) {}
    $(".ar-bw-wert").textContent = `${Math.round(st.bildwinkel)}°`;
    groessen();
  };
  overlay.querySelectorAll("[data-fein]").forEach(b => b.onclick = () => {
    const w = 0.5 * Math.PI / 180, s = 0.05;
    const { rechts, vor } = horizontAchsen();
    switch (b.getAttribute("data-fein")) {
      case "dreh-l": drehe(+w); break;
      case "dreh-r": drehe(-w); break;
      case "links": schiebe(rechts[0] * s, rechts[1] * s); break;
      case "rechts": schiebe(-rechts[0] * s, -rechts[1] * s); break;
      case "weg": schiebe(-vor[0] * s, -vor[1] * s); break;
      case "her": schiebe(vor[0] * s, vor[1] * s); break;
    }
  });

  /** Waagerechte Blick- und Rechtsachse der Kamera im Raum. */
  function horizontAchsen() {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const lf = Math.hypot(f.x, f.z) || 1, lr = Math.hypot(r.x, r.z) || 1;
    return { vor: [f.x / lf, f.z / lf], rechts: [r.x / lr, r.z / lr] };
  }
  /** Kamera um die Senkrechte drehen (positiv = Kamera nach rechts). */
  function drehe(rad) {
    if (st.modus === "ausgerichtet" && st.pose) st.gierKorr += rad;
    else if (st.hand) { st.hand.gier -= rad; st.handBenutzt = true; }
  }
  /** Kamera im Raum verschieben (Meter, Raumachsen). */
  function schiebe(dx, dy) {
    if (st.modus === "ausgerichtet" && st.pose) { st.versatz[0] += dx; st.versatz[1] += dy; }
    else if (st.hand) { st.hand.x += dx; st.hand.y += dy; st.handBenutzt = true; }
  }

  // ------------------------------------------------- Gesten auf dem Bild

  const zeiger = new Map();
  let geste = null;
  const mitte = () => { const p = [...zeiger.values()]; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
  canvas.addEventListener("pointerdown", e => {
    erlaubnisAnfragen();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    zeiger.set(e.pointerId, [e.clientX, e.clientY]);
    if (zeiger.size === 1) geste = { start: [e.clientX, e.clientY], letzt: [e.clientX, e.clientY], bewegt: false, zwei: false, mitte: null };
    else if (geste) { geste.zwei = true; geste.bewegt = true; geste.mitte = mitte(); }
  });
  canvas.addEventListener("pointermove", e => {
    if (!geste || !zeiger.has(e.pointerId)) return;
    zeiger.set(e.pointerId, [e.clientX, e.clientY]);
    if (st.modus === "ausrichten") return;
    if (zeiger.size >= 2) {
      // Zwei Finger: Modell mit den Fingern verschieben.
      const m = mitte();
      if (geste.mitte) {
        const { rechts, vor } = horizontAchsen(), k = 0.004;
        const dx = m[0] - geste.mitte[0], dy = m[1] - geste.mitte[1];
        schiebe(-rechts[0] * dx * k + vor[0] * dy * k, -rechts[1] * dx * k + vor[1] * dy * k);
      }
      geste.mitte = m;
      return;
    }
    if (geste.zwei) return;
    if (!geste.bewegt && Math.hypot(e.clientX - geste.start[0], e.clientY - geste.start[1]) < 8) return;
    const dx = e.clientX - geste.letzt[0], dy = e.clientY - geste.letzt[1];
    geste.bewegt = true; geste.letzt = [e.clientX, e.clientY];
    // Ein Finger: Modell folgt dem Finger. Mit Sensor nur die Gier (Drift).
    const radProPx = camera.fov * Math.PI / 180 / Math.max(1, canvas.clientHeight);
    drehe(-dx * radProPx);
    if (st.modus === "hand" && st.hand) st.hand.neigung = Math.max(-1.4, Math.min(1.4, st.hand.neigung + dy * radProPx));
  });
  const hoch = e => {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.delete(e.pointerId);
    const tipp = geste && !geste.bewegt && !geste.zwei && zeiger.size === 0 && e.type === "pointerup";
    if (zeiger.size === 0) geste = null; else if (geste) geste.mitte = mitte();
    if (tipp) tippen(e.clientX, e.clientY);
  };
  canvas.addEventListener("pointerup", hoch);
  canvas.addEventListener("pointercancel", hoch);

  // ----------------------------------------------------------- Beenden

  let beendet = false;
  const beenden = () => {
    if (beendet) return;
    beendet = true;
    st.laeuft = false;
    cancelAnimationFrame(st.raf);
    for (const f of weg.splice(0)) { try { f(); } catch (_) {} }
    if (st.xrSession) { try { st.xrSession.end().catch(() => {}); } catch (_) {} }
    try { renderer.setAnimationLoop(null); } catch (_) {}
    if (st.kamera) st.kamera.getTracks().forEach(t => t.stop());
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (_) {}
    overlay.remove();
    opts.onEnde && opts.onEnde();
  };
  $(".ar-zu").onclick = beenden;

  // ------------------------------------------------------- Kamera/Sensor

  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: {
      facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    st.kamera = strom;
    if (beendet) { strom.getTracks().forEach(t => t.stop()); return { beenden }; }
    video.srcObject = strom;
    await video.play().catch(() => {});
  } catch (_) { overlay.classList.add("ohne-kamera"); }
  if (beendet) return { beenden };

  if (nat && typeof nat.beiLage === "function") weg.push(nat.beiLage(lageEmpfangen));
  else if (window.DeviceOrientationEvent) {
    const h = e => { if (e.alpha != null && e.beta != null) lageEmpfangen({ euler: [e.alpha, e.beta, e.gamma || 0] }); };
    window.addEventListener("deviceorientation", h);
    weg.push(() => window.removeEventListener("deviceorientation", h));
  }
  if (nat && typeof nat.beiTaste === "function") weg.push(nat.beiTaste(() => {
    if (st.modus === "ausrichten") ausloesen();
    else if (armiert || auswahl) setzeMitStrahl(fadenkreuzStrahl());
  }));
  if (nat && typeof nat.beiZurueck === "function") weg.push(nat.beiZurueck(() => {
    if (st.modus === "ausrichten" && st.ecke1) { st.ecke1 = null; oberflaeche(); return true; }
    beenden(); return true;
  }));
  const sensorUhr = setTimeout(() => { if (!st.sensor && st.modus === "ausrichten" && !st.ecke1) handStarten(true); }, 1800);
  weg.push(() => clearTimeout(sensorUhr));

  function groessen() {
    const w = overlay.clientWidth || window.innerWidth, h = overlay.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = Au.anzeigeFovGrad({ bildwinkelGrad: st.bildwinkel, videoB: video.videoWidth, videoH: video.videoHeight, elementB: w, elementH: h });
    camera.updateProjectionMatrix();
  }
  const anmelden = (ziel, typ, f) => { ziel.addEventListener(typ, f); weg.push(() => ziel.removeEventListener(typ, f)); };
  anmelden(window, "resize", groessen);
  anmelden(video, "loadedmetadata", groessen);
  anmelden(video, "resize", groessen);
  if (screen.orientation && screen.orientation.addEventListener) anmelden(screen.orientation, "change", groessen);

  umrissBauen();
  neuBewerten();
  groessen();
  oberflaeche();

  // ----------------------------------------------------------- Zeichnen

  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  function kameraStellen() {
    if (st.modus === "ausgerichtet" && st.pose && st.qGeraet) {
      const p = poseJetzt();
      const v = Au.blickAusLage(st.lage);
      const k = v ? Au.kameraImRaum(p, v) : { o: [p.verschiebung[0], p.verschiebung[1], kamerahoeheJetzt()] };
      camera.position.set(k.o[0], bodenZ() + k.o[2], k.o[1]);
      const q = Au.kameraQuaternion(p.drehungRad, st.qGeraet, schirmWinkel());
      camera.quaternion.set(q[1], q[2], q[3], q[0]);
    } else if (st.hand) {
      camera.position.set(st.hand.x, augeZ(), st.hand.y);
      camera.quaternion.setFromEuler(_euler.set(st.hand.neigung, st.hand.gier, 0, "YXZ"));
    }
    camera.updateMatrixWorld();
  }

  let zielTextAlt = "";
  function zielAnzeigen(cam) {
    let text = "", schlecht = false;
    zielMarke.visible = false;
    if (st.modus === "ausrichten") {
      if (st.puffer.length) {
        const v = st.puffer[st.puffer.length - 1].v;
        const p = Z.bodenpunkt(v, st.kamerahoehe);
        text = p ? `Boden · ${komma(p.d)} m entfernt` : "zu flach – tiefer zielen";
        schlecht = !p;
      }
    } else {
      const e = auswahl?.typ === "einbau" ? einbauten.find(x => x.id === auswahl.id) : null;
      const bef = armiert ? Normmasse.befestigung(armiert) : e ? (e.befestigung || Normmasse.befestigung(e.art)) : auswahl?.typ === "box" ? "BODEN" : "WAND";
      const t = zielTreffer(strahlAusKamera(cam), bef);
      if (t.ok) {
        text = trefferText(t);
        if (armiert || auswahl) {
          zielMarke.position.set(t.x, t.art === "WAND" ? t.hoehe : t.hoehe + 0.01, t.y);
          zielMarke.rotation.set(t.art === "WAND" ? 0 : Math.PI / 2, t.art === "WAND" ? -Math.atan2(
            eckenR[(t.index + 1) % eckenR.length][1] - eckenR[t.index][1], eckenR[(t.index + 1) % eckenR.length][0] - eckenR[t.index][0]) : 0, 0);
          zielMarke.visible = true;
        }
      } else { text = GRUND[t.grund] || "kein Treffer"; schlecht = true; }
    }
    const neu = text + (schlecht ? "!" : "");
    if (neu !== zielTextAlt) {
      zielTextAlt = neu;
      zielEl.hidden = !text;
      zielEl.textContent = text;
      zielEl.classList.toggle("schlecht", schlecht);
    }
  }

  function schleife() {
    if (!st.laeuft || st.xrSession) return;
    kameraStellen();
    raumGruppe.visible = st.modus !== "ausrichten";
    zielAnzeigen(camera);
    renderer.render(scene, camera);
    st.raf = requestAnimationFrame(schleife);
  }
  st.raf = requestAnimationFrame(schleife);

  // ------------------------------------------------------- WebXR

  /**
   * Unter WebXR liefert das Gerät die Kamera; die Raumgruppe wird so gelegt,
   * dass der Startpunkt der Sitzung (Boden unter dem Gerät, −z = Blick beim
   * Start) dem Standpunkt und der Blickrichtung aus dem Ausrichten entspricht.
   */
  function xrAnker() {
    kameraStellen();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const gier = Math.atan2(-f.x, -f.z);
    raumGruppe.rotation.set(0, -gier, 0);
    const s = new THREE.Vector3(camera.position.x, bodenZ(), camera.position.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -gier);
    raumGruppe.position.set(-s.x, -s.y, -s.z);
    raumGruppe.updateMatrixWorld(true);
  }

  async function xrStarten() {
    const session = await navigator.xr.requestSession("immersive-ar",
      { optionalFeatures: ["local-floor", "dom-overlay"], domOverlay: { root: ui } });
    xrAnker();
    st.xrSession = session;
    cancelAnimationFrame(st.raf);
    renderer.xr.enabled = true;
    try {
      renderer.xr.setReferenceSpaceType("local-floor");
      await renderer.xr.setSession(session);
    } catch (_) {
      try {
        renderer.xr.setReferenceSpaceType("local");
        await renderer.xr.setSession(session);
      } catch (e) { session.end().catch(() => {}); throw e; }
    }
    raumGruppe.visible = true;
    st.meldung = "Welt-Tracking aktiv – Modell vom Standpunkt übernommen. Im Raum umhergehen.";
    statusText();
    session.addEventListener("select", () => { if (armiert || auswahl) setzeMitStrahl(fadenkreuzStrahl()); });
    renderer.setAnimationLoop(() => { zielAnzeigen(renderer.xr.getCamera()); renderer.render(scene, camera); });
    session.addEventListener("end", () => {
      st.xrSession = null;
      renderer.setAnimationLoop(null);
      renderer.xr.enabled = false;
      raumGruppe.position.set(0, 0, 0); raumGruppe.rotation.set(0, 0, 0); raumGruppe.updateMatrixWorld(true);
      if (st.laeuft) {
        st.meldung = "Welt-Tracking beendet – zurück in der Vorschau.";
        groessen(); statusText();
        cancelAnimationFrame(st.raf);
        st.raf = requestAnimationFrame(schleife);
      }
    });
  }

  // Antippen der Bedienfelder im DOM-Overlay ist kein XR-„select“ (sonst doppelt gesetzt).
  for (const el of overlay.querySelectorAll(".ar-oben, .ar-stand, .ar-hinweis, .ar-hoehe, .ar-regler"))
    el.addEventListener("beforexrselect", e => e.preventDefault());

  const xrKnopf = $(".ar-xr");
  if (await xrMoeglich()) {
    xrKnopf.hidden = false;
    xrKnopf.onclick = () => xrStarten().catch(() => {
      st.xrSession = null; renderer.xr.enabled = false;
      raumGruppe.position.set(0, 0, 0); raumGruppe.rotation.set(0, 0, 0);
      st.meldung = "Welt-Tracking nicht möglich – die Vorschau läuft weiter.";
      statusText();
      if (st.laeuft) { cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(schleife); }
    });
  }
  return { beenden };
}

// ------------------------------------------------------------------ Helfer

const klemm01 = v => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
const komma = (x, n = 2) => (Number(x) || 0).toFixed(n).replace(".", ",");
const zahl = s => Number(String(s ?? "").replace(",", "."));

function gespeicherteHoehe() {
  try { const v = Number(localStorage.getItem(SCHLUESSEL_HOEHE)); return v > 0.3 && v < 2.5 ? v : 1.4; } catch (_) { return 1.4; }
}
function gespeicherterBildwinkel() {
  try { const v = Number(localStorage.getItem(SCHLUESSEL_BILDWINKEL)); return v >= 30 && v <= 120 ? v : 66; } catch (_) { return 66; }
}

function schirmWinkel() {
  const o = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return (Number(o) || 0) * Math.PI / 180;
}

const _oben = new THREE.Vector3(0, 1, 0);
/** Schmaler Balken von a nach b (three.js-Koordinaten). */
function balken(a, b, dicke, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const m = new THREE.Mesh(new THREE.BoxGeometry(dicke, d.length() || 0.001, dicke), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  if (d.lengthSq() > 0) m.quaternion.setFromUnitVectors(_oben, d.normalize());
  return m;
}

// Eigene Regeln der AR-Ansicht – passen zur Desktop- und zur Mobil-Oberfläche
// (Farben aus den CSS-Variablen, mit Rückfallwerten).
const STIL = `
.ar-overlay .ar-ui > .ar-kreuz { position: absolute; left: 50%; top: 50%; width: 72px; height: 72px;
  margin: -36px 0 0 -36px; pointer-events: none; z-index: 0; }
.ar-overlay .ar-kreuz i { position: absolute; background: #F6EFE4; box-shadow: 0 0 0 1px rgba(0,0,0,.55); }
.ar-overlay .ar-kreuz i:nth-child(1) { left: 0; top: 35px; width: 26px; height: 2px; }
.ar-overlay .ar-kreuz i:nth-child(2) { right: 0; top: 35px; width: 26px; height: 2px; }
.ar-overlay .ar-kreuz i:nth-child(3) { top: 0; left: 35px; width: 2px; height: 26px; }
.ar-overlay .ar-kreuz i:nth-child(4) { bottom: 0; left: 35px; width: 2px; height: 26px; }
.ar-overlay .ar-kreuz b { position: absolute; left: 33px; top: 33px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--signal, #E8B44A); box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
.ar-overlay .ar-ui > .ar-ziel { position: absolute; left: 50%; top: calc(50% + 46px); transform: translateX(-50%);
  pointer-events: none; z-index: 0; white-space: nowrap; padding: 5px 9px; border-radius: 3px;
  background: rgba(22,21,19,.85); color: #F6EFE4; border: 1px solid rgba(217,194,163,.35);
  font: 600 12px "IBM Plex Mono", ui-monospace, monospace; }
.ar-overlay .ar-ziel.schlecht { color: #F3B1A0; }
.ar-overlay .ar-ziel[hidden], .ar-overlay .ar-titel[hidden], .ar-overlay .ar-palette[hidden],
.ar-overlay .ar-ausr[hidden], .ar-overlay .ar-plan[hidden], .ar-overlay .ar-roh[hidden] { display: none; }
.ar-overlay .ar-titel { flex: 1; min-width: 0; display: flex; flex-direction: column; color: #F1E9DD; padding: 4px 2px; }
.ar-overlay .ar-titel b { font: 600 18px "Zilla Slab", Georgia, serif; }
.ar-overlay .ar-titel span { font: 600 11px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .1em;
  text-transform: uppercase; color: var(--sand, #D9C2A3); }
.ar-overlay .ar-stand { align-self: center; max-width: 100%; padding: 6px 10px; border-radius: 3px; text-align: center;
  background: rgba(22,21,19,.72); color: #EDE2D5; font: 400 12px/1.35 "Source Sans 3", system-ui, sans-serif; }
.ar-overlay .ar-stand[hidden], .ar-overlay .ar-hoehe[hidden] { display: none; }
.ar-overlay .ar-hoehe { flex-wrap: wrap; row-gap: 4px; }
.ar-overlay .ar-hoehe-wert { order: 1; margin-left: auto; font-size: 16px; }
.ar-overlay .ar-hoehe-range { order: 2; flex: 1 1 100%; width: 100%; }
.ar-overlay .ar-hinweis .ar-meldung { display: block; margin-top: 5px; color: var(--signal, #E8B44A); }
.ar-overlay .ar-regler { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.ar-overlay .ar-ausr, .ar-overlay .ar-plan { display: flex; flex-direction: column; gap: 10px; }
.ar-overlay .ar-waende { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.ar-overlay .ar-waende::-webkit-scrollbar { display: none; }
.ar-overlay .ar-ausr-mitte { display: flex; gap: 12px; align-items: center; }
.ar-overlay .ar-mini { flex: 0 0 120px; width: 120px; height: 84px; background: rgba(217,194,163,.08); border-radius: 3px; }
.ar-overlay .ar-mini-raum { fill: rgba(217,194,163,.12); stroke: rgba(241,233,221,.65); stroke-width: 1.5; }
.ar-overlay .ar-mini-wand { stroke: var(--signal, #E8B44A); stroke-width: 4; stroke-linecap: round; }
.ar-overlay .ar-mini-ecke { fill: #161513; stroke: var(--signal, #E8B44A); stroke-width: 2; }
.ar-overlay .ar-mini-ecke.voll { fill: var(--signal, #E8B44A); }
.ar-overlay .ar-mini text { font: 700 8.5px system-ui, sans-serif; fill: #F6EFE4; text-anchor: middle; }
.ar-overlay .ar-mini .voll + text { fill: #161513; }
.ar-overlay .ar-felder { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.ar-overlay .ar-feld { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #F1E9DD; }
.ar-overlay .ar-feld span { display: flex; align-items: center; gap: 6px; }
.ar-overlay .ar-feld input { width: 74px; min-height: 40px; padding: 0 8px; border-radius: 2px;
  background: rgba(217,194,163,.14); color: #F1E9DD; border: 1.5px solid rgba(217,194,163,.3);
  font: 600 15px "IBM Plex Mono", ui-monospace, monospace; }
.ar-overlay .ar-roh { display: flex; align-items: center; gap: 8px; font: 400 12.5px/1.3 "Source Sans 3", system-ui, sans-serif;
  text-transform: none; letter-spacing: 0; color: #EDE2D5; }
.ar-overlay .ar-roh input { width: 20px; height: 20px; accent-color: var(--signal, #E8B44A); }
.ar-overlay .ar-knoepfe { display: flex; gap: 8px; align-items: stretch; }
.ar-overlay .ar-knopf { min-height: 50px; padding: 0 12px; border-radius: 3px; cursor: pointer;
  border: 1.5px solid rgba(217,194,163,.35); background: rgba(217,194,163,.12); color: #F1E9DD;
  font: 600 14px "Source Sans 3", system-ui, sans-serif; }
.ar-overlay .ar-knopf:disabled { opacity: .45; cursor: default; }
.ar-overlay .ar-neben { flex: 0 0 auto; }
.ar-overlay .ar-haupt { flex: 1; min-width: 0; background: var(--ziegel, #3a6ea5); border-color: var(--ziegel, #3a6ea5);
  color: #F6EFE4; font: 600 16px "Zilla Slab", Georgia, serif; box-shadow: 0 3px 0 var(--ziegel-tief, #26496e); }
.ar-overlay .ar-haupt:disabled { box-shadow: none; }
.ar-overlay .ar-haupt:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--ziegel-tief, #26496e); }
.ar-overlay .ar-knoepfe .ar-xr { flex: 0 0 auto; }
.ar-overlay .ar-fein summary { cursor: pointer; color: var(--sand, #D9C2A3); padding: 2px 0;
  font: 600 11px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; }
.ar-overlay .ar-fein[open] { display: flex; flex-direction: column; gap: 8px; }
.ar-overlay .ar-fein-knoepfe { display: flex; gap: 6px; flex-wrap: wrap; }
.ar-overlay .ar-fein-knoepfe button { min-width: 44px; min-height: 40px; border-radius: 3px; cursor: pointer;
  border: 1.5px solid rgba(217,194,163,.35); background: rgba(217,194,163,.12); color: #F1E9DD; font: 600 17px system-ui, sans-serif; }

/* Querformat / niedrige Schirme: Bedienung rechts, Fadenkreuz bleibt frei. */
@media (max-height: 560px) and (min-aspect-ratio: 4/3) {
  .ar-overlay .ar-ui > .ar-hinweis, .ar-overlay .ar-ui > .ar-hoehe, .ar-overlay .ar-ui > .ar-regler {
    align-self: flex-end; width: min(44vw, 420px); }
  .ar-overlay .ar-ui > .ar-hinweis { margin: auto 0 0 auto; padding: 7px 10px; font-size: 12px; line-height: 1.35; }
  .ar-overlay .ar-ui > .ar-stand { align-self: flex-start; max-width: 50vw; }
  .ar-overlay .ar-ui > .ar-ziel { left: auto; right: calc(50% + 42px); top: calc(50% - 13px); transform: none; }
  .ar-overlay .ar-regler { gap: 7px; padding: 9px; }
  .ar-overlay .ar-ausr, .ar-overlay .ar-plan { gap: 7px; }
  .ar-overlay .ar-mini { display: none; }
  .ar-overlay .ar-felder { flex-direction: row; flex-wrap: wrap; gap: 6px 14px; }
  .ar-overlay .ar-feld input { min-height: 36px; width: 64px; }
  .ar-overlay .ar-knopf { min-height: 44px; }
}
`;
