/*
 * AR-Besprechung – die Planung im echten Raum zeigen und vor Ort anpassen.
 *
 * Zweck (Wunsch aus der Praxis): am PC planen, dann vor Ort mit dem Kunden die
 * geplanten Geräte im tatsächlichen Raum überlagert durchsprechen – und wenn
 * der Kunde „lieber dorthin" sagt, das Gerät gleich verschieben.
 *
 * Zwei Wege, bewusst in dieser Reihenfolge:
 *  1. **Magic-Window** (Standard): Kamerabild als Hintergrund, das Plan-Modell
 *     als three.js-Überlagerung, gedreht über die Geräteausrichtung. Braucht
 *     **kein ARCore** – wichtig, weil ARCore auf dem gerooteten Feldgerät
 *     unzuverlässig ist (Konzept §5). Antippen wählt ein Gerät, Boden antippen
 *     verschiebt es.
 *  2. **WebXR-Welttracking** (Aufwertung): echtes immersive-ar, wo unterstützt.
 *
 * **Live-Normprüfung** läuft mit: Vor jedem Gerät liegt seine Freiraumzone am
 * Boden – grün, solange der Bedienbereich frei ist, rot bei Unterschreitung;
 * das Gerät selbst färbt sich rot. Dieselbe Prüfung wie am PC (`pruefung.js`),
 * jetzt im Kamerabild.
 */

import * as THREE from "../lib/three.module.min.js";
import * as Geometrie from "../geometrie.js";
import { pruefe, grundriss } from "../pruefung.js";
import { fuer, Richtung } from "../regelwerk.js";

const AUGENHOEHE = 1.5;   // m – Kamera etwa auf Augenhöhe über dem Boden

/** Prüft, ob echtes WebXR-AR zur Verfügung steht. */
export async function xrMoeglich() {
  try {
    return !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar"));
  } catch (_) {
    return false;
  }
}

/** Startet die AR-Besprechung (Magic-Window; XR als Knopf, wo möglich). */
export async function starte(opts) {
  const raum = opts.raum;
  const phs = opts.platzhalter;      // echte Referenzen – Verschieben wirkt im Modell
  const finde = opts.findeKomponente;

  const overlay = document.createElement("div");
  overlay.className = "ar-overlay";
  overlay.innerHTML = `
    <video class="ar-video" playsinline muted></video>
    <canvas class="ar-canvas"></canvas>
    <div class="ar-ui">
      <button class="ar-zu">Beenden</button>
      <div class="ar-hinweis"></div>
      <div class="ar-regler">
        <label>Entfernung <input class="ar-entf" type="range" min="1" max="6" step="0.1" value="2.5"></label>
        <label>Größe <input class="ar-groesse" type="range" min="0.1" max="1" step="0.05" value="1"></label>
        <button class="ar-xr" hidden>Welt-Tracking</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector(".ar-video");
  const canvas = overlay.querySelector(".ar-canvas");
  const hinweis = overlay.querySelector(".ar-hinweis");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2));
  const camera = new THREE.PerspectiveCamera(65, 1, 0.01, 100);

  // ---- Plan aufbauen: Träger → inner (Raumkoordinaten), Boxen, Zonen --------
  const traeger = new THREE.Group();
  const inner = new THREE.Group();
  traeger.add(inner);
  scene.add(traeger);
  // Raummitte in den Ursprung des Trägers schieben.
  inner.position.set(-Geometrie.breite(raum) / 2, 0, -Geometrie.tiefe(raum) / 2);

  // Bodenumriss + leicht gefüllte Fläche.
  const eckenR = Geometrie.ecken(raum);
  const linie = eckenR.map(([x, y]) => new THREE.Vector3(x, 0.002, y));
  linie.push(linie[0].clone());
  inner.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linie),
    new THREE.LineBasicMaterial({ color: 0x2b7a78 })));
  const bodenForm = new THREE.Shape(eckenR.map(([x, y]) => new THREE.Vector2(x, y)));
  const boden = new THREE.Mesh(new THREE.ShapeGeometry(bodenForm),
    new THREE.MeshBasicMaterial({ color: 0xcfe8e9, transparent: true, opacity: 0.15, side: THREE.DoubleSide }));
  boden.rotation.x = Math.PI / 2;
  inner.add(boden);

  const boxen = new Map();   // phId -> Mesh (mit userData.edges, .h)
  let zonen = [];            // Freiraumzonen-Meshes
  let auswahlId = null;

  for (const ph of phs) {
    const komp = finde(ph.komponente);
    if (!komp) continue;
    const b = Number(komp.breiteM), t = Number(komp.tiefeM), h = Number(komp.hoeheM);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b, h, t),
      new THREE.MeshBasicMaterial({ color: 0x2b7a78, transparent: true, opacity: 0.4 }));
    mesh.position.set(Number(ph.xM), h / 2, Number(ph.yM));
    mesh.rotation.y = -(Number(ph.drehungGrad) || 0) * Math.PI / 180;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x17494d }));
    mesh.add(edges);
    mesh.userData = { phId: ph.id, h, edges, warn: false };
    inner.add(mesh);
    boxen.set(ph.id, mesh);
  }

  function auswahlOptik(id) {
    const mesh = boxen.get(id);
    if (!mesh) return;
    const sel = id === auswahlId;
    mesh.material.opacity = sel ? 0.66 : 0.4;
    mesh.userData.edges.material.color.setHex(sel ? 0xffa500 : (mesh.userData.warn ? 0xc0392b : 0x17494d));
  }

  /** Live-Normprüfung: Boxen färben, Freiraumzonen neu aufbauen und färben. */
  function neuBewerten() {
    const befunde = pruefe(raum, phs);
    const warnMap = {};
    befunde.forEach(b => { if (b.schwere === "WARNUNG") warnMap[b.platzhalterId] = true; });

    for (const [id, mesh] of boxen) {
      mesh.userData.warn = !!warnMap[id];
      mesh.material.color.setHex(mesh.userData.warn ? 0xc0392b : 0x2b7a78);
      auswahlOptik(id);
    }

    for (const z of zonen) { inner.remove(z); z.geometry.dispose(); z.material.dispose(); }
    zonen = [];
    for (const ph of phs) {
      const komp = finde(ph.komponente);
      if (!komp) continue;
      const pts = zonePunkte(ph, komp);
      if (!pts) continue;
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])))),
        new THREE.MeshBasicMaterial({ color: warnMap[ph.id] ? 0xc0392b : 0x2e8b57, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.004;
      inner.add(mesh);
      zonen.push(mesh);
    }

    const w = Object.keys(warnMap).length;
    hinweis.innerHTML = `${phs.length} Gerät(e)${w ? ` · <b>${w} Warnung</b>` : " · alle Freiräume gewahrt"}`
      + "<br>Gerät antippen zum Wählen, Boden antippen zum Verschieben.";
  }

  function zonePunkte(ph, komp) {
    const regel = fuer(komp.kategorie).find(r => r.richtung === Richtung.VORNE);
    if (!regel || !komp.bedienseiteVorn) return null;
    const e = grundriss(ph, komp);          // Raumkoordinaten
    const bl = e[0], fr = e[2], fl = e[3];   // hinten-links, vorne-rechts, vorne-links
    const nx = fl[0] - bl[0], ny = fl[1] - bl[1];
    const len = Math.hypot(nx, ny) || 1;
    const d = Number(regel.abstandM);
    return [fr, fl, [fl[0] + nx / len * d, fl[1] + ny / len * d], [fr[0] + nx / len * d, fr[1] + ny / len * d]];
  }

  neuBewerten();

  const zustand = { entfernung: 2.5, groesse: 1, gierManuell: 0, neigungManuell: 0, orient: null, laeuft: true, xrSession: null };

  // Kamera-Passthrough (Rückkamera). Ohne Kamera bleibt der Hintergrund neutral.
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = strom; await video.play();
    zustand.kamera = strom;
  } catch (_) {
    overlay.classList.add("ohne-kamera");
  }

  await ausrichtungStarten(zustand);

  overlay.querySelector(".ar-entf").oninput = e => { zustand.entfernung = Number(e.target.value); };
  overlay.querySelector(".ar-groesse").oninput = e => { zustand.groesse = Number(e.target.value); };

  // ---- Zeiger: Ziehen dreht die Ansicht, Tippen wählt/verschiebt ------------
  const raycaster = new THREE.Raycaster();
  let start = null, bewegt = false;
  canvas.addEventListener("pointerdown", e => { start = [e.clientX, e.clientY]; bewegt = false; });
  canvas.addEventListener("pointermove", e => {
    if (!start) return;
    if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) {
      bewegt = true;
      zustand.gierManuell -= (e.clientX - start[0]) * 0.005;
      zustand.neigungManuell = Math.max(-1.2, Math.min(1.2, zustand.neigungManuell - (e.clientY - start[1]) * 0.005));
      start = [e.clientX, e.clientY];
    }
  });
  window.addEventListener("pointerup", e => {
    if (start && !bewegt) tippen(e.clientX, e.clientY);
    start = null;
  });

  function tippen(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const treffer = raycaster.intersectObjects([...boxen.values()], false);
    if (treffer.length) {
      auswahlId = treffer[0].object.userData.phId;
      boxen.forEach((_, id) => auswahlOptik(id));
      return;
    }
    if (auswahlId) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -traeger.position.y);
      const ziel = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, ziel)) {
        const lok = inner.worldToLocal(ziel.clone());
        verschiebe(lok.x, lok.z);
      }
    }
  }

  function verschiebe(rx, rz) {
    const ph = phs.find(p => p.id === auswahlId);
    if (!ph) return;
    const b = Geometrie.breite(raum), t = Geometrie.tiefe(raum);
    ph.xM = Math.round(Math.max(0, Math.min(b, rx)) * 100) / 100;
    ph.yM = Math.round(Math.max(0, Math.min(t, rz)) * 100) / 100;
    const mesh = boxen.get(ph.id);
    mesh.position.set(Number(ph.xM), mesh.userData.h / 2, Number(ph.yM));
    neuBewerten();
    opts.onAenderung && opts.onAenderung();
  }

  function groessen() {
    const w = overlay.clientWidth, h = overlay.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  groessen();
  window.addEventListener("resize", groessen);

  function schleife() {
    if (!zustand.laeuft || zustand.xrSession) return;
    traeger.position.set(0, -AUGENHOEHE, -zustand.entfernung);
    traeger.scale.setScalar(zustand.groesse);
    if (zustand.orient) geraetQuaternion(camera.quaternion, zustand.orient, bildschirmWinkel());
    else camera.quaternion.setFromEuler(new THREE.Euler(zustand.neigungManuell, zustand.gierManuell, 0, "YXZ"));
    renderer.render(scene, camera);
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  const beenden = () => {
    zustand.laeuft = false;
    if (zustand.xrSession) zustand.xrSession.end().catch(() => {});
    if (zustand.kamera) zustand.kamera.getTracks().forEach(t => t.stop());
    window.removeEventListener("resize", groessen);
    renderer.dispose();
    overlay.remove();
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

// --------------------------------------------------- Geräteausrichtung

async function ausrichtungStarten(zustand) {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  try {
    if (typeof DOE.requestPermission === "function") {
      if (await DOE.requestPermission() !== "granted") return;
    }
  } catch (_) { return; }
  window.addEventListener("deviceorientation", e => {
    if (e.alpha == null) return;
    zustand.orient = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  });
}

function bildschirmWinkel() {
  const o = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return (Number(o) || 0) * Math.PI / 180;
}

const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function geraetQuaternion(q, o, schirm) {
  const g = Math.PI / 180;
  _euler.set(o.beta * g, o.alpha * g, -o.gamma * g, "YXZ");
  q.setFromEuler(_euler);
  q.multiply(_q1);
  q.multiply(_q0.setFromAxisAngle(_zee, -schirm));
}

// ------------------------------------------------------- WebXR

async function xrStarten(renderer, scene, traeger, magicCam, zustand, hinweis) {
  const session = await navigator.xr.requestSession("immersive-ar", {
    optionalFeatures: ["local-floor", "dom-overlay"],
  });
  zustand.xrSession = session;
  renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType("local-floor"); } catch (_) { renderer.xr.setReferenceSpaceType("local"); }
  await renderer.xr.setSession(session);
  hinweis.textContent = "Welt-Tracking aktiv – im Raum umhergehen. Der Plan bleibt an seinem Platz.";
  traeger.position.set(0, 0, -1.5);
  traeger.scale.setScalar(1);
  renderer.setAnimationLoop(() => renderer.render(scene, renderer.xr.getCamera(magicCam)));
  session.addEventListener("end", () => {
    zustand.xrSession = null;
    renderer.xr.enabled = false;
    renderer.setAnimationLoop(null);
  });
}
