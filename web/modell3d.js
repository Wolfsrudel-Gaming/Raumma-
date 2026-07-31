/*
 * Dreidimensionales Modell der Unterkunft.
 *
 * Die Räume stehen bereits mit Maßen, Lage und Höhe in der Datenbank – hier
 * werden sie zu Körpern: Boden und Wände je Raum, Geschosse übereinander,
 * Namen im Raum. Man kann von aussen darauf schauen, Räume an ihren Platz
 * schieben und in Augenhöhe hindurchgehen.
 *
 * Bewusst als eigenes Modul, das erst beim Öffnen der Ansicht geladen wird:
 * three.js wiegt gut 700 kB, und wer nur eine Prüfung erfassen will, soll die
 * nicht mitschleppen. three.js liegt lokal unter ./lib/ – kein CDN, damit die
 * Ansicht auch im Keller ohne Netz funktioniert, sobald sie einmal geladen war.
 *
 * Die Rechnung „welche Ecken hat ein Raum" steht bewusst *nicht* hier: Sie
 * gehört zum Raum und kommt vom Aufrufer mit, damit Grundriss und Modell
 * garantiert dasselbe Viereck meinen.
 */
import * as THREE from "./lib/three.module.min.js";

const WANDSTAERKE = 0.12;   // m – reicht, um die Wand als Körper zu sehen
const AUGENHOEHE = 1.65;    // m – Augenhöhe eines stehenden Menschen
const GEHTEMPO = 2.4;       // m/s – ruhiger Schritt, kein Dauerlauf

export function createModel(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eaf2f2");
  scene.add(new THREE.HemisphereLight("#ffffff", "#9fb3b3", 2.2));
  const sonne = new THREE.DirectionalLight("#ffffff", 1.6);
  sonne.position.set(12, 20, 8);
  scene.add(sonne);

  // Boden mit Metergitter – ohne Bezugsgröße schwebt alles im Nichts.
  const gitter = new THREE.GridHelper(80, 80, "#b9cccc", "#d8e5e5");
  gitter.position.y = -0.01;
  scene.add(gitter);

  const camera = new THREE.PerspectiveCamera(
    60, container.clientWidth / container.clientHeight, 0.1, 500);

  // Umlaufende Ansicht: Blickpunkt, Abstand und zwei Winkel.
  const orbit = { ziel: new THREE.Vector3(6, 1.2, 6), abstand: 22, gier: -0.7, neigung: 0.85 };
  const mitteBau = new THREE.Vector3(0, 0, 0);   // Mitte des erfassten Bestands
  // Begehen: Standpunkt und Blickrichtung in Augenhöhe.
  const gehen = { pos: new THREE.Vector3(0, AUGENHOEHE, 0), gier: 0, neigung: 0, tasten: {}, pad: { x: 0, z: 0 } };
  let modus = "drehen";                  // drehen | verschieben | begehen | einrichten
  let bestueckung = null;                // in der Palette gewähltes Bauteil
  let raeume = [];                       // Rohdaten vom Aufrufer
  const gruppen = new Map();             // id -> { outer, inner, meshes[], daten }
  let gewaehlt = null;
  let laeuft = true;

  // ---------------------------------------------------------------- Aufbau

  function leeren() {
    for (const g of gruppen.values()) {
      scene.remove(g.outer);
      g.outer.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    gruppen.clear();
  }

  /** Beschriftung als kleines Schild, das immer zum Betrachter zeigt. */
  function schild(text) {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = "bold 44px system-ui, sans-serif";
    const breite = Math.ceil(ctx.measureText(text).width) + 36;
    c.width = breite; c.height = 72;
    const g = c.getContext("2d");
    g.font = "bold 44px system-ui, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.strokeStyle = "#00696d"; g.lineWidth = 3;
    g.beginPath(); g.roundRect(2, 2, c.width - 4, c.height - 4, 12); g.fill(); g.stroke();
    g.fillStyle = "#1d2a2a"; g.textBaseline = "middle";
    g.fillText(text, 18, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(c.width / 72 * 0.55, 0.55, 1);
    sp.renderOrder = 10;
    return sp;
  }

  /** Farbe und Grösse je Einbau-Art – klein, aber im Raum wiederzuerkennen. */
  const EINBAU = {
    STECKDOSE: { farbe: "#f0f0f0", b: 0.09, h: 0.09, t: 0.03 },
    STECKDOSE_2FACH: { farbe: "#f0f0f0", b: 0.17, h: 0.09, t: 0.03 },
    STECKDOSE_3FACH: { farbe: "#f0f0f0", b: 0.25, h: 0.09, t: 0.03 },
    STECKDOSE_CEE: { farbe: "#e8534f", b: 0.12, h: 0.16, t: 0.09 },
    SCHALTER: { farbe: "#e8e8e8", b: 0.09, h: 0.09, t: 0.03 },
    WECHSELSCHALTER: { farbe: "#e8e8e8", b: 0.09, h: 0.09, t: 0.03 },
    KREUZSCHALTER: { farbe: "#e8e8e8", b: 0.09, h: 0.09, t: 0.03 },
    TASTER: { farbe: "#dcdcdc", b: 0.09, h: 0.09, t: 0.03 },
    DIMMER: { farbe: "#d0d0d0", b: 0.09, h: 0.09, t: 0.04 },
    BEWEGUNGSMELDER: { farbe: "#f5f5f5", b: 0.10, h: 0.08, t: 0.07 },
    NETZWERKDOSE: { farbe: "#e9f0ff", b: 0.09, h: 0.09, t: 0.03 },
    ANTENNENDOSE: { farbe: "#f0efe6", b: 0.09, h: 0.09, t: 0.03 },
    TELEFONDOSE: { farbe: "#f0efe6", b: 0.09, h: 0.09, t: 0.03 },
    WANDLEUCHTE: { farbe: "#ffe9a8", b: 0.25, h: 0.18, t: 0.14 },
    NOTLEUCHTE: { farbe: "#bdf0c8", b: 0.34, h: 0.14, t: 0.06 },
    HEIZKOERPER: { farbe: "#f2f2f2", b: 1.00, h: 0.55, t: 0.12 },
    THERMOSTAT: { farbe: "#ededed", b: 0.08, h: 0.08, t: 0.06 },
    LAMPE: { farbe: "#ffe9a8", b: 0.30, h: 0.10, t: 0.30 },
    SICHERUNGSKASTEN: { farbe: "#d9d9d9", b: 0.50, h: 0.40, t: 0.10 },
    KLIMA: { farbe: "#eef6ff", b: 0.85, h: 0.28, t: 0.20 },
    SANITAER: { farbe: "#ffffff", b: 0.45, h: 0.35, t: 0.30 },
    KUECHE: { farbe: "#e6e6e6", b: 0.60, h: 0.85, t: 0.60 },
    SCHRANK: { farbe: "#d8c3a5", b: 1.00, h: 2.00, t: 0.55 },
    REGAL: { farbe: "#cbb391", b: 1.00, h: 1.80, t: 0.40 },
    RAUCHMELDER: { farbe: "#fafafa", b: 0.12, h: 0.04, t: 0.12 },
    SONSTIGES: { farbe: "#cccccc", b: 0.20, h: 0.20, t: 0.10 }
  };

  /**
   * Ein Einbau als kleiner Körper.
   *
   * An der Wand sitzt er an der angegebenen Stelle in der angegebenen Höhe und
   * wird ein Stück zur Raummitte gerückt, damit er vor der Wand steht und
   * nicht in ihr steckt. An der Decke und auf dem Boden zählt die Lage im
   * Grundriss.
   */
  function einbauMesh(f, ecken, mitte, hoehe, breite, tiefe) {
    const art = EINBAU[f.type] || EINBAU.SONSTIGES;
    const geo = new THREE.BoxGeometry(art.b, art.h, art.t);
    const mat = new THREE.MeshLambertMaterial({ color: art.farbe });
    const m = new THREE.Mesh(geo, mat);
    m.userData.fixtureId = f.id;
    m.userData.roomId = f.roomId;

    if (f.mount === "WAND" && f.wallIndex != null) {
      const a = ecken[f.wallIndex % ecken.length];
      const b = ecken[(f.wallIndex + 1) % ecken.length];
      const dx = b.x - a.x, dz = b.y - a.y;
      const laenge = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(laenge, Number(f.offsetM) || 0));
      const px = a.x + dx / laenge * t, pz = a.y + dz / laenge * t;
      // Senkrecht von der Wand absetzen – so hängt das Gerät vor der Wand und
      // nicht in ihr, ohne dabei an der Wand entlang zu wandern.
      let nx = -dz / laenge, nz = dx / laenge;
      if ((mitte.x - px) * nx + (mitte.y - pz) * nz < 0) { nx = -nx; nz = -nz; }
      const ab = WANDSTAERKE / 2 + art.t / 2;
      m.position.set(px + nx * ab, Number(f.heightM) || 1.2, pz + nz * ab);
      m.rotation.y = Math.atan2(-dz, dx);
    } else if (f.mount === "DECKE") {
      m.position.set(Number(f.relX) * breite, hoehe - art.h / 2 - 0.03, Number(f.relY) * tiefe);
    } else {
      const y = f.mount === "BODEN" ? art.h / 2 : (Number(f.heightM) || art.h / 2);
      m.position.set(Number(f.relX) * breite, y, Number(f.relY) * tiefe);
    }
    return m;
  }

  /**
   * Die Öffnung selbst sichtbar machen: Fenster als Scheibe, Türen als
   * Rahmen. Ohne etwas Sichtbares wäre eine Tür nur ein Loch – man könnte sie
   * weder anwählen noch von einem Durchgang unterscheiden.
   */
  function oeffnungZeichnen(l, a, dx, dz, laenge, winkel, inner, meshes, roomId, wallIndex) {
    const fenster = l.daten.type === "FENSTER";
    const b = l.o1 - l.o0, h = l.h;
    const geo = new THREE.BoxGeometry(b, h, fenster ? 0.03 : WANDSTAERKE * 0.9);
    const mat = new THREE.MeshLambertMaterial({
      color: fenster ? "#bfe0f0" : "#a8c4c6",
      transparent: true, opacity: fenster ? 0.4 : 0.12
    });
    const m = new THREE.Mesh(geo, mat);
    const tm = (l.o0 + l.o1) / 2;
    m.position.set(a.x + dx / laenge * tm, l.s + h / 2, a.y + dz / laenge * tm);
    m.rotation.y = winkel;
    m.userData.openingId = l.daten.id;
    m.userData.roomId = roomId;
    m.userData.wallIndex = wallIndex;
    inner.add(m); meshes.push(m);
    const rahmen = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: fenster ? "#4a8ba8" : "#00696d" })
    );
    rahmen.position.copy(m.position); rahmen.rotation.copy(m.rotation);
    inner.add(rahmen);
  }

  function baueRaum(r) {
    const ecken = r.corners.map(([x, z]) => new THREE.Vector2(x, z));
    const breite = Math.max(...ecken.map(p => p.x));
    const tiefe = Math.max(...ecken.map(p => p.y));
    const hoehe = Number(r.heightM) || 2.5;

    const outer = new THREE.Group();
    outer.position.set(Number(r.posX) + breite / 2, r.baseY, Number(r.posY) + tiefe / 2);
    // Im Grundriss wird im Uhrzeigersinn gedreht; in der Szene zeigt +z nach
    // „unten" im Plan, deshalb das Vorzeichen.
    outer.rotation.y = -(Number(r.rotationDeg) || 0) * Math.PI / 180;
    const inner = new THREE.Group();
    inner.position.set(-breite / 2, 0, -tiefe / 2);
    outer.add(inner);

    const meshes = [];
    const bodenMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(r.color || "#cfe8e9"), side: THREE.DoubleSide
    });
    const shape = new THREE.Shape(ecken);
    const bodenGeo = new THREE.ShapeGeometry(shape);
    bodenGeo.rotateX(Math.PI / 2);
    const boden = new THREE.Mesh(bodenGeo, bodenMat);
    boden.position.y = 0.02;
    boden.userData.roomId = r.id;
    inner.add(boden); meshes.push(boden);

    const wandMat = new THREE.MeshLambertMaterial({ color: "#f3f8f8" });
    const kantenMat = new THREE.LineBasicMaterial({ color: "#7d9394" });
    const mitte = new THREE.Vector2(
      ecken.reduce((s, p) => s + p.x, 0) / ecken.length,
      ecken.reduce((s, p) => s + p.y, 0) / ecken.length
    );

    for (let i = 0; i < ecken.length; i++) {
      const a = ecken[i], b = ecken[(i + 1) % ecken.length];
      const dx = b.x - a.x, dz = b.y - a.y;
      const laenge = Math.hypot(dx, dz);
      if (laenge < 0.05) continue;
      const winkel = Math.atan2(-dz, dx);

      /** Wandstück in Wandkoordinaten: t von…bis entlang, y von…bis hoch. */
      const stueck = (t0, t1, y0, y1) => {
        if (t1 - t0 < 0.01 || y1 - y0 < 0.01) return;
        const geo = new THREE.BoxGeometry(t1 - t0, y1 - y0, WANDSTAERKE);
        const m = new THREE.Mesh(geo, wandMat);
        const tm = (t0 + t1) / 2;
        m.position.set(a.x + dx / laenge * tm, (y0 + y1) / 2, a.y + dz / laenge * tm);
        m.rotation.y = winkel;
        m.userData.roomId = r.id;
        m.userData.wallIndex = i;
        inner.add(m); meshes.push(m);
        // Kanten mitzeichnen: Ohne sie verschwimmen gleich helle Wände
        // ineinander – von aussen wie beim Durchgehen.
        const kanten = new THREE.LineSegments(new THREE.EdgesGeometry(geo), kantenMat);
        kanten.position.copy(m.position); kanten.rotation.copy(m.rotation);
        inner.add(kanten);
      };

      // Öffnungen dieser Wand der Reihe nach abarbeiten: Zwischen ihnen bleibt
      // die volle Wand stehen, über der Öffnung der Sturz, unter einem Fenster
      // die Brüstung. Genau so entsteht ein Loch, durch das man gehen kann.
      const loecher = (r.openings || [])
        .filter(o => o.wallIndex === i)
        .map(o => ({
          o0: Math.max(0, Math.min(laenge, Number(o.offsetM))),
          o1: Math.max(0, Math.min(laenge, Number(o.offsetM) + Number(o.widthM))),
          s: Number(o.sillM), h: Number(o.heightM), daten: o
        }))
        .filter(l => l.o1 > l.o0)
        .sort((p, q) => p.o0 - q.o0);

      let t = 0;
      for (const l of loecher) {
        stueck(t, l.o0, 0, hoehe);                     // volle Wand davor
        stueck(l.o0, l.o1, 0, Math.min(l.s, hoehe));   // Brüstung unter dem Fenster
        stueck(l.o0, l.o1, Math.min(l.s + l.h, hoehe), hoehe);  // Sturz darüber
        t = Math.max(t, l.o1);
        oeffnungZeichnen(l, a, dx, dz, laenge, winkel, inner, meshes, r.id, i);
      }
      stueck(t, laenge, 0, hoehe);                     // Rest der Wand
    }

    // Einbauten: an der Wand, an der Decke oder auf dem Boden.
    for (const f of (r.fixtures || [])) {
      const m = einbauMesh(f, ecken, mitte, hoehe, breite, tiefe);
      if (m) { inner.add(m); meshes.push(m); }
    }

    const beschriftung = ((r.number ? r.number + " " : "") + r.name).trim();
    let namensschild = null;
    if (beschriftung) {
      namensschild = schild(beschriftung);
      namensschild.position.set(breite / 2, hoehe + 0.5, tiefe / 2);
      inner.add(namensschild);
    }

    scene.add(outer);
    gruppen.set(r.id, {
      outer, inner, meshes, daten: r, breite, tiefe, hoehe, wandMat, bodenMat, namensschild
    });
    schilderTiefentest(modus === "begehen");
  }

  /**
   * Geschosse übereinander stapeln: Jedes Geschoss beginnt über dem höchsten
   * Raum des darunterliegenden, plus Decke. Wer nur ein Erdgeschoss erfasst
   * hat, merkt davon nichts.
   */
  function geschosshoehen(items) {
    const etagen = [...new Set(items.map(r => r.floor))].sort((a, b) => a - b);
    const hoeheJe = new Map();
    etagen.forEach(f => hoeheJe.set(f,
      Math.max(...items.filter(r => r.floor === f).map(r => Number(r.heightM) || 2.5))));
    const basis = new Map();
    let z = 0;
    // Von der untersten Etage nach oben; Untergeschosse liegen unter null.
    const abNull = etagen.filter(f => f >= 0);
    abNull.forEach(f => { basis.set(f, z); z += hoeheJe.get(f) + 0.3; });
    let unten = 0;
    etagen.filter(f => f < 0).sort((a, b) => b - a).forEach(f => {
      unten -= (hoeheJe.get(f) + 0.3); basis.set(f, unten);
    });
    return basis;
  }

  function setRooms(items) {
    leeren();
    raeume = items;
    const basis = geschosshoehen(items);
    items.forEach(r => baueRaum(Object.assign({}, r, { baseY: basis.get(r.floor) || 0 })));
    if (items.length) {
      // Alles ins Bild holen: umschliessendes Rechteck über die Grundrisse,
      // nicht nur über die Eckpunkte der Lage – sonst steht die Kamera mitten
      // im grössten Raum.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const g of gruppen.values()) {
        x0 = Math.min(x0, Number(g.daten.posX));
        x1 = Math.max(x1, Number(g.daten.posX) + g.breite);
        z0 = Math.min(z0, Number(g.daten.posY));
        z1 = Math.max(z1, Number(g.daten.posY) + g.tiefe);
      }
      mitteBau.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
      orbit.ziel.copy(mitteBau);
      orbit.abstand = Math.max(12, Math.hypot(x1 - x0, z1 - z0) * 1.25);
      gehen.pos.set(mitteBau.x, (basis.get(items[0].floor) || 0) + AUGENHOEHE, mitteBau.z);
    }
    waehle(gewaehlt && gruppen.has(gewaehlt) ? gewaehlt : null);
  }

  /**
   * Namensschilder: von aussen sollen sie durch die Wände lesbar bleiben –
   * beim Begehen wäre das verwirrend, dort gehören sie hinter die Wand.
   */
  function schilderTiefentest(an) {
    for (const g of gruppen.values()) {
      if (!g.namensschild) continue;
      g.namensschild.material.depthTest = an;
      g.namensschild.renderOrder = an ? 0 : 10;
      g.namensschild.material.needsUpdate = true;
    }
  }

  function waehle(id) {
    gewaehlt = id;
    for (const [rid, g] of gruppen) {
      // Zurückhaltend hervorheben: Beim Begehen sollen die Wände nicht die
      // Farbe wechseln, nur weil der Raum ausgewählt ist.
      g.wandMat.color.set(rid === id ? "#fff2d9" : "#f3f8f8");
      g.bodenMat.emissive.set(rid === id ? "#4a3400" : "#000000");
    }
    if (opts.onSelect) opts.onSelect(id ? gruppen.get(id).daten : null);
  }

  // ------------------------------------------------------------ Bedienung

  const zeiger = new Map();          // laufende Berührungen
  let letzte = null, ziehtRaum = null, greifpunkt = null, startPos = null;
  let pinchStart = null;
  const strahl = new THREE.Raycaster();

  function normPos(e) {
    const r = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
  }

  function treffer(e) {
    strahl.setFromCamera(normPos(e), camera);
    const alle = [];
    for (const g of gruppen.values()) alle.push(...g.meshes);
    const t = strahl.intersectObjects(alle, false);
    return t.length ? t[0] : null;
  }

  /** Punkt auf der Bodenebene eines Geschosses – dorthin wird geschoben. */
  function bodenPunkt(e, y) {
    strahl.setFromCamera(normPos(e), camera);
    const ebene = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    return strahl.ray.intersectPlane(ebene, p) ? p : null;
  }

  renderer.domElement.addEventListener("pointerdown", e => {
    renderer.domElement.setPointerCapture(e.pointerId);
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    letzte = { x: e.clientX, y: e.clientY };
    if (zeiger.size === 2) { pinchStart = { d: pinchAbstand(), abstand: orbit.abstand }; return; }

    if (modus === "verschieben") {
      const t = treffer(e);
      if (t) {
        const id = t.object.userData.roomId;
        waehle(id);
        const g = gruppen.get(id);
        const p = bodenPunkt(e, g.outer.position.y);
        if (p) {
          ziehtRaum = id;
          greifpunkt = p.clone();
          startPos = { x: Number(g.daten.posX), y: Number(g.daten.posY) };
        }
      } else waehle(null);
    }

    if (modus === "einrichten") einrichtenKlick(e);
  });

  /**
   * Klick im Einrichten-Modus.
   *
   * Ist in der Palette etwas gewählt, entsteht dort ein neues Bauteil – an
   * der getroffenen Wand, an der getroffenen Stelle. Ist nichts gewählt,
   * wird das angetippte Bauteil zum Bearbeiten ausgewählt.
   */
  function einrichtenKlick(e) {
    const t = treffer(e);
    if (!t) { if (opts.onPick) opts.onPick(null); return; }
    const ud = t.object.userData;
    if (!bestueckung) {
      if (opts.onPick) {
        if (ud.openingId) opts.onPick({ kind: "oeffnung", id: ud.openingId });
        else if (ud.fixtureId) opts.onPick({ kind: "einbau", id: ud.fixtureId });
        else opts.onPick(null);
      }
      return;
    }
    const g = gruppen.get(ud.roomId);
    if (!g || !opts.onCreate) return;
    const lokal = g.inner.worldToLocal(t.point.clone());

    if (bestueckung.kind === "oeffnung" || bestueckung.mount === "WAND") {
      // Öffnungen und Wandgeräte brauchen eine Wand – der Boden reicht nicht.
      if (ud.wallIndex == null) return;
      const ecken = g.daten.corners;
      const a = ecken[ud.wallIndex % ecken.length];
      const b = ecken[(ud.wallIndex + 1) % ecken.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const laenge = Math.hypot(dx, dz) || 1;
      // Getroffenen Punkt auf die Wandlinie projizieren = Abstand von der Ecke.
      const s = ((lokal.x - a[0]) * dx + (lokal.z - a[1]) * dz) / (laenge * laenge) * laenge;
      const abstand = Math.max(0, Math.min(laenge, s));
      opts.onCreate(Object.assign({}, bestueckung, {
        roomId: ud.roomId, wallIndex: ud.wallIndex,
        offsetM: abstand, wandLaenge: laenge, klickHoehe: lokal.y
      }));
    } else {
      opts.onCreate(Object.assign({}, bestueckung, {
        roomId: ud.roomId,
        relX: Math.max(0, Math.min(1, lokal.x / g.breite)),
        relY: Math.max(0, Math.min(1, lokal.z / g.tiefe))
      }));
    }
  }

  function pinchAbstand() {
    const [a, b] = [...zeiger.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  renderer.domElement.addEventListener("pointermove", e => {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.size === 2 && pinchStart) {
      orbit.abstand = Math.max(3, Math.min(120, pinchStart.abstand * pinchStart.d / pinchAbstand()));
      return;
    }
    const dx = e.clientX - letzte.x, dy = e.clientY - letzte.y;
    letzte = { x: e.clientX, y: e.clientY };

    if (ziehtRaum) {
      const g = gruppen.get(ziehtRaum);
      const p = bodenPunkt(e, g.outer.position.y);
      if (!p) return;
      let nx = startPos.x + (p.x - greifpunkt.x);
      let ny = startPos.y + (p.z - greifpunkt.z);
      if (opts.snap) [nx, ny] = opts.snap(ziehtRaum, nx, ny);
      g.daten.posX = nx; g.daten.posY = ny;
      g.outer.position.x = nx + g.breite / 2;
      g.outer.position.z = ny + g.tiefe / 2;
      return;
    }

    if (modus === "begehen") {
      gehen.gier -= dx * 0.004;
      gehen.neigung = Math.max(-1.2, Math.min(1.2, gehen.neigung - dy * 0.004));
    } else {
      orbit.gier -= dx * 0.006;
      orbit.neigung = Math.max(0.08, Math.min(1.5, orbit.neigung - dy * 0.006));
    }
  });

  function losgelassen(e) {
    zeiger.delete(e.pointerId);
    if (zeiger.size < 2) pinchStart = null;
    if (ziehtRaum) {
      const g = gruppen.get(ziehtRaum);
      if (opts.onMoved) opts.onMoved(g.daten);
      ziehtRaum = null;
    }
  }
  renderer.domElement.addEventListener("pointerup", losgelassen);
  renderer.domElement.addEventListener("pointercancel", losgelassen);

  renderer.domElement.addEventListener("wheel", e => {
    e.preventDefault();
    orbit.abstand = Math.max(3, Math.min(120, orbit.abstand * (1 + Math.sign(e.deltaY) * 0.12)));
  }, { passive: false });

  const taste = e => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      gehen.tasten[k] = e.type === "keydown";
      if (modus === "begehen") e.preventDefault();
    }
  };
  window.addEventListener("keydown", taste);
  window.addEventListener("keyup", taste);

  // --------------------------------------------------------------- Ablauf

  let vorher = performance.now();
  function schritt(jetzt) {
    if (!laeuft) return;
    const dt = Math.min(0.05, (jetzt - vorher) / 1000);
    vorher = jetzt;

    if (modus === "begehen") {
      const t = gehen.tasten;
      let vor = (t.w || t.arrowup ? 1 : 0) - (t.s || t.arrowdown ? 1 : 0);
      let seit = (t.d || t.arrowright ? 1 : 0) - (t.a || t.arrowleft ? 1 : 0);
      vor += gehen.pad.z; seit += gehen.pad.x;
      if (vor || seit) {
        const s = GEHTEMPO * dt;
        gehen.pos.x += (-Math.sin(gehen.gier) * vor + Math.cos(gehen.gier) * seit) * s;
        gehen.pos.z += (-Math.cos(gehen.gier) * vor - Math.sin(gehen.gier) * seit) * s;
      }
      camera.position.copy(gehen.pos);
      camera.lookAt(
        gehen.pos.x - Math.sin(gehen.gier),
        gehen.pos.y + Math.sin(gehen.neigung),
        gehen.pos.z - Math.cos(gehen.gier)
      );
    } else {
      camera.position.set(
        orbit.ziel.x + orbit.abstand * Math.cos(orbit.neigung) * Math.sin(orbit.gier),
        orbit.ziel.y + orbit.abstand * Math.sin(orbit.neigung),
        orbit.ziel.z + orbit.abstand * Math.cos(orbit.neigung) * Math.cos(orbit.gier)
      );
      camera.lookAt(orbit.ziel);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);

  /** In welchem Raum steht man gerade? Für die Anzeige beim Begehen. */
  function raumUnterKamera() {
    const p = camera.position;
    for (const [id, g] of gruppen) {
      const lokal = g.inner.worldToLocal(p.clone());
      if (lokal.y < -0.2 || lokal.y > g.hoehe + 0.2) continue;
      if (imViereck(lokal.x, lokal.z, g.daten.corners)) return g.daten;
    }
    return null;
  }
  function imViereck(x, y, ecken) {
    let drin = false;
    for (let i = 0, j = ecken.length - 1; i < ecken.length; j = i++) {
      const [xi, yi] = ecken[i], [xj, yj] = ecken[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) drin = !drin;
    }
    return drin;
  }

  return {
    setRooms,
    setMode(m) {
      modus = m;
      schilderTiefentest(m === "begehen");
      if (m === "begehen") {
        // In den gewählten Raum stellen, sonst in die Mitte des Bestands.
        const g = gewaehlt ? gruppen.get(gewaehlt) : gruppen.values().next().value;
        if (g) {
          const mitte = new THREE.Vector3(g.breite / 2, AUGENHOEHE, g.tiefe / 2);
          g.inner.localToWorld(mitte);
          gehen.pos.copy(mitte);
          // Blick zur Hausmitte statt stur nach Norden – sonst steht man
          // beim Umschalten mit der Nase an der Wand.
          const dx = mitteBau.x - mitte.x, dz = mitteBau.z - mitte.z;
          gehen.gier = Math.hypot(dx, dz) > 0.5 ? Math.atan2(-dx, -dz) : orbit.gier;
          gehen.neigung = 0;
        }
      }
    },
    getMode: () => modus,
    /** Was in der Palette scharf geschaltet ist – null = auswählen statt bauen. */
    setBestueckung(b) { bestueckung = b; },
    select: waehle,
    selected: () => (gewaehlt ? gruppen.get(gewaehlt).daten : null),
    /** Raum um `grad` weiterdrehen – im Modell direkt sichtbar. */
    rotateSelected(grad) {
      if (!gewaehlt) return null;
      const g = gruppen.get(gewaehlt);
      const neu = (((Number(g.daten.rotationDeg) || 0) + grad) % 360 + 360) % 360;
      g.daten.rotationDeg = neu;
      g.outer.rotation.y = -neu * Math.PI / 180;
      return g.daten;
    },
    setPad(x, z) { gehen.pad.x = x; gehen.pad.z = z; },
    currentRoom: raumUnterKamera,
    resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    dispose() {
      laeuft = false;
      window.removeEventListener("keydown", taste);
      window.removeEventListener("keyup", taste);
      leeren();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };
}
