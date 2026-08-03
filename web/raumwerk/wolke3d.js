/*
 * Punktwolken-Betrachter – zeigt das Ergebnis der Verarbeitungs-Pipeline
 * (Schicht ②) im Browser (Schicht ③). Das schließt den Kreis: aus Aufnahmen
 * wird auf dem Server eine metrisch skalierte Wolke, die hier begehbar wird.
 *
 * Bewusst schlank und eigenständig (three.js, wie modell3d.js) – kein Potree
 * als Abhängigkeit für die Vorschau. Liest ASCII-PLY, zeichnet die Punkte,
 * lässt sich drehen und zoomen. Beim Verlassen wird gestoppt (Akku).
 */

import * as THREE from "../lib/three.module.min.js";

export class Wolke {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0f1615");
    this.camera = new THREE.PerspectiveCamera(60, this._seiten(), 0.01, 2000);

    this.ziel = new THREE.Vector3(0, 0, 0);
    this.gier = 0.7; this.neigung = 0.9; this.abstand = 10;
    this.punkte = null;
    this.laeuft = true;

    this._zeiger();
    this._schleife();
  }

  _seiten() {
    return (this.container.clientWidth || 800) / (this.container.clientHeight || 500);
  }

  /** Eine ASCII-PLY laden und als Punktwolke zeigen. */
  laden(plyText) {
    const { positionen, farben } = lesePly(plyText);
    if (this.punkte) { this.scene.remove(this.punkte); this.punkte.geometry.dispose(); this.punkte.material.dispose(); }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positionen, 3));
    let material;
    if (farben) {
      geo.setAttribute("color", new THREE.BufferAttribute(farben, 3));
      material = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true });
    } else {
      material = new THREE.PointsMaterial({ size: 0.03, color: "#5fd0c8", sizeAttenuation: true });
    }
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    const mitte = new THREE.Vector3(); box.getCenter(mitte);
    const groesse = new THREE.Vector3(); box.getSize(groesse);
    const spanne = Math.max(groesse.x, groesse.y, groesse.z) || 1;
    material.size = Math.max(0.005, spanne * 0.004);

    this.punkte = new THREE.Points(geo, material);
    this.scene.add(this.punkte);

    // Ein Metergitter unter die Wolke – ohne Bezug schwebt sie im Nichts.
    if (this.gitter) this.scene.remove(this.gitter);
    this.gitter = new THREE.GridHelper(Math.ceil(spanne) + 2, Math.ceil(spanne) + 2, "#2b7a78", "#20302f");
    this.gitter.position.set(mitte.x, box.min.y, mitte.z);
    this.scene.add(this.gitter);

    this.ziel.copy(mitte);
    this.abstand = spanne * 1.8 + 1;
    return { punkte: positionen.length / 3, spanne_m: Math.round(spanne * 100) / 100, farbig: !!farben };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  pause() { this.laeuft = false; }
  weiter() { if (!this.laeuft) { this.laeuft = true; this.resize(); this._schleife(); } }

  dispose() {
    this.laeuft = false;
    if (this.punkte) { this.punkte.geometry.dispose(); this.punkte.material.dispose(); }
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.remove();
  }

  // --------------------------------------------------- intern

  _schleife() {
    if (!this.laeuft) return;
    const x = this.ziel.x + this.abstand * Math.cos(this.neigung) * Math.sin(this.gier);
    const y = this.ziel.y + this.abstand * Math.sin(this.neigung);
    const z = this.ziel.z + this.abstand * Math.cos(this.neigung) * Math.cos(this.gier);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.ziel);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._schleife());
  }

  _zeiger() {
    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    let letzte = null;
    el.addEventListener("pointerdown", e => { letzte = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => {
      if (!letzte) return;
      this.gier -= (e.clientX - letzte[0]) * 0.006;
      this.neigung = Math.max(-1.4, Math.min(1.4, this.neigung - (e.clientY - letzte[1]) * 0.006));
      letzte = [e.clientX, e.clientY];
    });
    window.addEventListener("pointerup", () => { letzte = null; });
    el.addEventListener("wheel", e => {
      e.preventDefault();
      this.abstand = Math.max(0.3, Math.min(500, this.abstand * (e.deltaY < 0 ? 0.9 : 1.1)));
    }, { passive: false });
  }
}

/**
 * ASCII-PLY lesen: Kopf bis `end_header`, dann `element vertex N` Zeilen mit
 * x y z und optional roten/grünen/blauen Werten. Nachsichtig – unbekannte
 * Eigenschaften werden übersprungen.
 */
export function lesePly(text) {
  const zeilen = text.split(/\r?\n/);
  let i = 0, anzahl = 0;
  const eigenschaften = [];
  for (; i < zeilen.length; i++) {
    const z = zeilen[i].trim();
    if (z.startsWith("element vertex")) anzahl = parseInt(z.split(/\s+/)[2]) || 0;
    else if (z.startsWith("property")) eigenschaften.push(z.split(/\s+/).pop());
    else if (z === "end_header") { i++; break; }
  }
  const ix = eigenschaften.indexOf("x"), iy = eigenschaften.indexOf("y"), iz = eigenschaften.indexOf("z");
  const ir = eigenschaften.indexOf("red"), ig = eigenschaften.indexOf("green"), ib = eigenschaften.indexOf("blue");
  const hatFarbe = ir >= 0 && ig >= 0 && ib >= 0;

  const positionen = new Float32Array(anzahl * 3);
  const farben = hatFarbe ? new Float32Array(anzahl * 3) : null;
  let n = 0;
  for (; i < zeilen.length && n < anzahl; i++) {
    const teile = zeilen[i].trim().split(/\s+/);
    if (teile.length < 3 || teile[0] === "") continue;
    positionen[n * 3] = parseFloat(teile[ix]);
    positionen[n * 3 + 1] = parseFloat(teile[iy]);
    positionen[n * 3 + 2] = parseFloat(teile[iz]);
    if (hatFarbe) {
      farben[n * 3] = (parseFloat(teile[ir]) || 0) / 255;
      farben[n * 3 + 1] = (parseFloat(teile[ig]) || 0) / 255;
      farben[n * 3 + 2] = (parseFloat(teile[ib]) || 0) / 255;
    }
    n++;
  }
  return { positionen: positionen.subarray(0, n * 3), farben: farben ? farben.subarray(0, n * 3) : null };
}
