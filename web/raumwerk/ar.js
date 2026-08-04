/*
 * AR-Besprechung / Elektro-Planung vor Ort.
 *
 * Zweck: am PC den Elektroplan zeichnen (wo kommt welche Steckdose, welcher
 * Schalter, welche Leuchte hin – jeweils auf welcher Höhe), dann vor Ort mit
 * dem Kunden die Einbauten an die echte Wand setzen und die Höhen prüfen.
 *
 * Zwei Wege:
 *  1. **Magic-Window** (Standard, ohne ARCore): Kamerabild + Geräteausrichtung.
 *  2. **WebXR-Welttracking** (Aufwertung), wo unterstützt – liefert die
 *     Kamerahöhe automatisch.
 *
 * Zwei Dinge sind für Elektro entscheidend und hier eingebaut:
 *  · **Bodenaufbau / Estrich** (`raum.aufbauM`): Höhen zählen ab dem *fertigen*
 *    Boden. Der fertige Boden liegt als Ebene über dem Rohboden; jeder Einbau
 *    sitzt um den Aufbau höher, als das nackte Kamerabild es zeigt.
 *  · **Kamerahöhe**: Damit die Höhen im Bild stimmen, muss die Höhe der Kamera
 *    über dem Boden bekannt sein – im Magic-Window einstellbar, unter WebXR
 *    automatisch (local-floor).
 */

import * as THREE from "../lib/three.module.min.js";
import * as Geometrie from "../geometrie.js";
import * as Normmasse from "../normmasse.js";
import { pruefe, grundriss } from "../pruefung.js";
import { fuer, Richtung } from "../regelwerk.js";

// Einbau-Arten, die in der AR-Palette angeboten werden (Elektro-Schwerpunkt).
const PALETTE = ["STECKDOSE", "STECKDOSE_2FACH", "SCHALTER", "WECHSELSCHALTER",
  "TASTER", "NETZWERKDOSE", "LAMPE", "WANDLEUCHTE", "RAUCHMELDER", "SICHERUNGSKASTEN"];

export async function xrMoeglich() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar")); }
  catch (_) { return false; }
}

export async function starte(opts) {
  const raum = opts.raum;
  const phs = opts.platzhalter || [];
  const einbauten = (opts.einbauten || []).slice();   // eigene Liste, Objekt-Refs
  const finde = opts.findeKomponente;
  const aufbau = () => Number(raum.aufbauM) || 0;

  const overlay = document.createElement("div");
  overlay.className = "ar-overlay";
  overlay.innerHTML = `
    <video class="ar-video" playsinline muted></video>
    <canvas class="ar-canvas"></canvas>
    <div class="ar-ui">
      <div class="ar-oben">
        <div class="ar-palette"></div>
        <button class="ar-zu">Beenden</button>
      </div>
      <div class="ar-hinweis"></div>
      <div class="ar-hoehe" hidden>
        <span class="ar-hoehe-name"></span>
        <input class="ar-hoehe-range" type="range" min="0" max="2.5" step="0.01">
        <span class="ar-hoehe-wert"></span>
      </div>
      <div class="ar-regler">
        <label>Entfernung <input class="ar-entf" type="range" min="1" max="6" step="0.1" value="2.5"></label>
        <label>Größe <input class="ar-groesse" type="range" min="0.1" max="1" step="0.05" value="1"></label>
        <label>Kamerahöhe <input class="ar-kam" type="range" min="0.8" max="1.9" step="0.01" value="1.5"></label>
        <button class="ar-xr" hidden>Welt-Tracking</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector(".ar-video");
  const canvas = overlay.querySelector(".ar-canvas");
  const hinweis = overlay.querySelector(".ar-hinweis");
  const hoehePanel = overlay.querySelector(".ar-hoehe");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2));
  const camera = new THREE.PerspectiveCamera(65, 1, 0.01, 100);

  const traeger = new THREE.Group();
  const inner = new THREE.Group();
  traeger.add(inner);
  scene.add(traeger);
  inner.position.set(-Geometrie.breite(raum) / 2, 0, -Geometrie.tiefe(raum) / 2);

  // Rohboden-Umriss.
  const eckenR = Geometrie.ecken(raum);
  const linie = eckenR.map(([x, y]) => new THREE.Vector3(x, 0.002, y));
  linie.push(linie[0].clone());
  inner.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linie),
    new THREE.LineBasicMaterial({ color: 0x2b7a78 })));

  // Fertiger Boden als Ebene über dem Rohboden (Estrich/Aufbau).
  const bodenForm = new THREE.Shape(eckenR.map(([x, y]) => new THREE.Vector2(x, y)));
  const fertigBoden = new THREE.Mesh(new THREE.ShapeGeometry(bodenForm),
    new THREE.MeshBasicMaterial({ color: 0xcfe8e9, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
  fertigBoden.rotation.x = Math.PI / 2;
  inner.add(fertigBoden);

  // Geräte-Klötzchen (Kontext) + Freiraumzonen.
  const boxen = new Map();
  let zonen = [];
  for (const ph of phs) {
    const komp = finde(ph.komponente); if (!komp) continue;
    const b = Number(komp.breiteM), t = Number(komp.tiefeM), h = Number(komp.hoeheM);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b, h, t),
      new THREE.MeshBasicMaterial({ color: 0x2b7a78, transparent: true, opacity: 0.35 }));
    mesh.rotation.y = -(Number(ph.drehungGrad) || 0) * Math.PI / 180;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x17494d }));
    mesh.add(edges);
    mesh.userData = { phId: ph.id, h, edges, warn: false };
    inner.add(mesh);
    boxen.set(ph.id, mesh);
  }

  // Einbauten (Elektro) als Wandmarker mit Steg = Höhe über fertigem Boden.
  const marker = new Map();
  for (const e of einbauten) baueMarker(e);

  let auswahl = null;    // { typ: "einbau"|"box", id }
  let armiert = null;    // Einbau-Art zum Setzen

  // ---------------------------------------------------------- Aufbau/Höhen

  function hoeheEinbau(e) {
    if (e.hoeheM != null && e.hoeheM !== "") return Number(e.hoeheM);
    const bef = e.befestigung || Normmasse.befestigung(e.art);
    if (bef === "DECKE") return Number(raum.hoeheM);
    if (bef === "BODEN") return 0;
    const h = Normmasse.hoehe(e.art);
    return h == null ? Number(raum.hoeheM) : h;
  }

  function einbauPos(e) {
    const l = Geometrie.lageImRaum(raum, e);
    return { x: l.x, z: l.y, h: aufbau() + hoeheEinbau(e) };
  }

  function baueMarker(e) {
    const grp = new THREE.Group();
    const p = einbauPos(e);
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, aufbau(), p.z), new THREE.Vector3(p.x, p.h, p.z)]),
      new THREE.LineBasicMaterial({ color: 0x3a6ea5 }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x3a6ea5 }));
    box.position.set(p.x, p.h, p.z);
    box.userData = { einbauId: e.id };
    grp.add(stem, box);
    inner.add(grp);
    marker.set(e.id, { grp, box, stem, e });
  }

  function markerAktualisieren(e) {
    const m = marker.get(e.id); if (!m) return;
    const p = einbauPos(e);
    m.box.position.set(p.x, p.h, p.z);
    m.stem.geometry.setFromPoints([new THREE.Vector3(p.x, aufbau(), p.z), new THREE.Vector3(p.x, p.h, p.z)]);
    m.box.material.color.setHex(auswahl?.typ === "einbau" && auswahl.id === e.id ? 0xffa500 : 0x3a6ea5);
    m.stem.material.color.setHex(auswahl?.typ === "einbau" && auswahl.id === e.id ? 0xffa500 : 0x3a6ea5);
  }

  // ---------------------------------------------------- Normprüfung (Boxen)

  function neuBewerten() {
    const befunde = pruefe(raum, phs);
    const warn = {};
    befunde.forEach(b => { if (b.schwere === "WARNUNG") warn[b.platzhalterId] = true; });
    for (const [id, mesh] of boxen) {
      mesh.userData.warn = !!warn[id];
      mesh.material.color.setHex(warn[id] ? 0xc0392b : 0x2b7a78);
      mesh.userData.edges.material.color.setHex(auswahl?.typ === "box" && auswahl.id === id ? 0xffa500 : (warn[id] ? 0xc0392b : 0x17494d));
      mesh.position.set(Number(boxPh(id).xM), mesh.userData.h / 2, Number(boxPh(id).yM));
    }
    for (const z of zonen) { inner.remove(z); z.geometry.dispose(); z.material.dispose(); }
    zonen = [];
    for (const ph of phs) {
      const komp = finde(ph.komponente); if (!komp) continue;
      const pts = zonePunkte(ph, komp); if (!pts) continue;
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])))),
        new THREE.MeshBasicMaterial({ color: warn[ph.id] ? 0xc0392b : 0x2e8b57, transparent: true, opacity: 0.26, side: THREE.DoubleSide }));
      mesh.rotation.x = Math.PI / 2; mesh.position.y = 0.004;
      inner.add(mesh); zonen.push(mesh);
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

  function statusText() {
    const bef = pruefe(raum, phs).filter(b => b.schwere === "WARNUNG").length;
    hinweis.innerHTML = `Estrich/Aufbau ${Math.round(aufbau() * 100)} cm · Höhen ab fertigem Boden`
      + `<br>${armiert ? `„${Normmasse.ARTEN.get(armiert)}" – auf die Wand tippen` : "Einbau antippen zum Wählen, Wand antippen zum Setzen/Verschieben"}`
      + (bef ? ` · <b>${bef} Geräte-Warnung</b>` : "");
  }

  neuBewerten();
  statusText();

  // ------------------------------------------------------------ Palette

  const paletteEl = overlay.querySelector(".ar-palette");
  paletteEl.innerHTML = PALETTE.map(a => `<button class="ar-chip" data-art="${a}">${Normmasse.ARTEN.get(a) || a}</button>`).join("");
  function paletteMalen() {
    paletteEl.querySelectorAll(".ar-chip").forEach(b =>
      b.classList.toggle("aktiv", b.getAttribute("data-art") === armiert));
  }
  paletteEl.querySelectorAll(".ar-chip").forEach(b => b.onclick = () => {
    const a = b.getAttribute("data-art");
    armiert = armiert === a ? null : a;
    auswahl = null; hoehePanelZeigen(); paletteMalen(); statusText();
  });

  // ------------------------------------------------------ Höhen-Panel

  const hoeheRange = overlay.querySelector(".ar-hoehe-range");
  hoeheRange.max = String(Number(raum.hoeheM) || 3);
  function hoehePanelZeigen() {
    const e = auswahl?.typ === "einbau" ? einbauten.find(x => x.id === auswahl.id) : null;
    hoehePanel.hidden = !e;
    if (!e) return;
    overlay.querySelector(".ar-hoehe-name").textContent = Normmasse.ARTEN.get(e.art) || e.art;
    hoeheRange.value = String(hoeheEinbau(e));
    overlay.querySelector(".ar-hoehe-wert").textContent = `${Math.round(hoeheEinbau(e) * 100)} cm über fertigem Boden`;
  }
  hoeheRange.oninput = () => {
    const e = auswahl?.typ === "einbau" ? einbauten.find(x => x.id === auswahl.id) : null;
    if (!e) return;
    e.hoeheM = Math.round(Number(hoeheRange.value) * 100) / 100;
    overlay.querySelector(".ar-hoehe-wert").textContent = `${Math.round(e.hoeheM * 100)} cm über fertigem Boden`;
    markerAktualisieren(e);
    opts.onAenderung && opts.onAenderung();
  };

  // ----------------------------------------------------- Setzen/Wählen

  function waehle(typ, id) {
    auswahl = typ ? { typ, id } : null;
    for (const [, m] of marker) markerAktualisieren(m.e);
    neuBewerten();
    hoehePanelZeigen();
  }

  function bodenPunkt() {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -traeger.position.y);
    const ziel = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, ziel)) return null;
    const lok = inner.worldToLocal(ziel.clone());
    return [lok.x, lok.z];
  }

  function anWand(e, rx, rz) {
    const w = Geometrie.naechsteWand(raum, rx, rz);
    const laenge = Geometrie.wandLaengen(raum)[w.index] || 0;
    e.befestigung = "WAND";
    e.wandIndex = w.index;
    e.abstandM = Math.round(Math.max(0, Math.min(laenge, w.abstand)) * 100) / 100;
  }

  function setzeEinbau(art, rx, rz) {
    const bef = Normmasse.befestigung(art);
    const e = { id: opts.neueId("ein"), raumId: raum.id, art, befestigung: bef, hoeheM: Normmasse.hoehe(art), relX: 0.5, relY: 0.5 };
    if (bef === "WAND") anWand(e, rx, rz);
    else { e.relX = klemm01(rx / (Geometrie.breite(raum) || 1)); e.relY = klemm01(rz / (Geometrie.tiefe(raum) || 1)); }
    einbauten.push(e);
    opts.einbauHinzufuegen && opts.einbauHinzufuegen(e);
    baueMarker(e);
    waehle("einbau", e.id);
    opts.onAenderung && opts.onAenderung();
  }

  function verschiebe(rx, rz) {
    if (!auswahl) return;
    if (auswahl.typ === "einbau") {
      const e = einbauten.find(x => x.id === auswahl.id); if (!e) return;
      const bef = e.befestigung || Normmasse.befestigung(e.art);
      if (bef === "WAND") anWand(e, rx, rz);
      else { e.relX = klemm01(rx / (Geometrie.breite(raum) || 1)); e.relY = klemm01(rz / (Geometrie.tiefe(raum) || 1)); }
      markerAktualisieren(e);
    } else {
      const ph = phs.find(p => p.id === auswahl.id); if (!ph) return;
      ph.xM = Math.round(Math.max(0, Math.min(Geometrie.breite(raum), rx)) * 100) / 100;
      ph.yM = Math.round(Math.max(0, Math.min(Geometrie.tiefe(raum), rz)) * 100) / 100;
      neuBewerten();
    }
    opts.onAenderung && opts.onAenderung();
  }

  const raycaster = new THREE.Raycaster();
  function tippen(cx, cy) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    if (armiert) { const fl = bodenPunkt(); if (fl) setzeEinbau(armiert, fl[0], fl[1]); armiert = null; paletteMalen(); statusText(); return; }
    const mt = raycaster.intersectObjects([...marker.values()].map(m => m.box), false);
    if (mt.length) { waehle("einbau", mt[0].object.userData.einbauId); statusText(); return; }
    const bt = raycaster.intersectObjects([...boxen.values()], false);
    if (bt.length) { waehle("box", bt[0].object.userData.phId); return; }
    if (auswahl) { const fl = bodenPunkt(); if (fl) verschiebe(fl[0], fl[1]); return; }
    waehle(null);
  }

  // ------------------------------------------------------- Kamera/Sensor

  const zustand = { entfernung: 2.5, groesse: 1, augenhoehe: 1.5, gier: 0, neigung: 0, orient: null, laeuft: true, xrSession: null };
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = strom; await video.play(); zustand.kamera = strom;
  } catch (_) { overlay.classList.add("ohne-kamera"); }
  await ausrichtungStarten(zustand);

  overlay.querySelector(".ar-entf").oninput = e => { zustand.entfernung = Number(e.target.value); };
  overlay.querySelector(".ar-groesse").oninput = e => { zustand.groesse = Number(e.target.value); };
  overlay.querySelector(".ar-kam").oninput = e => { zustand.augenhoehe = Number(e.target.value); };

  let start = null, bewegt = false;
  canvas.addEventListener("pointerdown", e => { start = [e.clientX, e.clientY]; bewegt = false; });
  canvas.addEventListener("pointermove", e => {
    if (!start) return;
    if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) {
      bewegt = true;
      zustand.gier -= (e.clientX - start[0]) * 0.005;
      zustand.neigung = Math.max(-1.2, Math.min(1.2, zustand.neigung - (e.clientY - start[1]) * 0.005));
      start = [e.clientX, e.clientY];
    }
  });
  window.addEventListener("pointerup", e => { if (start && !bewegt) tippen(e.clientX, e.clientY); start = null; });

  function groessen() {
    const w = overlay.clientWidth, h = overlay.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  groessen();
  window.addEventListener("resize", groessen);

  function schleife() {
    if (!zustand.laeuft || zustand.xrSession) return;
    traeger.position.set(0, -zustand.augenhoehe, -zustand.entfernung);
    traeger.scale.setScalar(zustand.groesse);
    if (zustand.orient) geraetQuaternion(camera.quaternion, zustand.orient, bildschirmWinkel());
    else camera.quaternion.setFromEuler(new THREE.Euler(zustand.neigung, zustand.gier, 0, "YXZ"));
    renderer.render(scene, camera);
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  const beenden = () => {
    zustand.laeuft = false;
    if (zustand.xrSession) zustand.xrSession.end().catch(() => {});
    if (zustand.kamera) zustand.kamera.getTracks().forEach(t => t.stop());
    window.removeEventListener("resize", groessen);
    renderer.dispose(); overlay.remove();
    opts.onEnde && opts.onEnde();
  };
  overlay.querySelector(".ar-zu").onclick = beenden;

  const xrKnopf = overlay.querySelector(".ar-xr");
  if (await xrMoeglich()) {
    xrKnopf.hidden = false;
    xrKnopf.onclick = () => xrStarten(renderer, scene, traeger, camera, zustand, hinweis).catch(() => {
      hinweis.textContent = "Welt-Tracking nicht möglich – Magic-Window läuft weiter.";
    });
  }
  return { beenden };
}

const klemm01 = v => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));

// --------------------------------------------------- Geräteausrichtung

async function ausrichtungStarten(zustand) {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  try { if (typeof DOE.requestPermission === "function" && await DOE.requestPermission() !== "granted") return; }
  catch (_) { return; }
  window.addEventListener("deviceorientation", e => {
    if (e.alpha == null) return;
    zustand.orient = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  });
}
function bildschirmWinkel() {
  const o = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return (Number(o) || 0) * Math.PI / 180;
}
const _zee = new THREE.Vector3(0, 0, 1), _euler = new THREE.Euler(), _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function geraetQuaternion(q, o, schirm) {
  const g = Math.PI / 180;
  _euler.set(o.beta * g, o.alpha * g, -o.gamma * g, "YXZ");
  q.setFromEuler(_euler); q.multiply(_q1); q.multiply(_q0.setFromAxisAngle(_zee, -schirm));
}

// ------------------------------------------------------- WebXR

async function xrStarten(renderer, scene, traeger, magicCam, zustand, hinweis) {
  const session = await navigator.xr.requestSession("immersive-ar", { optionalFeatures: ["local-floor", "dom-overlay"] });
  zustand.xrSession = session;
  renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType("local-floor"); } catch (_) { renderer.xr.setReferenceSpaceType("local"); }
  await renderer.xr.setSession(session);
  hinweis.textContent = "Welt-Tracking aktiv – Kamerahöhe kommt vom Gerät. Im Raum umhergehen.";
  traeger.position.set(0, 0, -1.5); traeger.scale.setScalar(1);
  renderer.setAnimationLoop(() => renderer.render(scene, renderer.xr.getCamera(magicCam)));
  session.addEventListener("end", () => { zustand.xrSession = null; renderer.xr.enabled = false; renderer.setAnimationLoop(null); });
}
