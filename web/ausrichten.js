/*
 * Ausrichten – das geplante Raummodell auf den echten Raum legen, nur mit
 * Kamera und Lagesensor (ohne Marker, ohne ARCore).
 *
 * Vor Ort zielt man mit dem Fadenkreuz auf die beiden Bodenecken einer Wand
 * des aufgemessenen Raums: erst die Anfangsecke, dann die Endecke (von innen
 * gesehen links, dann rechts – der Grundriss läuft im Uhrzeigersinn). Aus
 * Neigung und Kamerahöhe h liefert jedes Zielen einen Bodenpunkt in der
 * Sensorwelt (zielen.js: x = Ost, y = Nord, z = oben; Ursprung = Standpunkt).
 * Zwei Punkte zu zwei bekannten Raumecken legen eine ebene Abbildung fest:
 *
 *     raum = R(ψ) · F · k·welt + t,     F = diag(1, −1)
 *
 * F klappt y um (Grundriss: y zeigt nach hinten/unten), ψ dreht um die
 * Senkrechte, t verschiebt. k = |Raumwand| / |gezielte Wand| ist der Maßstab:
 * Weil jeder Bodenpunkt linear in h ist, heißt k nichts anderes als „die
 * Kamera war k-mal so hoch wie angenommen". Liegt k im plausiblen Bereich
 * (0,7 … 1,4), wird h·k übernommen – die bekannte Wandlänge eicht die
 * Kamerahöhe. Sonst bleibt h, die Wand wird mittig eingepasst und die
 * Abweichung ehrlich gemeldet.
 *
 * Danach ist alles bekannt: Standpunkt im Raum (t), Augenhöhe (h·k) und die
 * Drehung ψ. Jede weitere Blickrichtung lässt sich in den Raum drehen und mit
 * Wänden, Boden und Decke schneiden (`treffer`).
 *
 * Kameramodell (zielen.js): Man dreht sich um die eigene Achse, die Linse
 * sitzt davor (Freihand r ≈ 30 cm, 8 cm über dem Drehpunkt der Hand). Der
 * Standpunkt ist deshalb die **Körperachse**, und Strahlen beginnen an der
 * Linse (`kameraImRaum`) – sonst läge alles um r daneben. Weil r die Lage nicht
 * linear in h macht, wird der Maßstab nicht als Faktor, sondern als die
 * Kamerahöhe gesucht, bei der die gezielte Wand ihre Planlänge hat.
 *
 * Raumsystem hier: x rechts, y nach hinten (wie der Grundriss), z = Höhe.
 * three.js-Welt der AR-Ansicht: x = Raum-x, y = Höhe, z = Raum-y.
 *
 * Reine Funktionen, kein DOM, kein three.js – in Node testbar
 * (web/tests/ausrichten.test.mjs).
 */

import * as Z from "./zielen.js";

export const SKALA_MIN = 0.7;
export const SKALA_MAX = 1.4;

// ------------------------------------------------------------- Ausrichtung

/** Index der längsten Wand (bei Gleichstand die erste). */
export function laengsteWand(ecken) {
  let beste = 0, l = -1;
  (ecken || []).forEach((a, i) => {
    const b = ecken[(i + 1) % ecken.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > l + 1e-9) { l = d; beste = i; }
  });
  return beste;
}

/**
 * Löst die Ausrichtung aus zwei gezielten Bodenecken.
 *
 *   ecken         – Raumecken [x, y] (Geometrie.ecken), im Uhrzeigersinn
 *   wandIndex     – Wand i läuft von Ecke i nach Ecke i+1
 *   vStart, vEnde – Blickrichtungen (Sensorwelt) auf Ecke i und Ecke i+1
 *   kamerahoeheM  – angenommene Kamerahöhe über dem Boden im Bild
 *   skalaAnwenden – false: h bleibt, wie sie ist (Höhe von Hand gesetzt)
 *
 * Ergebnis bei Erfolg: { ok, drehungRad, verschiebung, stand, kamerahoeheM,
 * skala, skalaAngewandt, laengeRaumM, laengeGezieltM, restM, getauscht,
 * ausserhalb }. `stand` ist der Standpunkt im Raum, `restM` der größte
 * Abstand der abgebildeten Zielpunkte von ihren Raumecken (0 bei übernommenem
 * Maßstab). `getauscht`: die Ecken waren vertauscht angezielt und wurden
 * richtiggestellt; `ausserhalb`: der Standpunkt liegt auch so nicht im Raum.
 * Sonst { ok: false, grund: "raum" | "hoehe" | "flach" | "gleich", ecke }.
 */
export function loese(eingabe) {
  const r = loeseEinmal(eingabe);
  // Wer die Ecken vertauscht anzielt (erst rechts, dann links), landet mit
  // dem Standpunkt hinter der Wand. Liegt er mit getauschten Ecken im Raum,
  // gilt diese Lösung (`getauscht`) – sonst bleibt es bei der Warnung.
  if (!r.ok || imVieleck(eingabe.ecken, r.stand[0], r.stand[1], 0.05)) return r;
  if (eingabe.tauschenErlaubt !== false) {
    const t = loeseEinmal({ ...eingabe, vStart: eingabe.vEnde, vEnde: eingabe.vStart });
    if (t.ok && imVieleck(eingabe.ecken, t.stand[0], t.stand[1], 0.05)) return { ...t, getauscht: true };
  }
  return { ...r, ausserhalb: true };
}

/**
 * Haltung für das Kameramodell: { r, L, delta (rad) }. Vorgabe: Freihand.
 * `null` = einfaches Modell (Linse auf der Achse, z. B. für Stativ-Kopf genau
 * über dem Standpunkt).
 */
export function haltungFreihand(neigungsfehlerGrad = 0) {
  const h = Z.HALTUNG.hand;
  return { r: h.r, L: h.L, delta: (Number(neigungsfehlerGrad) || 0) * Z.GRAD };
}

function modellParameter(kamerahoeheM, modell) {
  const m = modell || { r: 0, L: 0, delta: 0 };
  return { h: kamerahoeheM - (m.L || 0), r: m.r || 0, L: m.L || 0, delta: m.delta || 0 };
}

function loeseEinmal({ ecken, wandIndex = 0, vStart, vEnde, kamerahoeheM, skalaAnwenden = true, haltung }) {
  const n = ecken ? ecken.length : 0;
  if (n < 3) return { ok: false, grund: "raum" };
  const h = Number(kamerahoeheM);
  if (!(h > 0)) return { ok: false, grund: "hoehe" };
  const modell = haltung === undefined ? haltungFreihand() : haltung;
  const i = ((Math.round(wandIndex) % n) + n) % n;
  const A = ecken[i], B = ecken[(i + 1) % n];
  const punkte = hc => {
    const p = modellParameter(hc, modell);
    return [vStart ? Z.bodenpunktM(vStart, p) : null, vEnde ? Z.bodenpunktM(vEnde, p) : null];
  };
  let [pa, pb] = punkte(h);
  if (!pa || !pb) return { ok: false, grund: "flach", ecke: pa ? 1 : 0 };
  const dr = [B[0] - A[0], B[1] - A[1]], lr = Math.hypot(dr[0], dr[1]);
  const laenge = (qa, qb) => Math.hypot(qb.x - qa.x, qb.y - qa.y);
  const ls = laenge(pa, pb);
  if (ls < 0.05 || lr < 1e-6) return { ok: false, grund: "gleich" };

  // Maßstab = die Kamerahöhe, bei der die gezielte Wand ihre Planlänge hat
  // (Fixpunkt-Iteration; die Länge ist in der Höhe nahezu linear).
  let hc = h;
  for (let it = 0; it < 12; it++) {
    const [qa, qb] = punkte(hc);
    if (!qa || !qb) break;
    const l = laenge(qa, qb);
    if (!(l > 0)) break;
    const neu = hc * lr / l;
    if (Math.abs(neu - hc) < 1e-7) { hc = neu; break; }
    hc = neu;
  }
  const skala = hc / h;
  const angewandt = skalaAnwenden !== false && skala > SKALA_MIN && skala < SKALA_MAX;
  const hEnd = angewandt ? hc : h;
  [pa, pb] = punkte(hEnd);
  if (!pa || !pb) return { ok: false, grund: "flach", ecke: pa ? 1 : 0 };

  const a = [pa.x, -pa.y], b = [pb.x, -pb.y];          // F: y umklappen
  const ds = [b[0] - a[0], b[1] - a[1]];
  const psi = winkelNorm(Math.atan2(dr[1], dr[0]) - Math.atan2(ds[1], ds[0]));
  const c = Math.cos(psi), s = Math.sin(psi);
  // Mitte auf Mitte: bei übernommenem Maßstab exakt, sonst kleinste Quadrate.
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const t = [M[0] - (c * m[0] - s * m[1]), M[1] - (s * m[0] + c * m[1])];

  const pose = { drehungRad: psi, verschiebung: t, kamerahoeheM: hEnd, modell };
  const ra = inRaum(pose, [pa.x, pa.y]), rb = inRaum(pose, [pb.x, pb.y]);
  const restM = Math.max(Math.hypot(ra[0] - A[0], ra[1] - A[1]), Math.hypot(rb[0] - B[0], rb[1] - B[1]));
  return {
    ok: true, ...pose, stand: t.slice(), wandIndex: i,
    skala, skalaAngewandt: angewandt, kamerahoeheAnnahmeM: h,
    laengeRaumM: lr, laengeGezieltM: ls, restM
  };
}

/** Gezielter Bodenpunkt im Raum [x, y] (Kameramodell der Pose), oder null. */
export function bodenpunktImRaum(pose, v) {
  const q = Z.bodenpunktM(v, modellParameter(Number(pose.kamerahoeheM), pose.modell));
  return q ? inRaum(pose, [q.x, q.y]) : null;
}

/**
 * Zielstrahl im Raum: beginnt an der Linse (vor der Körperachse, auf der
 * Linsenhöhe über dem gezielten Boden), Richtung um den Neigungsfehler
 * bereinigt. → { o: [x, y, z], d: [dx, dy, dz] }.
 */
export function kameraImRaum(pose, v) {
  const p = modellParameter(Number(pose.kamerahoeheM), pose.modell);
  const k = Z.kamera(v, p);
  const o = inRaum(pose, [k.o[0], k.o[1]]);
  return { o: [o[0], o[1], k.z], d: richtungInRaum(pose, k.v) };
}

/** Bodenpunkt der Sensorwelt [Ost, Nord] → Raum [x, y]. */
export function inRaum(pose, p) {
  const c = Math.cos(pose.drehungRad), s = Math.sin(pose.drehungRad);
  const t = pose.verschiebung || pose.stand || [0, 0];
  return [c * p[0] + s * p[1] + t[0], s * p[0] - c * p[1] + t[1]];
}

/** Raum [x, y] → Sensorwelt [Ost, Nord] (Umkehrung von `inRaum`). */
export function zurWelt(pose, p) {
  const c = Math.cos(pose.drehungRad), s = Math.sin(pose.drehungRad);
  const t = pose.verschiebung || pose.stand || [0, 0];
  const dx = p[0] - t[0], dy = p[1] - t[1];
  return [c * dx + s * dy, s * dx - c * dy];
}

/** Richtung der Sensorwelt [Ost, Nord, oben] → Raum [x, y, Höhe]. */
export function richtungInRaum(pose, v) {
  const c = Math.cos(pose.drehungRad), s = Math.sin(pose.drehungRad);
  return [c * v[0] + s * v[1], s * v[0] - c * v[1], v[2]];
}

// --------------------------------------------------------------- Treffer

/**
 * Schneidet einen Strahl im Raumsystem mit der passenden Fläche:
 *
 *   ursprung = [x, y, z], richtung = [dx, dy, dz] (z = Höhe über Rohboden)
 *   ecken    – Raumecken; die Wände sind senkrecht von bodenZ bis deckeZ
 *   ziel     – "WAND" | "DECKE" | "BODEN"
 *
 * WAND: { ok, art, index, abstand, laenge, hoehe, x, y, entfernung } – die
 * zuerst getroffene Wand, sofern der Treffer zwischen Boden und Decke liegt.
 * DECKE/BODEN: { ok, art, x, y, hoehe, entfernung }, wenn der Punkt im Raum
 * liegt. Sonst { ok: false, grund } – „ueberDecke", „unterBoden",
 * „keineWand", „nichtNachOben", „nichtNachUnten", „ausserhalb".
 */
export function treffer({ ursprung, richtung, ecken, bodenZ = 0, deckeZ, ziel = "WAND" }) {
  const l = Math.hypot(richtung[0], richtung[1], richtung[2]);
  if (!(l > 0) || !ecken || ecken.length < 3) return { ok: false, grund: "keineWand" };
  const d = [richtung[0] / l, richtung[1] / l, richtung[2] / l];
  const o = ursprung, stand = [o[0], o[1]];
  const oben = Number.isFinite(deckeZ) ? deckeZ : Infinity;

  if (ziel === "DECKE" || ziel === "BODEN") {
    const zEbene = ziel === "DECKE" ? oben : bodenZ;
    if (ziel === "DECKE" ? d[2] <= 1e-6 : d[2] >= -1e-6) return { ok: false, grund: ziel === "DECKE" ? "nichtNachOben" : "nichtNachUnten" };
    if (!Number.isFinite(zEbene)) return { ok: false, grund: "nichtNachOben" };
    const t = (zEbene - o[2]) / d[2];
    if (!(t > 0)) return { ok: false, grund: ziel === "DECKE" ? "nichtNachOben" : "nichtNachUnten" };
    const x = o[0] + t * d[0], y = o[1] + t * d[1];
    if (!imVieleck(ecken, x, y, 0.02)) return { ok: false, grund: "ausserhalb" };
    return { ok: true, art: ziel, x, y, hoehe: zEbene, entfernung: t };
  }

  const w = Z.ersteWand(d, o[2], ecken, stand);
  if (!w) return { ok: false, grund: "keineWand" };
  if (w.hoehe < bodenZ - 0.02) return { ok: false, grund: "unterBoden" };
  if (w.hoehe > oben + 0.02) return { ok: false, grund: "ueberDecke" };
  return {
    ok: true, art: "WAND", index: w.index,
    abstand: Math.max(0, Math.min(w.laenge, w.abstand)), laenge: w.laenge,
    hoehe: Math.max(bodenZ, Math.min(oben, w.hoehe)), x: w.x, y: w.y, entfernung: w.t
  };
}

/** Punkt im Vieleck – mit kleiner Toleranz am Rand. */
export function imVieleck(ecken, x, y, toleranz = 0) {
  let drin = false;
  for (let i = 0, j = ecken.length - 1; i < ecken.length; j = i++) {
    const a = ecken[i], b = ecken[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) drin = !drin;
  }
  if (drin || !(toleranz > 0)) return drin;
  for (let i = 0; i < ecken.length; i++) {
    const a = ecken[i], b = ecken[(i + 1) % ecken.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    if (Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy) <= toleranz) return true;
  }
  return false;
}

// ------------------------------------------------------- Lage → Kamera

/**
 * Lage des Geräts als Quaternion [w, x, y, z] (Gerät → Sensorwelt).
 * `lage` wie von window.__native.beiLage: { qs:[w,x,y,z] } (App, Spiel-
 * Rotationsvektor) oder { euler:[α,β,γ] } (Browser, W3C: Rz(α)·Rx(β)·Ry(γ)).
 */
export function geraetQuaternion(lage) {
  if (lage && lage.qs && lage.qs.length === 4) return qNorm(lage.qs.map(Number));
  if (lage && lage.euler) {
    const [a, b, g] = lage.euler.map(x => (Number(x) || 0) * Z.GRAD);
    return qMal(qMal(qAchse([0, 0, 1], a), qAchse([1, 0, 0], b)), qAchse([0, 1, 0], g));
  }
  return null;
}

/** Blickrichtung der Rückkamera (Sensorwelt) aus der Lage – wie zielen.js. */
export function blickAusLage(lage) {
  if (lage && lage.qs) return Z.blickAusQuaternion(lage.qs);
  if (lage && lage.euler) return Z.blickAusEuler(lage.euler[0], lage.euler[1], lage.euler[2]);
  return null;
}

/**
 * Quaternion [w, x, y, z] der three.js-Kamera in der AR-Welt
 * (x = Raum-x, y = oben, z = Raum-y). Die three.js-Kamera schaut entlang
 * ihrer −z mit +y oben – genau wie die Rückkamera entlang −z des Geräts, im
 * Hochformat mit der Oberkante als +y. Die Sensorwelt (Ost, Nord, oben)
 * kommt per Rx(−90°) in eine y-oben-Welt (Ost, oben, −Nord) und per Ry(−ψ)
 * in die Raumdrehung; `schirmRad` gleicht die Bildschirmdrehung aus.
 * Vorwärts der Kamera = richtungInRaum(pose, blick) in three.js-Achsen.
 */
export function kameraQuaternion(drehungRad, qGeraet, schirmRad = 0) {
  const qWelt = qMal(qAchse([0, 1, 0], -drehungRad), qAchse([1, 0, 0], -Math.PI / 2));
  return qMal(qMal(qWelt, qGeraet), qAchse([0, 0, 1], -schirmRad));
}

/**
 * Kamera-Quaternion [w, x, y, z] (aus `kameraQuaternion`) auf kürzestem Weg
 * so nachdrehen, dass ihre Blickachse (−z) entlang `d` zeigt – dem Zielstrahl
 * aus `kameraImRaum` in Raumachsen [x, y, Höhe], also um den Neigungsfehler
 * bereinigt. Das Rollen bleibt. So zeigen Bild, Zielvorschau und Antippen
 * denselben Strahl, mit dem „Setzen" den Einbau platziert.
 */
export function kameraAufStrahl(q, d) {
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 0)) return q;
  const f = dreheVektor(q, [0, 0, -1]);
  const z = [d[0] / l, d[2] / l, d[1] / l];            // three.js: y = Höhe, z = Raum-y
  const c = f[0] * z[0] + f[1] * z[1] + f[2] * z[2];
  if (c < -0.999999) return q;                         // Gegenrichtung: keine kürzeste Drehung
  const a = [f[1] * z[2] - f[2] * z[1], f[2] * z[0] - f[0] * z[2], f[0] * z[1] - f[1] * z[0]];
  return qNorm(qMal(qNorm([1 + c, a[0], a[1], a[2]]), q));
}

/**
 * Hat der Lagesensor seit der Lage `alt` neu begonnen? Die App zählt `epoche`
 * hoch, sobald sie den Spiel-Rotationsvektor neu anmeldet (nach Pause oder
 * Rückkehr) – dann zählt die Gier ab einer neuen Null, und Richtungen oder
 * eine Ausrichtung aus der alten Epoche passen nicht mehr. Im Browser fehlt
 * `epoche` (undefined) und wechselt also nie.
 */
export function epocheGewechselt(alt, neu) {
  return !!alt && !!neu && alt.epoche !== neu.epoche;
}

/** Vektor mit Quaternion [w, x, y, z] drehen. */
export function dreheVektor(q, v) {
  const [w, x, y, z] = q;
  const p = qMal(qMal(q, [0, v[0], v[1], v[2]]), [w, -x, -y, -z]);
  return [p[1], p[2], p[3]];
}

// ------------------------------------------------------------- Bildwinkel

/**
 * Senkrechter Bildwinkel (Grad), den das Kamerabild auf dem Schirm wirklich
 * zeigt. Ausgangspunkt ist der Bildwinkel der Kamera über die lange Seite
 * (Hauptkamera 4:3, typisch um 66°); 16:9-Videos sind daraus oben/unten
 * beschnitten, die lange Seite bleibt. `object-fit: cover` schneidet dann
 * noch einmal – was davon übrig bleibt, ist der Bildwinkel der 3D-Kamera.
 * Ohne Videomaße (keine Kamera) wird ein 4:3-Bild in Schirmlage angenommen.
 */
export function anzeigeFovGrad({ bildwinkelGrad = 66, videoB = 0, videoH = 0, elementB, elementH }) {
  if (!(elementB > 0 && elementH > 0)) return 60;
  let vb = Number(videoB), vh = Number(videoH);
  if (!(vb > 0 && vh > 0)) { if (elementH >= elementB) { vb = 3; vh = 4; } else { vb = 4; vh = 3; } }
  const bw = Math.max(20, Math.min(150, Number(bildwinkelGrad) || 66));
  const f = (Math.max(vb, vh) / 2) / Math.tan(bw * Z.GRAD / 2);     // Brennweite in Videopixeln
  const s = Math.max(elementB / vb, elementH / vh);                  // cover-Maßstab
  return 2 * Math.atan((elementH / s / 2) / f) / Z.GRAD;
}

// ---------------------------------------------------------------- Helfer

function winkelNorm(w) {
  while (w > Math.PI) w -= 2 * Math.PI;
  while (w <= -Math.PI) w += 2 * Math.PI;
  return w;
}
function qAchse(achse, winkel) {
  const s = Math.sin(winkel / 2);
  return [Math.cos(winkel / 2), achse[0] * s, achse[1] * s, achse[2] * s];
}
function qMal(p, q) {
  return [
    p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
    p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
    p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
    p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0]
  ];
}
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
