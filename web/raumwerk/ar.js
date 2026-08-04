/*
 * AR-Besprechung – die Planung im echten Raum zeigen.
 *
 * Zweck (Wunsch aus der Praxis): am PC planen, dann vor Ort mit dem Kunden die
 * geplanten Geräte im tatsächlichen Raum überlagert durchsprechen.
 *
 * Zwei Wege, bewusst in dieser Reihenfolge:
 *  1. **Magic-Window** (Standard): Kamerabild als Hintergrund, das Plan-Modell
 *     als three.js-Überlagerung, gedreht über die Geräteausrichtung. Braucht
 *     **kein ARCore** – wichtig, weil ARCore auf dem gerooteten Feldgerät
 *     unzuverlässig ist (Konzept §5). Läuft auf praktisch jedem Telefon.
 *  2. **WebXR-Welttracking** (Aufwertung): echtes immersive-ar, wo unterstützt.
 *
 * Gezeigt wird die aktive Variante: Raumumriss am Boden und die Klötzchen als
 * maßstabsgetreue, halbdurchsichtige Körper.
 */

import * as THREE from "../lib/three.module.min.js";
import * as Geometrie from "../geometrie.js";

const AUGENHOEHE = 1.5;   // m – Kamera etwa auf Augenhöhe über dem Boden

/** Baut das Plan-Modell (Raumumriss + Klötzchen) als three.js-Gruppe. */
function planGruppe(opts) {
  const g = new THREE.Group();
  const raum = opts.raum;
  const ecken = Geometrie.ecken(raum);

  // Bodenumriss und leicht gefüllte Fläche.
  const punkte = ecken.map(([x, y]) => new THREE.Vector3(x, 0.002, y));
  punkte.push(punkte[0].clone());
  g.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(punkte),
    new THREE.LineBasicMaterial({ color: 0x2b7a78 })));
  const form = new THREE.Shape(ecken.map(([x, y]) => new THREE.Vector2(x, y)));
  const boden = new THREE.Mesh(
    new THREE.ShapeGeometry(form),
    new THREE.MeshBasicMaterial({ color: 0xcfe8e9, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  boden.rotation.x = Math.PI / 2;   // Shape liegt in xy → auf den Boden kippen
  g.add(boden);

  // Klötzchen der aktiven Variante.
  for (const ph of opts.platzhalter) {
    const k = opts.findeKomponente(ph.komponente);
    if (!k) continue;
    const b = Number(k.breiteM), t = Number(k.tiefeM), h = Number(k.hoeheM);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(b, h, t),
      new THREE.MeshBasicMaterial({ color: 0x2b7a78, transparent: true, opacity: 0.4 }));
    box.position.set(Number(ph.xM), h / 2, Number(ph.yM));
    box.rotation.y = -(Number(ph.drehungGrad) || 0) * Math.PI / 180;
    box.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(box.geometry),
      new THREE.LineBasicMaterial({ color: 0x17494d })));
    g.add(box);
  }

  // Raummitte in den Ursprung schieben, damit sich das Modell bequem platzieren
  // lässt.
  const cx = Geometrie.breite(raum) / 2, cz = Geometrie.tiefe(raum) / 2;
  g.position.set(-cx, 0, -cz);
  const traeger = new THREE.Group();
  traeger.add(g);
  return traeger;
}

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
  const traeger = planGruppe(opts);
  scene.add(traeger);

  const zustand = { entfernung: 2.5, groesse: 1, gierManuell: 0, neigungManuell: 0, orient: null, laeuft: true, xrSession: null };

  // Kamera-Passthrough (bestes Ergebnis mit Rückkamera). Ohne Kamera bleibt der
  // Hintergrund neutral – das Modell ist trotzdem zu sehen.
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = strom;
    await video.play();
    zustand.kamera = strom;
  } catch (_) {
    overlay.classList.add("ohne-kamera");
  }

  // Geräteausrichtung (Magic-Window). Auf iOS erst nach Erlaubnis.
  await ausrichtungStarten(zustand);
  hinweis.textContent = zustand.orient
    ? "Telefon schwenken – der Plan bleibt im Raum stehen. Mit dem Kunden durchsprechen."
    : "Ziehen dreht die Ansicht · Regler unten für Entfernung und Größe.";

  // Größe/Entfernung
  overlay.querySelector(".ar-entf").oninput = (e) => { zustand.entfernung = Number(e.target.value); };
  overlay.querySelector(".ar-groesse").oninput = (e) => { zustand.groesse = Number(e.target.value); };

  // Manuelles Drehen per Finger/Maus (Fallback ohne Sensor, und zum Feinjustieren).
  let letzte = null;
  canvas.addEventListener("pointerdown", (e) => { letzte = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointermove", (e) => {
    if (!letzte) return;
    zustand.gierManuell -= (e.clientX - letzte[0]) * 0.005;
    zustand.neigungManuell = Math.max(-1.2, Math.min(1.2, zustand.neigungManuell - (e.clientY - letzte[1]) * 0.005));
    letzte = [e.clientX, e.clientY];
  });
  window.addEventListener("pointerup", () => { letzte = null; });

  function groessen() {
    const w = overlay.clientWidth, h = overlay.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  groessen();
  window.addEventListener("resize", groessen);

  function schleife() {
    if (!zustand.laeuft) return;
    if (!zustand.xrSession) {
      // Modell vor der Kamera platzieren, Kamera dreht sich mit dem Gerät.
      traeger.position.set(0, -AUGENHOEHE, -zustand.entfernung);
      traeger.scale.setScalar(zustand.groesse);
      if (zustand.orient) {
        geraetQuaternion(camera.quaternion, zustand.orient, bildschirmWinkel());
      } else {
        camera.quaternion.setFromEuler(new THREE.Euler(zustand.neigungManuell, zustand.gierManuell, 0, "YXZ"));
      }
      renderer.render(scene, camera);
      requestAnimationFrame(schleife);
    }
  }
  renderer.setAnimationLoop(null);
  requestAnimationFrame(schleife);

  // Beenden
  const beenden = () => {
    zustand.laeuft = false;
    if (zustand.xrSession) zustand.xrSession.end().catch(() => {});
    if (zustand.kamera) zustand.kamera.getTracks().forEach((t) => t.stop());
    window.removeEventListener("resize", groessen);
    renderer.dispose();
    overlay.remove();
    opts.onEnde && opts.onEnde();
  };
  overlay.querySelector(".ar-zu").onclick = beenden;

  // WebXR-Aufwertung anbieten, wenn möglich.
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
      const ok = await DOE.requestPermission();
      if (ok !== "granted") return;
    }
  } catch (_) { return; }
  window.addEventListener("deviceorientation", (e) => {
    if (e.alpha == null) return;
    zustand.orient = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  });
}

function bildschirmWinkel() {
  const o = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return (Number(o) || 0) * Math.PI / 180;
}

// Standard-Umrechnung Geräteausrichtung → Kamera-Quaternion (three.js-Rezept).
const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // -90° um x
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
    requiredFeatures: [],
    optionalFeatures: ["local-floor", "dom-overlay"],
  });
  zustand.xrSession = session;
  renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType("local-floor"); } catch (_) { renderer.xr.setReferenceSpaceType("local"); }
  await renderer.xr.setSession(session);
  hinweis.textContent = "Welt-Tracking aktiv – im Raum umhergehen. Der Plan bleibt an seinem Platz.";

  // Modell 1,5 m vor den Startpunkt auf den Boden stellen, in echter Größe.
  traeger.position.set(0, 0, -1.5);
  traeger.scale.setScalar(1);

  renderer.setAnimationLoop(() => renderer.render(scene, renderer.xr.getCamera(magicCam)));
  session.addEventListener("end", () => {
    zustand.xrSession = null;
    renderer.xr.enabled = false;
    renderer.setAnimationLoop(null);
    if (zustand.laeuft) requestAnimationFrame(function w() {
      // zurück ins Magic-Window
      renderer.render(scene, magicCam);
    });
  });
}
