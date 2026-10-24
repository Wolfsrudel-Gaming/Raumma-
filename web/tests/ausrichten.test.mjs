/*
 * Prüft das würfelfreie Ausrichten der AR-Ansicht (web/ausrichten.js).
 *
 * Vorgehen wie vor Ort, nur rückwärts: Ein bekannter Raum (Plan), ein wahrer
 * Standpunkt, eine wahre Gier des Sensors und eine wahre Kamerahöhe. Daraus
 * wird die Lage berechnet, die ein Handy beim Zielen auf die beiden
 * Bodenecken einer Wand hätte (über zielen.js wie in der App). `loese` muss
 * daraus Standpunkt, Drehung und Kamerahöhe zurückgewinnen: exakt ohne
 * Rauschen, auf wenige Zentimeter mit 0,3° Zittern.
 *
 * Aufruf: node web/tests/ausrichten.test.mjs   (Exitcode != 0 bei Fehler)
 */
import * as Z from "../zielen.js";
import * as G from "../geometrie.js";
import * as Au from "../ausrichten.js";

let ok = 0, fail = 0;
const nah = (name, got, want, tol = 1e-6) => {
  const p = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want} (±${tol})`); fail++; } else ok++;
};
const wahr = (name, b, info = "") => { if (!b) { console.error(`FAIL ${name} ${info}`); fail++; } else ok++; };
const winkelDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };

/** Lage (α, β, γ=0), mit der die Rückkamera genau in Richtung v schaut. */
function lageFuer(v) {
  const l = Math.hypot(...v);
  const [x, y, z] = v.map(c => c / l);
  return { alpha: Math.atan2(-x, y) / Z.GRAD, beta: Math.acos(-z) / Z.GRAD, gamma: 0 };
}

let seed = 5;
const zufall = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/**
 * Wahre Szene: Pose (Raum ← Sensorwelt) mit der **Körperachse** im Raum und
 * der Linsenhöhe über dem Boden im Bild (Handy senkrecht). Gezielt wird wie in
 * echt: Man dreht sich um die eigene Achse, die Linse sitzt r = 30 cm davor und
 * L = 8 cm über dem Drehpunkt der Hand (Freihand-Vorgabe von ausrichten.js).
 * Liefert die Blickrichtung (Sensorwelt) auf den Raumpunkt [x, y, z].
 */
const HAND = Au.haltungFreihand();
function szene(stand, psiGrad, hWahr) {
  const pose = { drehungRad: psiGrad * Z.GRAD, verschiebung: stand };
  const blick = p => {
    const w = Au.zurWelt(pose, p), D = Math.hypot(w[0], w[1]), zT = p[2] ?? 0, hw = hWahr - HAND.L;
    let th = 0.3;   // Neigung, unter der die Linse genau auf p schaut
    for (let k = 0; k < 60; k++) th = Math.atan2(hw + HAND.L * Math.cos(th) - zT, D - (HAND.r + HAND.L * Math.sin(th)));
    const psi = Math.atan2(w[0], w[1]);
    return [Math.sin(psi) * Math.cos(th), Math.cos(psi) * Math.cos(th), -Math.sin(th)];
  };
  return {
    pose,
    ziel(p, zittern = 0) {
      const l = lageFuer(blick(p));
      return Z.blickAusEuler(l.alpha + zittern * zufall(), l.beta + zittern * zufall(), 0);
    },
    lage(p) {
      const l = lageFuer(blick(p));
      return { euler: [l.alpha, l.beta, l.gamma] };
    }
  };
}
/** Strahl ab der Linse (Kameramodell) für `treffer`. */
const strahlAus = (r, v, ecken, deckeZ, bodenZ = 0) => {
  const k = Au.kameraImRaum(r, v);
  return { ursprung: k.o, richtung: k.d, ecken, bodenZ, deckeZ };
};

// --------------------------------------------- Abbildung hin und zurück

{
  const pose = { drehungRad: 0.7, verschiebung: [1.2, -0.4] };
  const p = [3.3, 1.7];
  const q = Au.inRaum(pose, Au.zurWelt(pose, p));
  nah("zurWelt ∘ inRaum x", q[0], p[0], 1e-12);
  nah("zurWelt ∘ inRaum y", q[1], p[1], 1e-12);
  // Ohne Drehung klappt nur y um: Nord = im Grundriss nach oben (−y).
  const r = Au.richtungInRaum({ drehungRad: 0 }, [0, 1, 0]);
  nah("Nord → −y", r[1], -1, 1e-12);
}

// ----------------------------------------------- Rechteckraum, exakt

const rechteck = G.ecken({ breiteM: 4.2, tiefeM: 3.0 });
wahr("längste Wand = Wand 1 (Index 0)", Au.laengsteWand(rechteck) === 0);
wahr("längste Wand im Hochkant-Raum", Au.laengsteWand([[0, 0], [2, 0], [2, 5], [0, 5]]) === 1);

for (const [stand, psi, hWahr, wand] of [
  [[1.6, 2.1], 30, 1.45, 0],
  [[2.9, 0.9], -137, 1.31, 1],
  [[0.8, 1.2], 200, 1.58, 2],
  [[2.1, 2.6], 0, 1.40, 3]
]) {
  const sz = szene(stand, psi, hWahr);
  const A = rechteck[wand], B = rechteck[(wand + 1) % 4];
  const name = `Wand ${wand + 1}, ψ=${psi}°`;
  // 1) richtige Kamerahöhe angenommen → Maßstab 1
  let r = Au.loese({ ecken: rechteck, wandIndex: wand, vStart: sz.ziel(A), vEnde: sz.ziel(B), kamerahoeheM: hWahr });
  wahr(`${name}: gelöst`, r.ok, r.grund);
  nah(`${name}: Stand x`, r.stand[0], stand[0]);
  nah(`${name}: Stand y`, r.stand[1], stand[1]);
  nah(`${name}: Drehung`, winkelDiff(r.drehungRad, psi * Z.GRAD), 0);
  nah(`${name}: Maßstab 1`, r.skala, 1);
  nah(`${name}: Rest 0`, r.restM, 0);
  // 2) falsche Annahme 1,40 → die Wandlänge eicht die Kamerahöhe
  r = Au.loese({ ecken: rechteck, wandIndex: wand, vStart: sz.ziel(A), vEnde: sz.ziel(B), kamerahoeheM: 1.40 });
  wahr(`${name}: Maßstab übernommen`, r.skalaAngewandt);
  nah(`${name}: Kamerahöhe geeicht`, r.kamerahoeheM, hWahr);
  nah(`${name}: Stand x (geeicht)`, r.stand[0], stand[0]);
  nah(`${name}: Stand y (geeicht)`, r.stand[1], stand[1]);
  nah(`${name}: Drehung (geeicht)`, winkelDiff(r.drehungRad, psi * Z.GRAD), 0);
  // Jede weitere Ecke landet dann auch auf ihrer Raumecke.
  for (let j = 0; j < 4; j++) {
    const q = Au.bodenpunktImRaum(r, sz.ziel(rechteck[j]));
    if (!q) continue;
    nah(`${name}: Ecke ${j} x`, q[0], rechteck[j][0]);
    nah(`${name}: Ecke ${j} y`, q[1], rechteck[j][1]);
  }
}

// ------------------------------------- unplausibler Maßstab bleibt stehen

{
  const sz = szene([2.1, 2.0], 75, 1.6);
  const r = Au.loese({ ecken: rechteck, wandIndex: 0, vStart: sz.ziel(rechteck[0]), vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 0.8 });
  wahr("Maßstab 2,0 → nicht übernommen", r.ok && !r.skalaAngewandt);
  nah("Maßstab 2,0 gemeldet", r.skala, 2, 1e-6);
  nah("Kamerahöhe bleibt 0,80", r.kamerahoeheM, 0.8, 1e-12);
  nah("Drehung trotzdem exakt", winkelDiff(r.drehungRad, 75 * Z.GRAD), 0, 1e-9);
  wahr("Rest ehrlich > 0,5 m", r.restM > 0.5, String(r.restM));
  // Mit von Hand gesetzter Höhe nie skalieren.
  const r2 = Au.loese({ ecken: rechteck, wandIndex: 0, vStart: sz.ziel(rechteck[0]), vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 1.5, skalaAnwenden: false });
  wahr("skalaAnwenden=false", r2.ok && !r2.skalaAngewandt && r2.kamerahoeheM === 1.5);
}

// ------------------------------------- vertauschte Ecken werden erkannt

{
  const sz = szene([1.9, 1.7], -20, 1.44);
  const r = Au.loese({ ecken: rechteck, wandIndex: 1, vStart: sz.ziel(rechteck[2]), vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 1.4 });
  wahr("vertauscht → getauscht", r.ok && r.getauscht === true);
  nah("vertauscht: Stand x", r.stand[0], 1.9); nah("vertauscht: Stand y", r.stand[1], 1.7);
  nah("vertauscht: Kamerahöhe", r.kamerahoeheM, 1.44);
  const r2 = Au.loese({ ecken: rechteck, wandIndex: 1, vStart: sz.ziel(rechteck[2]), vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 1.4, tauschenErlaubt: false });
  wahr("ohne Tausch: Standpunkt hinter der Wand", r2.ok && !r2.getauscht && r2.ausserhalb === true && r2.stand[0] > 4.2);
  const r3 = Au.loese({ ecken: rechteck, wandIndex: 1, vStart: sz.ziel(rechteck[1]), vEnde: sz.ziel(rechteck[2]), kamerahoeheM: 1.4 });
  wahr("richtig herum: nicht getauscht", r3.ok && !r3.getauscht && !r3.ausserhalb);
}

// ----------------------------------------------- Fehlerfälle

{
  const sz = szene([2.1, 1.5], 10, 1.4);
  const flach = Z.blickAusEuler(0, 92, 0);
  wahr("Strahl über Horizont → flach", Au.loese({ ecken: rechteck, vStart: flach, vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 1.4 }).grund === "flach");
  const v = sz.ziel(rechteck[0]);
  wahr("zweimal dieselbe Ecke → gleich", Au.loese({ ecken: rechteck, vStart: v, vEnde: v, kamerahoeheM: 1.4 }).grund === "gleich");
  wahr("ohne Raum", Au.loese({ ecken: [[0, 0], [1, 0]], vStart: v, vEnde: v, kamerahoeheM: 1.4 }).grund === "raum");
}

// ------------------------------- L-Raum: ausrichten, dann Wand/Decke treffen

const L = [[0, 0], [5, 0], [5, 4], [2, 4], [2, 2.5], [0, 2.5]];   // Uhrzeigersinn (y unten)
const aufbau = 0.06, hoeheRaum = 2.5, deckeZ = aufbau + hoeheRaum;
{
  const stand = [3.4, 1.6], hWahr = 1.47;     // Augenhöhe über dem Rohboden (Estrich fehlt)
  const sz = szene(stand, 112, hWahr);
  const r = Au.loese({ ecken: L, wandIndex: 0, vStart: sz.ziel(L[0]), vEnde: sz.ziel(L[1]), kamerahoeheM: 1.40 });
  wahr("L-Raum gelöst, Maßstab übernommen", r.ok && r.skalaAngewandt);
  nah("L-Raum Kamerahöhe", r.kamerahoeheM, hWahr);
  const strahl = v => strahlAus(r, v, L, deckeZ);

  // Steckdose an Wand 2 (Ecke 1 → 2, x = 5): 1,30 m ab Ecke 1, 0,30 m über FFB.
  const dose = [5, 1.3, aufbau + 0.30];
  let t = Au.treffer({ ...strahl(sz.ziel(dose)), ziel: "WAND" });
  wahr("Steckdose trifft Wand 2", t.ok && t.index === 1, JSON.stringify(t));
  nah("Steckdose Abstand 1,30", t.abstand, 1.3);
  nah("Steckdose Höhe über FFB 0,30", t.hoehe - aufbau, 0.30);

  // Wandleuchte über Augenhöhe an der Innenecke-Wand 4 (Ecke 3 → 4, x = 2).
  const leuchte = [2, 3.5, aufbau + 2.05];
  t = Au.treffer({ ...strahl(sz.ziel(leuchte)), ziel: "WAND" });
  wahr("Wandleuchte trifft Wand 4", t.ok && t.index === 3, JSON.stringify(t));
  nah("Wandleuchte Abstand 0,50", t.abstand, 0.5);
  nah("Wandleuchte Höhe 2,05", t.hoehe - aufbau, 2.05);

  // Deckenleuchte und Bodenpunkt.
  t = Au.treffer({ ...strahl(sz.ziel([1.0, 1.0, deckeZ])), ziel: "DECKE" });
  wahr("Decke getroffen", t.ok && t.art === "DECKE");
  nah("Decke x", t.x, 1.0); nah("Decke y", t.y, 1.0);
  t = Au.treffer({ ...strahl(sz.ziel([4.0, 3.0, 0])), ziel: "BODEN" });
  wahr("Boden getroffen", t.ok); nah("Boden x", t.x, 4.0); nah("Boden y", t.y, 3.0);

  // Danebengezielt: über die Decke hinaus bzw. in den Boden.
  wahr("über der Decke → kein Wandtreffer", Au.treffer({ ...strahl(sz.ziel([5, 2.0, deckeZ + 0.8])), ziel: "WAND" }).grund === "ueberDecke");
  wahr("Boden vor der Wand → kein Wandtreffer", Au.treffer({ ...strahl(sz.ziel([4.5, 2.0, 0])), ziel: "WAND" }).grund === "unterBoden");
  wahr("Decke nach unten → kein Treffer", !Au.treffer({ ...strahl(sz.ziel([4.5, 2.0, 0])), ziel: "DECKE" }).ok);
  // Im Ausschnitt des L (außerhalb des Raums) gibt es keine Decke.
  wahr("Decke außerhalb → kein Treffer", Au.treffer({ ...strahl(sz.ziel([0.6, 3.6, deckeZ])), ziel: "DECKE" }).grund === "ausserhalb");
}

// ----------------------------------------- Rauschen: 0,3° Zittern

{
  let maxStand = 0, maxDreh = 0, maxH = 0, maxDose = 0, maxDoseH = 0;
  const faelle = [
    [[2.1, 2.2], 30, 1.45], [[1.2, 1.8], 250, 1.38], [[3.0, 2.0], -60, 1.52], [[2.5, 1.6], 145, 1.33]
  ];
  for (const [stand, psi, hWahr] of faelle) {
    for (let k = 0; k < 25; k++) {
      const sz = szene(stand, psi, hWahr);
      const r = Au.loese({ ecken: rechteck, wandIndex: 0, vStart: sz.ziel(rechteck[0], 0.3), vEnde: sz.ziel(rechteck[1], 0.3), kamerahoeheM: 1.40 });
      if (!r.ok) { wahr("Rauschen: gelöst", false); continue; }
      maxStand = Math.max(maxStand, Math.hypot(r.stand[0] - stand[0], r.stand[1] - stand[1]));
      maxDreh = Math.max(maxDreh, Math.abs(winkelDiff(r.drehungRad, psi * Z.GRAD)) / Z.GRAD);
      maxH = Math.max(maxH, Math.abs(r.kamerahoeheM - hWahr));
      // Und eine Steckdose an Wand 2 (x = 4,2), angezielt ohne Zittern.
      const dose = [4.2, 1.1, 0.36];
      const t = Au.treffer({ ...strahlAus(r, sz.ziel(dose), rechteck, 2.56), ziel: "WAND" });
      if (t.ok && t.index === 1) {
        maxDose = Math.max(maxDose, Math.abs(t.abstand - 1.1));
        maxDoseH = Math.max(maxDoseH, Math.abs(t.hoehe - 0.36));
      } else maxDose = Infinity;
    }
  }
  const cm = x => (x * 100).toFixed(1);
  console.log(`  0,3° Zittern: Standpunkt ≤ ${cm(maxStand)} cm, Drehung ≤ ${maxDreh.toFixed(2)}°, Kamerahöhe ≤ ${cm(maxH)} cm, Steckdose ≤ ${cm(maxDose)} cm seitlich / ${cm(maxDoseH)} cm Höhe`);
  wahr(`Rauschen: Standpunkt ${cm(maxStand)} cm ≤ 6 cm`, maxStand <= 0.06);
  wahr(`Rauschen: Drehung ${maxDreh.toFixed(2)}° ≤ 1°`, maxDreh <= 1);
  wahr(`Rauschen: Kamerahöhe ${cm(maxH)} cm ≤ 4 cm`, maxH <= 0.04);
  wahr(`Rauschen: Steckdose ${cm(maxDose)} cm / ${cm(maxDoseH)} cm ≤ 8 cm`, maxDose <= 0.08 && maxDoseH <= 0.08);
}

// ------------------- Ohne Kameramodell läge die Ausrichtung um Dezimeter daneben

{
  const sz = szene([2.0, 1.5], 40, 1.38);
  const ein = { ecken: rechteck, wandIndex: 0, vStart: sz.ziel(rechteck[0]), vEnde: sz.ziel(rechteck[1]), kamerahoeheM: 1.40 };
  const mit = Au.loese(ein), ohne = Au.loese({ ...ein, haltung: null });
  // Die gegenüberliegenden Ecken nach dem Ausrichten anzielen.
  const fehler = r => Math.max(...[2, 3].map(j => { const q = Au.bodenpunktImRaum(r, sz.ziel(rechteck[j])); return Math.hypot(q[0] - rechteck[j][0], q[1] - rechteck[j][1]); }));
  nah("Kameramodell: gegenüberliegende Ecken exakt", fehler(mit), 0);
  // Der Maßstab schluckt den Armabstand bei Bodenpunkten teilweise – nicht aber
  // bei Höhen: Schalter auf 1,05 m an Wand 2, angezielt nach dem Ausrichten.
  const schalter = [4.2, 1.2, 1.05];
  const hoehe = r => Au.treffer({ ...strahlAus(r, sz.ziel(schalter), rechteck, 2.6), ziel: "WAND" }).hoehe;
  nah("Kameramodell: Schalterhöhe exakt", hoehe(mit), 1.05);
  const fo = Math.abs(hoehe(ohne) - 1.05);
  console.log(`  einfaches Modell: Ecken ${(fehler(ohne) * 100).toFixed(1)} cm, Schalterhöhe ${(fo * 100).toFixed(1)} cm daneben`);
  wahr(`einfaches Modell: Schalterhöhe ${(fo * 100).toFixed(0)} cm daneben`, fo > 0.04);
}

// ---------------------------------- Kamera-Quaternion passt zu zielen.js

{
  const pose = { drehungRad: 0.83, verschiebung: [1, 1] };
  for (const e of [[10, 70, 5], [200, 45, -20], [333, 110, 30], [90, 20, -80], [0, 90, 0]]) {
    const lageE = { euler: e };
    const qE = Au.geraetQuaternion(lageE);
    // Gleiche Lage als Android-Quaternion (Rz·Rx·Ry).
    const lageQ = { qs: qE.slice() };
    for (const [art, lage] of [["euler", lageE], ["qs", lageQ]]) {
      const v = Au.blickAusLage(lage);
      const soll = Au.richtungInRaum(pose, v);                // Raum [x, y, Höhe]
      const q = Au.kameraQuaternion(pose.drehungRad, Au.geraetQuaternion(lage), 0);
      const vor = Au.dreheVektor(q, [0, 0, -1]);              // three.js [x, Höhe, Raum-y]
      nah(`Kamera vorwärts x (${art} ${e})`, vor[0], soll[0], 1e-9);
      nah(`Kamera vorwärts Höhe (${art} ${e})`, vor[1], soll[2], 1e-9);
      nah(`Kamera vorwärts z (${art} ${e})`, vor[2], soll[1], 1e-9);
    }
  }
  // Hochkant, Bildschirm zum Nutzer: Oberkante zeigt nach oben.
  const q = Au.kameraQuaternion(0, Au.geraetQuaternion({ euler: [0, 90, 0] }), 0);
  const oben = Au.dreheVektor(q, [0, 1, 0]);
  nah("Hochkant: Kamera-oben = Welt-oben", oben[1], 1, 1e-9);
  // Querformat (Schirm um 90° gedreht, Oberkante nach links): Das Gerät ist
  // um seine eigene z-Achse gerollt; der Schirmausgleich hebt das auf.
  const geraetQuer = qMalTest(Au.geraetQuaternion({ euler: [0, 90, 0] }), [Math.cos(Math.PI / 4), 0, 0, Math.sin(Math.PI / 4)]);
  const quer = Au.kameraQuaternion(0, geraetQuer, Math.PI / 2);
  nah("Querformat: Kamera-oben = Welt-oben", Au.dreheVektor(quer, [0, 1, 0])[1], 1, 1e-9);
  nah("Querformat: Blick bleibt waagerecht", Au.dreheVektor(quer, [0, 0, -1])[1], 0, 1e-9);
}
function qMalTest(p, q) {
  return [
    p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
    p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
    p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
    p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0]
  ];
}

// --------------------------------------------------------- Bildwinkel

{
  // Video im selben Seitenverhältnis wie der Schirm: nichts beschnitten.
  nah("3:4-Video auf 3:4-Schirm: senkrecht = langer Bildwinkel", Au.anzeigeFovGrad({ bildwinkelGrad: 66, videoB: 480, videoH: 640, elementB: 300, elementH: 400 }), 66, 1e-9);
  // Hochformat 412×915 mit 3:4-Video: seitlich beschnitten, senkrecht voll.
  nah("412×915, 480×640", Au.anzeigeFovGrad({ bildwinkelGrad: 66, videoB: 480, videoH: 640, elementB: 412, elementH: 915 }), 66, 1e-9);
  // Hochformat mit 9:16-Video (1080×1920): langer Bildwinkel bleibt 66°, cover schneidet seitlich.
  const v916 = Au.anzeigeFovGrad({ bildwinkelGrad: 66, videoB: 1080, videoH: 1920, elementB: 412, elementH: 915 });
  nah("412×915, 1080×1920", v916, 66, 1e-9);
  // Querformat 915×412 mit 4:3-Video: oben/unten beschnitten → kleiner.
  const quer = Au.anzeigeFovGrad({ bildwinkelGrad: 66, videoB: 640, videoH: 480, elementB: 915, elementH: 412 });
  const f = 320 / Math.tan(33 * Z.GRAD), sicht = 412 / (915 / 640);
  nah("915×412, 640×480", quer, 2 * Math.atan(sicht / 2 / f) / Z.GRAD, 1e-9);
  wahr("Querformat zeigt weniger als 49,5°", quer < 49.5);
  wahr("ohne Video: Annahme 4:3", Math.abs(Au.anzeigeFovGrad({ elementB: 412, elementH: 915 }) - 66) < 1e-9);
}

console.log(`ausrichten.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
