/*
 * Raumaufnahme ohne Würfel – aus gezielten Strahlen wird ein fertiger Raum.
 *
 * Eine Aufnahme speichert nicht Koordinaten, sondern **Rohdaten**: die
 * Blickrichtungen (mit Zeitstempel), die beim Zielen gemessen wurden, und die
 * Haltung (Hand/Stativ, geschätzte Kamerahöhe). Erst `rekonstruiere` macht
 * daraus Umriss, Raumhöhe, Öffnungen und Einbauten. Wird später eine Wand mit
 * dem Bandmaß nachgemessen, rechnet die App den ganzen Raum aus denselben
 * Strahlen neu – statt eine fertige Zeichnung zu verbiegen.
 *
 * Messmodell (zielen.js, „Kameramodell“): Die Linse sitzt r vor der eigenen
 * Drehachse und L über dem Drehpunkt der Hand; das Gerät hat einen festen
 * Neigungsfehler δ; die Gier läuft langsam weg (ω, aus dem Schlussschuss).
 *
 * Ablauf von `rekonstruiere`:
 *   1. Ausgleich der Modellparameter (h, r, δ) nach kleinsten Quadraten
 *      (Gauß-Newton/Levenberg-Marquardt) aus allem, was bekannt ist:
 *      Bandmaße, bekannte Raum-, Tür- oder Kantenhöhen, „Ecken sind
 *      rechtwinklig“ (weich, ±1°) – und Vorwissen über die Haltung.
 *   2. Ecken → Boden- bzw. Deckenpunkte → Raumsystem (`Z.raumAusEcken`).
 *   3. Rechtwinklig glätten, Bandmaße exakt einsetzen, Restlücke über die
 *      übrigen Wände ausgleichen (`G.ausgleichen`).
 *   4. Öffnungen (zwei diagonale Ecken) und Einbauten (ein Punkt) über den
 *      Schnitt ihres Strahls – ab der Linse – mit der Wand.
 *   5. Jede Wand trägt ihre Maß-Herkunft und eine **ehrliche** Unsicherheit:
 *      Rauschen plus die Restunsicherheit von h, r, δ (Kovarianz). Daraus
 *      folgt die Qualitätsklasse SKIZZE / PLAN / AUFMASS (Konzept §7).
 *
 * Form der Aufnahme (alles JSON, wird am Raum gespeichert):
 *   {
 *     version: 2, methode: "zielen",
 *     haltung: "hand" | "stativ",
 *     kamerahoeheM: 1.40,             // Linse über dem Boden, Handy senkrecht (geschätzt)
 *     linseM, armM: null | Zahl,      // sonst Vorgabe der Haltung
 *     neigungsfehlerGrad: null | Zahl,// aus der Wende-Kalibrierung (einmal je Gerät)
 *     boden: "roh" | "fertig",        // worauf gezielt wurde (Estrich drin?)
 *     ecken: [{ v:[x,y,z], ebene:"boden"|"decke", t }],   // in Tipp-Reihenfolge
 *     schluss: { v, t } | null,       // Schlussschuss auf Ecke 1 (Gier-Drift)
 *     hoehe: { vUnten, vOben, tUnten, tOben } | null,     // senkrechte Raumkante
 *     raumhoeheM: null | Zahl,        // bekannt (Laser) – Maßstab nur zusammen mit `hoehe`
 *     senkrechte: [{ vUnten, vOben, tUnten, tOben, hoeheM }],  // z. B. Türzarge 1,97
 *     bandmasse: { "<Raum-Wandindex>": Meter },
 *     rechtwinklig: true,
 *     oeffnungen: [{ id, art, a: v (unten links), b: v (oben rechts), ta, tb, hoeheBekanntM? }],
 *                                      // hoeheBekanntM = angezeigte Höhe: lichte Höhe ab FFB,
 *                                      // beim Fenster mit Brüstung Oberkante − Unterkante
 *                                      // (so stand es schon immer neben dem Eingabefeld)
 *     einbauten:  [{ id, art, v, t, befestigung }]
 *   }
 *
 * Reine Funktionen, kein DOM – Tests: web/tests/raumaufnahme.test.mjs.
 */

import * as Z from "./zielen.js";
import * as G from "./geometrie.js";

/** Rauschen je gemitteltem Schuss eines ruhig gehaltenen Handys (1σ, Grad). */
export const SIGMA_GRAD = 0.25;
/** Unsicherheit eines Bandmaßes (1σ, Meter). */
export const SIGMA_BAND_M = 0.005;
/** „Der Raum ist rechtwinklig“ – als weiche Annahme (1σ, Grad). */
const SIGMA_RECHT_GRAD = 1.0;
/** Bekannte Raumhöhe (Laser) bzw. bekannte Öffnungs-/Kantenhöhe (1σ, Meter). */
const SIGMA_RAUMHOEHE_M = 0.01;
const SIGMA_KANTE_M = 0.015;
/**
 * Neigungsfehler: kalibriert / unkalibriert (1σ, Grad). Die Wende-Kalibrierung
 * ist so gut wie die Linse beim Umdrehen stillhält: Versatz e auf ein Ziel in
 * D Metern verfälscht δ um ≈ e/D (1 cm auf 2 m ≈ 0,3°) – also ehrlich 0,35°.
 */
const SIGMA_DELTA_KAL = 0.35, SIGMA_DELTA_ROH = 0.7;
/** Unmodellierter Rest der Lücke vor dem Ausgleich (1σ, Meter, je Achse). */
const SIGMA_LUECKE_M = 0.01;
/**
 * Eine geglättete Ecke ist eine Annahme, keine Messung: Auch gute Neubauten
 * weichen ein paar Zehntelgrad vom rechten Winkel ab (1σ, Grad). Das geht in
 * die Wände ein, die erst der Schluss des Zugs festlegt.
 */
const SIGMA_RECHT_ANNAHME_GRAD = 0.3;
/** Bis zu dieser Abweichung gilt eine Ecke als rechtwinklig – im Ausgleich wie beim Glätten. */
const RECHT_FANG_GRAD = 8;
/**
 * Gier-Drift ohne Schlussschuss (1σ, Grad/Minute): Der Kreisel läuft weg, und
 * ohne zweiten Blick auf Ecke 1 weiß das niemand – also als Unsicherheit.
 */
const SIGMA_DRIFT_GRAD_MIN = 1.5;
/** Lichte Höhe einer Norm-Innentür (DIN 18101, Zarge) – Vorschlag, wenn man sie anzielt. */
export const TUER_LICHT_M = 1.97;

/** Leere Aufnahme mit sinnvollen Vorgaben. */
export function neueAufnahme(kamerahoeheM = 1.4, boden = "fertig", haltung = "hand") {
  return {
    version: 2, methode: "zielen", haltung, kamerahoeheM, linseM: null, armM: null,
    neigungsfehlerGrad: null, boden,
    ecken: [], schluss: null, hoehe: null, raumhoeheM: null, senkrechte: [],
    bandmasse: {}, rechtwinklig: true, oeffnungen: [], einbauten: []
  };
}

const zahlOderNull = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);

/**
 * Startwerte und Vorwissen der Modellparameter. `p` ist direkt für die
 * Kameramodell-Funktionen in zielen.js nutzbar (Live-Anzeige beim Zielen).
 */
export function parameterStart(a) {
  const halt = Z.HALTUNG[a.haltung] || Z.HALTUNG.hand;
  const L = zahlOderNull(a.linseM) ?? halt.L;
  const hCam = Number(a.kamerahoeheM) > 0 ? Number(a.kamerahoeheM) : 1.4;
  const r = zahlOderNull(a.armM) ?? halt.r;
  const dGrad = zahlOderNull(a.neigungsfehlerGrad);
  const e0 = (a.ecken || [])[0];
  let omega = 0;
  if (a.schluss && e0 && Number.isFinite(Number(a.schluss.t)) && Number.isFinite(Number(e0.t)))
    omega = Z.gierDrift(e0.v, e0.t, a.schluss.v, a.schluss.t);
  return {
    p: { h: hCam - L, r, L, delta: (dGrad ?? 0) * Z.GRAD, omega, t0: Number(e0?.t) || 0, stand: [0, 0] },
    sig: { h: halt.sigH, r: halt.sigR, delta: (dGrad != null ? SIGMA_DELTA_KAL : SIGMA_DELTA_ROH) * Z.GRAD }
  };
}

/** Raumhöhe aus der gezielten senkrechten Kante (oder null). */
export function raumhoeheAusKante(a, p) {
  const k = a.hoehe;
  if (!k || !k.vUnten || !k.vOben) return null;
  const H = Z.kantenhoeheM(k.vUnten, k.vOben, p, k.tUnten, k.tOben);
  return H > p.h ? H : null;
}

/** Raumhöhe über dem gezielten Boden: bekannt (getippt) vor gezielt. */
export function raumhoehe(a, p) {
  if (Number(a.raumhoeheM) > 0) return Number(a.raumhoeheM);
  return raumhoeheAusKante(a, p);
}

/** Weltpunkte der Ecken bei Parametern p; Deckenecken brauchen die Raumhöhe H. */
export function eckenWelt(a, p, H = raumhoehe(a, p)) {
  const pts = [];
  for (const e of a.ecken || []) {
    const q = e.ebene === "decke" ? (H ? Z.deckenpunktM(e.v, p, H, e.t) : null) : Z.bodenpunktM(e.v, p, e.t);
    if (q) pts.push({ p: [q.x, q.y], sigma: rauschSigma(e, p, H, q) });
  }
  return pts;
}

/** Rauschanteil (1σ, m) einer gezielten Ecke: radial z/sin²θ·σ, seitlich ρ·σ. */
function rauschSigma(e, p, H, q) {
  const k = Z.kamera(e.v, p, e.t);
  const s = SIGMA_GRAD * Z.GRAD;
  const hoch = e.ebene === "decke" ? (H - k.z) : k.z;
  const winkel = Math.abs(k.th);
  if (!(winkel > 0)) return Infinity;
  return Math.hypot(hoch / Math.sin(winkel) ** 2 * s, q.d * s);
}

/**
 * Ehrliche Live-Unsicherheit eines Bodenpunkts beim Zielen (1σ, m) – mit der
 * noch offenen Kamerahöhe, dem Armabstand und dem Neigungsfehler, nicht nur
 * dem Zittern. Sinkt, sobald ein Maßstab gesetzt ist.
 */
export function unsicherheitLive(v, a) {
  const { p, sig } = parameterStart(a);
  const k = Z.kamera(v, p);
  if (k.th < Z.MIN_NEIGUNG_GRAD * Z.GRAD) return Infinity;
  const ct = 1 / Math.tan(k.th), s2 = k.z / Math.sin(k.th) ** 2;
  const sw = SIGMA_GRAD * Z.GRAD;
  return Math.sqrt((ct * sig.h) ** 2 + sig.r ** 2 + (s2 * sig.delta) ** 2 + (s2 * sw) ** 2);
}

/** Unrunde Wandliste (Länge, Drehung danach) eines Umrisses. */
function waendeRoh(punkte) {
  const n = punkte.length;
  return punkte.map((a, i) => {
    const b = punkte[(i + 1) % n], c = punkte[(i + 2) % n];
    let d = (Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) / Z.GRAD;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return { laenge: Math.hypot(b[0] - a[0], b[1] - a[1]), drehung: d };
  });
}

/** Umriss, Wände und Rauschen bei Parametern p – vor jedem Glätten. */
function geometrie(a, p) {
  const H = raumhoehe(a, p);
  const ew = eckenWelt(a, p, H);
  if (ew.length < 3) return null;
  const welt = ew.map(e => e.p);
  const raum = Z.raumAusEcken(welt);
  const sigma = raum.reihenfolge.map(i => ew[i].sigma);
  return { welt, raum, roh: waendeRoh(raum.punkte), sigma, fehlend: (a.ecken || []).length - ew.length, H };
}

// --------------------------------------------------------------- Ausgleich

/**
 * Residuen (normiert auf ihre Unsicherheit) für die Parameter x = [h, r, δ].
 * `plan` hält fest, welche Ecken als rechtwinklig gelten – einmal am Anfang
 * bestimmt, damit die Zahl der Residuen beim Ableiten gleich bleibt.
 */
function residuen(a, x, start, plan) {
  const p = { ...start.p, h: x[0], r: x[1], delta: x[2] };
  const geo = geometrie(a, p);
  if (!geo || geo.roh.length !== plan.n) return null;
  const res = [];
  for (const [i, ziel] of plan.recht) res.push((geo.roh[i].drehung - ziel) / SIGMA_RECHT_GRAD);
  for (const [i, m, sigma] of plan.band) res.push((geo.roh[i].laenge - m) / sigma);
  if (plan.raumhoehe) {
    const Hk = raumhoeheAusKante(a, p);
    res.push(Hk ? (Hk - plan.raumhoehe) / SIGMA_RAUMHOEHE_M : 1e3);
  }
  for (const s of plan.senkrechte) {
    const Hs = Z.kantenhoeheM(s.vUnten, s.vOben, p, s.tUnten, s.tOben);
    res.push(Number.isFinite(Hs) ? (Hs - Number(s.hoeheM)) / SIGMA_KANTE_M : 1e3);
  }
  // Bekannte Öffnungshöhe = die angezeigte Größe: ab FFB, beim Fenster mit
  // Brüstung von Unter- bis Oberkante (wie in Schritt 4 von `rekonstruiere`).
  for (const { o, bruestung } of plan.oeffnungen) {
    const r = oeffnungRoh(o, p, geo);
    res.push(r ? (r.oben - (bruestung ? r.unten : plan.abzug) - Number(o.hoeheBekanntM)) / SIGMA_KANTE_M : 1e3);
  }
  res.push((x[0] - start.p.h) / start.sig.h, (x[1] - start.p.r) / start.sig.r, (x[2] - start.p.delta) / start.sig.delta);
  return res;
}

/** Levenberg-Marquardt über wenige Parameter; liefert Lösung und Kovarianz. */
function ausgleichen(f, x0) {
  let x = x0.slice();
  let r = f(x);
  if (!r) return null;
  let kosten = summeQ(r), lambda = 1e-3;
  for (let it = 0; it < 60; it++) {
    const J = jacobi(f, x, r);
    if (!J) break;
    const { N, g } = normal(J, r);
    const A = N.map((zeile, i) => zeile.map((v, j) => v + (i === j ? lambda * (N[i][i] || 1e-9) : 0)));
    const dx = loese(A, g.map(v => -v));
    if (!dx) break;
    const xn = x.map((v, i) => v + dx[i]);
    const rn = f(xn);
    if (rn && summeQ(rn) < kosten) {
      x = xn; r = rn; kosten = summeQ(rn); lambda = Math.max(lambda / 4, 1e-9);
      if (Math.hypot(...dx) < 1e-10) break;
    } else {
      lambda *= 6;
      if (lambda > 1e8) break;
    }
  }
  const J = jacobi(f, x, r);
  const Q = J ? invertiere(normal(J, r).N) : null;
  return { x, r, kosten, Q };
}

function jacobi(f, x, r0) {
  const spalten = [];
  for (let j = 0; j < x.length; j++) {
    const e = 1e-6 * (1 + Math.abs(x[j]));
    const q = x.slice(); q[j] += e;
    const r = f(q);
    if (!r || r.length !== r0.length) return null;
    spalten.push(r.map((v, k) => (v - r0[k]) / e));
  }
  return spalten;   // spalten[j][k] = ∂r_k/∂x_j
}
function normal(J, r) {
  const n = J.length;
  const N = Array.from({ length: n }, () => Array(n).fill(0)), g = Array(n).fill(0);
  for (let k = 0; k < r.length; k++)
    for (let i = 0; i < n; i++) { g[i] += J[i][k] * r[k]; for (let j = 0; j < n; j++) N[i][j] += J[i][k] * J[j][k]; }
  return { N, g };
}
function loese(M, b) {
  const n = b.length, A = M.map((z, i) => [...z, b[i]]);
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[mx][i])) mx = k;
    if (Math.abs(A[mx][i]) < 1e-14) return null;
    [A[i], A[mx]] = [A[mx], A[i]];
    for (let k = i + 1; k < n; k++) { const q = A[k][i] / A[i][i]; for (let j = i; j <= n; j++) A[k][j] -= q * A[i][j]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = A[i][n]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}
function invertiere(M) {
  const n = M.length, spalten = [];
  for (let j = 0; j < n; j++) { const e = Array(n).fill(0); e[j] = 1; const s = loese(M, e); if (!s) return null; spalten.push(s); }
  return M.map((_, i) => spalten.map(s => s[i]));
}
const summeQ = r => r.reduce((s, v) => s + v * v, 0);

// -------------------------------------------------------------- Rekonstruktion

/**
 * Rechnet eine Aufnahme in einen Raum um. Gibt `null`, solange weniger als
 * drei Ecken gesetzt sind.
 *
 * Ergebnis:
 *   punkte, umriss       – Raumsystem des Kerns, im Uhrzeigersinn, auf (0,0)
 *   waende[]             – { laenge, drehung, quelle: "band"|"gezielt", sigmaM, korrekturM }
 *   hoeheM               – lichte Raumhöhe ab Fertigfußboden (oder null)
 *   kamerahoeheM, armM, neigungsfehlerGrad – ausgeglichene Haltung
 *   skala                – Kamerahöhe ausgeglichen / angenommen
 *   kalibriert, klasse   – gibt es einen Maßstab? SKIZZE | PLAN | AUFMASS
 *   sigmaHoeheM          – Unsicherheit gezielter Höhen (1σ)
 *   naechstesMass        – { wandIndex, text } – was jetzt am meisten bringt
 *   oeffnungen[], einbauten[] – im Datenmodell des Kerns (ohne raumId)
 *   restlueckeM          – Lücke vor dem Ausgleich (Qualitätsaussage)
 *   hinweise[]           – Sätze für die Oberfläche
 */
export function rekonstruiere(a, optionen = {}) {
  const aufbau = Number(optionen.aufbauM) || 0;
  const abzug = a.boden === "roh" ? aufbau : 0;   // gezielte Höhen → ab Fertigfußboden
  const hinweise = [];
  const start = parameterStart(a);
  let geo = geometrie(a, start.p);
  if (!geo) return null;
  const n = geo.roh.length;

  // 1. Was ist bekannt? (einmal festlegen, damit die Residuen stabil bleiben)
  const band = Object.entries(a.bandmasse || {})
    .map(([i, m]) => [Number(i), Number(m)])
    .filter(([i, m]) => Number.isInteger(i) && i >= 0 && i < n && m > 0);
  // Fenster mit Brüstung oder nicht: einmal bei den Startwerten entschieden,
  // damit Zahl und Form der Residuen beim Ausgleich gleich bleiben.
  const mitBruestung = new Map((a.oeffnungen || []).map(o => {
    const r = o.a ? oeffnungRoh(o, start.p, geo) : null;
    return [o, !!r && hatBruestung(o, r.unten - abzug)];
  }));
  // Ein Bandmaß ist genau, die gezielte Länge derselben Wand nicht: Ihr
  // Zielrauschen gehört ins Residuum, sonst presst der Ausgleich es in h, r, δ
  // (δ landete so bei 2,5° statt 0,5°) und verzerrt die Winkel aller Wände.
  const bandSigma = i => Math.hypot(SIGMA_BAND_M, geo.sigma[i] || 0, geo.sigma[(i + 1) % n] || 0);
  const plan = {
    n, band: band.map(([i, m]) => [i, m, bandSigma(i)]), abzug,
    recht: a.rechtwinklig ? geo.roh.map((w, i) => [i, Math.round(w.drehung / 90) * 90])
      .filter(([i, ziel]) => Math.abs(geo.roh[i].drehung - ziel) < RECHT_FANG_GRAD) : [],
    raumhoehe: a.hoehe && Number(a.raumhoeheM) > 0 ? Number(a.raumhoeheM) : null,
    senkrechte: (a.senkrechte || []).filter(s => s && s.vUnten && s.vOben && Number(s.hoeheM) > 0),
    oeffnungen: (a.oeffnungen || []).filter(o => Number(o.hoeheBekanntM) > 0 && o.a && o.b)
      .map(o => ({ o, bruestung: mitBruestung.get(o) }))
  };
  const referenzen = band.length + (plan.raumhoehe ? 1 : 0) + plan.senkrechte.length + plan.oeffnungen.length;

  // 2. Haltung ausgleichen: h, r, δ.
  const x0 = [start.p.h, start.p.r, start.p.delta];
  const lsg = ausgleichen(x => residuen(a, x, start, plan), x0) || { x: x0, Q: null };
  const p = { ...start.p, h: lsg.x[0], r: lsg.x[1], delta: lsg.x[2] };
  geo = geometrie(a, p) || geo;

  if (geo.fehlend > 0)
    hinweise.push(`${geo.fehlend} Ecke(n) ohne Treffer ausgelassen (zu flach gezielt oder Raumhöhe für Deckenecken fehlt).`);
  const kamerahoeheM = p.h + p.L;
  const skala = kamerahoeheM / (Number(a.kamerahoeheM) || kamerahoeheM);
  if (referenzen && Math.abs(skala - 1) > 0.04)
    hinweise.push(`Kamerahöhe auf ${fmt(kamerahoeheM)} ausgeglichen (geschätzt ${fmt(a.kamerahoeheM)}).`);
  // Die Laser-Raumhöhe setzt nur über die gezielte Raumkante einen Maßstab.
  if (!referenzen && a.hoehe)
    hinweise.push(`Noch kein Maßstab: eine Wand mit dem Bandmaß, die Raumhöhe (Laser) oder eine Türhöhe (Norm-Innentür lichte Höhe ≈ ${fmt(TUER_LICHT_M)}) eintragen – dann stimmt jedes Maß.`);
  else if (!referenzen)
    hinweise.push(`Noch kein Maßstab: eine Wand mit dem Bandmaß oder eine Türhöhe (Norm-Innentür lichte Höhe ≈ ${fmt(TUER_LICHT_M)}) eintragen – dann stimmt jedes Maß. ${KANTE_FEHLT}`);
  const driftGrad = Math.abs(p.omega) * (zeitSpanne(a)) / Z.GRAD;
  if (a.schluss && driftGrad > 3) hinweise.push(`Die Richtung ist während der Aufnahme um ${komma(driftGrad, 1)}° weggelaufen – herausgerechnet.`);
  if (!a.schluss && (a.ecken || []).length >= 4) hinweise.push("Tipp: Ein Schlussschuss auf Ecke 1 rechnet das Weglaufen der Richtung heraus.");
  // Widersprechen sich Maße deutlich, ist eines falsch abgelesen.
  if (referenzen > 1) for (const [i, m] of band) {
    const abw = Math.abs(geo.roh[i].laenge - m);
    if (abw > 0.08) hinweise.push(`Wand ${i + 1}: Bandmaß ${fmt(m)} weicht ${Math.round(abw * 100)} cm von der Zielmessung ab – richtig abgelesen?`);
  }

  // Kovarianz der Rohlängen: Rauschen je Wand + gemeinsame Unsicherheit von
  // (h, r, δ) – letztere ist zwischen den Wänden korreliert.
  const rausch = geo.roh.map((_, i) => Math.hypot(geo.sigma[i], geo.sigma[(i + 1) % geo.sigma.length]));
  const Gm = lsg.Q ? geo.roh.map((_, i) => ableitung(a, p, i)) : [];
  // Ohne Schlussschuss ist die Drift unbekannt: ihr Einfluss auf die Längen
  // (alle Wände gemeinsam) geht als eine weitere Spalte in die Kovarianz.
  const drift = !a.schluss ? SIGMA_DRIFT_GRAD_MIN * Z.GRAD / 60000 : 0;
  const geoDrift = drift ? geometrie(a, { ...p, omega: p.omega + drift }) : null;
  const dDrift = geoDrift && geoDrift.roh.length === geo.roh.length ? geo.roh.map((w, i) => geoDrift.roh[i].laenge - w.laenge) : null;
  const C = geo.roh.map((_, i) => geo.roh.map((__, j) => {
    let v = i === j ? rausch[i] ** 2 : 0;
    if (lsg.Q && Gm[i] && Gm[j])
      for (let s = 0; s < 3; s++) for (let t = 0; t < 3; t++) v += Gm[i][s] * lsg.Q[s][t] * Gm[j][t];
    if (dDrift) v += dDrift[i] * dDrift[j];
    return v;
  }));
  const steil = (a.ecken || []).filter(e => e.ebene !== "decke" && Z.zielBereich(e.v, p) === "steil").length;
  if (steil) hinweise.push(`${steil} Ecke(n) fast senkrecht unter dem Handy angezielt – dort ungenau. Besser einen Schritt zurück.`);

  // 3. Wände: glätten, Bandmaße einsetzen, ausgleichen.
  let waende = geo.roh.map(w => ({ ...w }));
  if (a.rechtwinklig) waende = G.rechtwinklig(waende, RECHT_FANG_GRAD);
  for (const [i, m] of band) waende[i].laenge = m;
  const fest = band.map(([i]) => i);
  // Erklärt das Messrauschen die Lücke nicht, stimmt das Modell nicht (meist
  // eine Ecke, die gar nicht rechtwinklig ist) – dann ist die Schließkorrektur
  // selbst die ehrliche Unsicherheit der verschobenen Wände.
  const lueckeSigma = lueckeInSigma(waende, fest, C, rausch);
  const auffaellig = lueckeSigma > 3;
  // Gleitend statt Kippschalter: Schon ab 1,5σ zählt ein Teil der
  // Schließkorrektur zur Unsicherheit, ab 3σ die ganze – sonst springt eine
  // Wand an der Schwelle von ± 0,5 cm auf ± 20 cm.
  const gewichtKorrektur = klemm((lueckeSigma - 1.5) / 1.5, 0, 1);
  const sigmaRichtung = richtungsSigma(geo, waende, fest, a, p, lsg.Q, drift);
  const geglaettet = waende.some((w, i) => w.drehung !== geo.roh[i].drehung);
  const aus = G.ausgleichen(waende, fest);
  const korrektur = aus.korrektur;
  waende = aus.waende;
  const punkte = zugPunkte(waende);
  if (auffaellig && aus.restlueckeVorher > 0.03 && aus.restlueckeNachher <= 0.02) {
    // Welche Seite stimmt, sagt erst ein Bandmaß an der am weitesten verschobenen Wand.
    const k = korrektur.reduce((b, v, i) => (Math.abs(v) > Math.abs(korrektur[b]) ? i : b), 0);
    // Erst ein Bandmaß dort entscheidet, ob eine Ecke schief ist – „Glätten
    // aus“ auf bloßen Verdacht macht ein rechtwinkliges Aufmaß nur schlechter.
    hinweise.push(`Restlücke vor dem Ausgleich ${Math.round(aus.restlueckeVorher * 100)} cm – mehr, als die Messung erklärt: `
      + `Wand ${k + 1} musste um ${Math.round(Math.abs(korrektur[k]) * 100)} cm verschoben werden. Wand ${k + 1} mit dem Bandmaß nachmessen`
      + (geglaettet ? ` – passt es nicht zum Ausgleich, ist eine Ecke nicht rechtwinklig${schiefsteEcke(geo.roh, waende)}.` : " und die Bandmaße prüfen."));
  } else if (aus.restlueckeVorher > 0.03 && aus.restlueckeNachher <= 0.02)
    hinweise.push(`Restlücke vor dem Ausgleich ${Math.round(aus.restlueckeVorher * 100)} cm – auf die nicht gemessenen Wände verteilt.`);
  if (aus.restlueckeNachher > 0.02)
    hinweise.push(geglaettet
      ? `Restlücke ${Math.round(aus.restlueckeNachher * 100)} cm bleibt – die Bandmaße passen nicht zu rechten Winkeln: eine Ecke ist schief${schiefsteEcke(geo.roh, waende)}. „Rechtwinklig glätten“ ausschalten oder die Bandmaße prüfen.`
      : `Restlücke ${Math.round(aus.restlueckeNachher * 100)} cm bleibt – die Bandmaße passen nicht zusammen.`);
  hinweise.push(...G.pruefen(punkte));

  // Unsicherheit nach dem Ausgleich: die Kovarianz linear durch den Zugausgleich
  // geführt – eine Wand, die durch Bandmaße und Schluss festliegt, ist so
  // genau wie diese, nicht so ungenau wie ihr Zielstrahl.
  const sigmaNach = kovarianzNachAusgleich(waende, fest, C, aus.restlueckeNachher);
  const wl = waende.map((w, i) => {
    const istBand = fest.includes(i);
    return {
      laenge: w.laenge, drehung: w.drehung,
      quelle: istBand ? "band" : "gezielt",
      sigmaM: istBand ? SIGMA_BAND_M : Math.max(Math.hypot(sigmaNach[i], sigmaRichtung[i], gewichtKorrektur * korrektur[i]), SIGMA_BAND_M),
      korrekturM: korrektur[i]
    };
  });
  // Schließt der Umriss nicht (Bandmaße widersprechen sich), stimmt die Form
  // höchstens so gut wie die Lücke – auch wenn jede Wand genau gemessen ist.
  const maxSigma = Math.max(...wl.map(w => w.sigmaM), aus.restlueckeNachher > 0.02 ? aus.restlueckeNachher : 0);
  // Höhen (Steckdosen, Brüstungen, Raumhöhe) hängen direkt an der Linsenhöhe –
  // deren Restunsicherheit ist die ehrliche Höhenangabe.
  const sigmaHoeheM = lsg.Q ? Math.sqrt(Math.max(0, lsg.Q[0][0]) + (0.005) ** 2) : start.sig.h;
  if (sigmaHoeheM > 0.02) {
    const wege = [zahlOderNull(a.neigungsfehlerGrad) == null ? "die Neigung einmal kalibrieren" : null,
      a.hoehe ? "die Raumhöhe (Laser) eintragen" : "eine Raumkante anzielen und die Raumhöhe (Laser) eintragen"];
    hinweise.push(`Höhen ± ${Math.round(sigmaHoeheM * 100)} cm – für genaue Höhen ${wege.filter(Boolean).join(" oder ")}.`);
  }
  const klasse = maxSigma <= 0.05 ? "AUFMASS" : maxSigma <= 0.15 ? "PLAN" : "SKIZZE";
  const offen = wl.map((w, i) => [i, w]).filter(([, w]) => w.quelle !== "band");
  // Geglättete Ecken sind eine Annahme, die keine Zielmessung prüft (auch
  // Bandmaße an allen Wänden nicht: ein Parallelogramm hat dieselben Längen).
  const frei = offen.map(([i]) => i);
  const annahmeRecht = geglaettet;
  let naechstesMass = null;
  if (offen.length && klasse !== "AUFMASS") {
    const [i, w] = band.length ? offen.reduce((b, c) => (c[1].sigmaM > b[1].sigmaM ? c : b))
      : offen.reduce((b, c) => (c[1].laenge > b[1].laenge ? c : b));
    naechstesMass = { wandIndex: i, text: `Am meisten bringt jetzt ein Bandmaß an Wand ${i + 1} (${fmt(w.laenge)}, bisher ± ${Math.round(w.sigmaM * 100)} cm).` };
  } else if (annahmeRecht && frei.length) {
    // Kontrollmaß: alle freien Wände einer Richtung messen – dann bestimmen die
    // Bandmaße den Zug in dieser Richtung über, und eine schiefe Ecke zeigt sich
    // als Restlücke. Vorschlag: die kleinere Gruppe, bei Gleichstand die, die
    // der Schluss am stärksten verschoben hat.
    const gruppen = richtungsGruppen(waende, frei);
    const gewicht = g => g.reduce((s, i) => s + Math.abs(korrektur[i]) + sigmaRichtung.annahme[i], 0);
    if (gruppen.length <= 2) {
      const g = gruppen.reduce((b, c) => (c.length < b.length || (c.length === b.length && gewicht(c) > gewicht(b)) ? c : b));
      const liste = g.map(i => `Wand ${i + 1} (${fmt(wl[i].laenge)})`).join(" und ");
      naechstesMass = { wandIndex: g[0], waende: g, kontrolle: true,
        text: `Kontrollmaß: ${g.length > 1 ? "Bandmaße an" : "ein Bandmaß an"} ${liste} ${g.length > 1 ? "zeigen" : "zeigt"}, ob eine Ecke schief ist – das Ergebnis setzt bisher rechte Winkel voraus.` };
    }
  }

  // Raumhöhe
  const Hroh = raumhoehe(a, p);
  const hoeheM = Hroh ? runde(Hroh - abzug) : null;

  // 4. Öffnungen und Einbauten über den Schnitt mit den (unausgeglichenen)
  //    Wänden; Abstände anteilig auf die ausgeglichene Wand übertragen.
  const laengen = waende.map(w => w.laenge);
  const oeffnungen = [];
  for (const o of a.oeffnungen || []) {
    const r = oeffnungRoh(o, p, geo);
    if (!r) { hinweise.push(`${artName(o.art)}: Wand nicht getroffen – erneut zielen.`); continue; }
    const lang = laengen[r.index];
    const x0 = klemm(r.anteil0 * lang, 0, lang), x1 = klemm(r.anteil1 * lang, 0, lang);
    let unten = r.unten - abzug, oben = r.oben - abzug;
    // Türen stehen auf dem Boden. Bei bekannter Höhe gilt die Entscheidung des
    // Ausgleichs, damit angezeigte und eingetragene Höhe dieselbe Größe sind.
    const bekannt = plan.oeffnungen.some(q => q.o === o);
    if (!(bekannt ? mitBruestung.get(o) : hatBruestung(o, unten))) unten = 0;
    if (hoeheM) oben = Math.min(oben, hoeheM);
    const breite = x1 - x0;
    if (breite < 0.2) hinweise.push(`${artName(o.art)}: nur ${Math.round(breite * 100)} cm breit – beide Ecken getroffen?`);
    oeffnungen.push({
      id: o.id, art: o.art || "TUER", wandIndex: r.index,
      abstandM: runde(x0), breiteM: runde(Math.max(breite, 0.1)),
      bruestungM: runde(Math.max(0, unten)), hoeheM: runde(Math.max(0.2, oben - Math.max(0, unten)))
    });
  }

  const einbauten = [];
  const bb = { b: Math.max(...geo.raum.punkte.map(q => q[0])) || 1, t: Math.max(...geo.raum.punkte.map(q => q[1])) || 1 };
  for (const e of a.einbauten || []) {
    if (e.befestigung === "DECKE") {
      const q = Hroh ? Z.deckenpunktM(e.v, p, Hroh, e.t) : null;
      if (!q) { hinweise.push(`${e.art}: Decke nicht getroffen (Raumhöhe fehlt?).`); continue; }
      const m = geo.raum.abbildung([q.x, q.y]);
      einbauten.push({ id: e.id, art: e.art, befestigung: "DECKE", relX: klemm01(m[0] / bb.b), relY: klemm01(m[1] / bb.t), hoeheM });
      continue;
    }
    const w = wandBezug(e.v, p, geo, e.t);
    if (w) {
      einbauten.push({
        id: e.id, art: e.art, befestigung: "WAND", wandIndex: w.index,
        abstandM: runde(klemm(w.anteil * laengen[w.index], 0, laengen[w.index])), hoeheM: runde(Math.max(0, w.hoehe - abzug))
      });
      continue;
    }
    // Auf den Boden gezielt: an die nächste Wand legen, Höhe nach Norm (Aufrufer).
    const q = Z.bodenpunktM(e.v, p, e.t);
    if (!q) { hinweise.push(`${e.art}: weder Wand noch Boden getroffen.`); continue; }
    const m = geo.raum.abbildung([q.x, q.y]);
    const nw = G.naechsteWand({ umriss: G.umrissSchreiben(geo.raum.punkte) }, m[0], m[1]);
    einbauten.push({
      id: e.id, art: e.art, befestigung: "WAND", wandIndex: nw.index,
      abstandM: runde(klemm(nw.abstand / (geo.roh[nw.index].laenge || 1) * laengen[nw.index], 0, laengen[nw.index])), hoeheM: null
    });
  }

  return {
    punkte, umriss: G.umrissSchreiben(punkte), waende: wl, hoeheM,
    kamerahoeheM: runde(kamerahoeheM, 3), armM: runde(p.r, 3), neigungsfehlerGrad: runde(p.delta / Z.GRAD, 2),
    skala, kalibriert: referenzen > 0, klasse, annahmen: annahmeRecht ? ["rechtwinklig"] : [],
    naechstesMass, sigmaHoeheM, oeffnungen, einbauten,
    restlueckeM: aus.restlueckeVorher, restlueckeNachherM: aus.restlueckeNachher,
    flaecheM2: G.flaechePunkte(punkte), hinweise
  };
}

/**
 * Unsicherheit (1σ) jeder Wand nach `G.ausgleichen`. Der Ausgleich ist linear
 * in den Längen: l'_frei = A·l_frei + B·m_fest mit A = I − Uᵀ M⁺ U und
 * B = −Uᵀ M⁺ U_fest (U = Richtungen der freien Wände, M = U Uᵀ, Pseudo-Inverse
 * wie im Kern). Also Cov' = A·C·Aᵀ + B·σ²_Band·Bᵀ. Eine bleibende Restlücke
 * (widersprüchliche Bandmaße) wird als zusätzliche Unsicherheit aufgeschlagen.
 */
function kovarianzNachAusgleich(waende, fest, C, restluecke) {
  const n = waende.length;
  const richt = richtungen(waende);
  const festSet = new Set(fest);
  const F = [...Array(n).keys()].filter(i => !festSet.has(i));
  const B = [...festSet];
  let m00 = 0, m01 = 0, m11 = 0;
  for (const i of F) { const [c, s] = richt[i]; m00 += c * c; m01 += c * s; m11 += s * s; }
  const [p00, p01, p11] = G.pseudoInverse(m00, m01, m11);   // derselbe Rang wie im Ausgleich
  const P = [[p00, p01], [p01, p11]];
  const kopplung = (i, j) => {   // u_iᵀ P u_j
    const [a0, a1] = richt[i], [b0, b1] = richt[j];
    return a0 * (P[0][0] * b0 + P[0][1] * b1) + a1 * (P[1][0] * b0 + P[1][1] * b1);
  };
  const sig = Array(n).fill(SIGMA_BAND_M);
  for (const i of F) {
    // Zeile i von A (über F) und B (über fest)
    const zA = F.map(j => (i === j ? 1 : 0) - kopplung(i, j));
    let v = 0;
    for (let x = 0; x < F.length; x++) for (let y = 0; y < F.length; y++) v += zA[x] * C[F[x]][F[y]] * zA[y];
    for (const j of B) v += kopplung(i, j) ** 2 * SIGMA_BAND_M ** 2;
    sig[i] = Math.sqrt(Math.max(0, v) + restluecke ** 2);
  }
  return sig;
}

/** Einheitsvektor jeder Wand im Zug (Start nach rechts, Drehungen aufsummiert). */
function richtungen(waende) {
  const richt = [];
  let r = 0;
  for (const w of waende) { richt.push([Math.cos(r * Z.GRAD), Math.sin(r * Z.GRAD)]); r += Number(w.drehung) || 0; }
  return richt;
}

/**
 * Lücke vor dem Ausgleich in Vielfachen ihrer erwarteten Streuung (Mahalanobis).
 * Bei festen Richtungen entsteht sie nur aus Längenfehlern:
 * g = Σ e_i·u_i, also C_g = Σ_frei u_i C_ij u_jᵀ + Σ_fest σ²_Band u_j u_jᵀ
 * (+ σ₀² je Achse für Ungenanntes). Das Zielrauschen der Bandmaß-Wände steckt
 * schon in Q (ihr Residuum ist danach gewichtet) und damit in C – nicht noch
 * einmal zählen. Über 3 erklärt das Rauschen die Lücke nicht mehr.
 */
function lueckeInSigma(waende, fest, C, rausch) {
  const u = richtungen(waende), festSet = new Set(fest);
  let gx = 0, gy = 0;
  waende.forEach((w, i) => { gx += w.laenge * u[i][0]; gy += w.laenge * u[i][1]; });
  let c00 = SIGMA_LUECKE_M ** 2, c01 = 0, c11 = SIGMA_LUECKE_M ** 2;
  for (let i = 0; i < waende.length; i++) for (let j = 0; j < waende.length; j++) {
    const v = festSet.has(i) || festSet.has(j) ? (i === j ? SIGMA_BAND_M ** 2 : 0) : C[i][j];
    c00 += u[i][0] * v * u[j][0]; c01 += u[i][0] * v * u[j][1]; c11 += u[i][1] * v * u[j][1];
  }
  const det = c00 * c11 - c01 * c01;
  return Math.sqrt(Math.max(0, (c11 * gx * gx - 2 * c01 * gx * gy + c00 * gy * gy) / det));
}

/** „ (Wand 4/1 gezielt 85,9°)“ – die am stärksten geglättete Ecke, ab 1° Abweichung. */
function schiefsteEcke(roh, glatt) {
  let beste = -1, abw = 0;
  roh.forEach((w, i) => { const d = Math.abs(w.drehung - glatt[i].drehung); if (d > abw) { abw = d; beste = i; } });
  if (beste < 0 || abw < 1) return "";
  return ` (Wand ${beste + 1}/${(beste + 1) % roh.length + 1} gezielt ${komma(180 - Math.abs(roh[beste].drehung), 1)}°)`;
}

/**
 * Unsicherheit (1σ je Wand, m) aus den **Richtungen**, die `kovarianzNachAusgleich`
 * (nur Längen) nicht sieht – der Ausgleich hält die Richtungen fest und trägt
 * ihre Fehler ganz in die freien Wände (1° auf 4 m sind 7 cm):
 *   · Zielrauschen jeder Ecke an nicht geglätteten Ecken (Ecke um ihr σ
 *     verschieben, Winkel neu bestimmen, Ausgleich wiederholen);
 *   · Restunsicherheit von (h, r, δ) – sie verzerrt nahe und ferne Ecken
 *     unterschiedlich und damit die Winkel (entlang der Cholesky-Spalten von Q);
 *   · ohne Schlussschuss die unbekannte Gier-Drift;
 *   · geglättete Ecken als Annahme mit SIGMA_RECHT_ANNAHME_GRAD.
 */
function richtungsSigma(geo, vorher, fest, a, p, Q, drift = 0) {
  const n = vorher.length;
  const ungeglaettet = vorher.map((w, i) => w.drehung === geo.roh[i].drehung);
  const basis = G.ausgleichen(vorher, fest).waende.map(w => w.laenge);
  const varianz = Array(n).fill(0), annahme = Array(n).fill(0);
  const zaehle = (w, nurAnnahme = false) => G.ausgleichen(w, fest).waende.forEach((x, i) => {
    const d2 = (x.laenge - basis[i]) ** 2;
    varianz[i] += d2;
    if (nurAnnahme) annahme[i] += d2;
  });
  if (ungeglaettet.some(Boolean)) {
    geo.raum.punkte.forEach((_, c) => {
      const s = geo.sigma[c] / Math.SQRT2;   // σ je Achse
      if (!Number.isFinite(s)) return;
      for (const [dx, dy] of [[s, 0], [0, s]]) {
        const roh = waendeRoh(geo.raum.punkte.map((q, k) => (k === c ? [q[0] + dx, q[1] + dy] : q)));
        zaehle(vorher.map((v, i) => (ungeglaettet[i] ? { ...v, drehung: roh[i].drehung } : v)));
      }
    });
    const spalten = cholesky(Q).map(c => ({ h: p.h + c[0], r: p.r + c[1], delta: p.delta + c[2] }));
    if (drift) spalten.push({ omega: p.omega + drift });     // ohne Schlussschuss
    for (const spalte of spalten) {
      const g = geometrie(a, { ...p, ...spalte });
      if (!g || g.roh.length !== n) continue;
      zaehle(vorher.map((v, i) => (ungeglaettet[i] ? { ...v, drehung: g.roh[i].drehung } : v)));
    }
  }
  vorher.forEach((_, c) => {
    if (ungeglaettet[c]) return;
    zaehle(vorher.map((v, i) => (i === c ? { ...v, drehung: v.drehung + SIGMA_RECHT_ANNAHME_GRAD } : v)), true);
  });
  const sigma = varianz.map(Math.sqrt);
  sigma.annahme = annahme.map(Math.sqrt);    // davon: nur die Annahme „rechtwinklig“
  return sigma;
}

/** Spalten der Cholesky-Zerlegung einer 3×3-Kovarianz (leer, wenn keine da ist). */
function cholesky(Q) {
  if (!Q) return [];
  const L = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
    let s = Q[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) L[i][i] = Math.sqrt(Math.max(s, 0));
    else L[i][j] = L[j][j] > 0 ? s / L[j][j] : 0;
  }
  return [0, 1, 2].map(k => [L[0][k], L[1][k], L[2][k]]).filter(c => c.some(v => v !== 0 && Number.isFinite(v)));
}

/** Freie Wände nach Richtung (bis 10° gleich, Gegenrichtung zählt mit) gruppieren. */
function richtungsGruppen(waende, idx) {
  const u = richtungen(waende), gruppen = [];
  for (const i of idx) {
    const g = gruppen.find(gr => Math.abs(u[gr[0]][0] * u[i][1] - u[gr[0]][1] * u[i][0]) < Math.sin(10 * Z.GRAD));
    if (g) g.push(i); else gruppen.push([i]);
  }
  return gruppen;
}

/** ∂(Länge der Wand i)/∂[h, r, δ] – für die Fehlerfortpflanzung. */
function ableitung(a, p, i) {
  const basis = geometrie(a, p);
  if (!basis) return null;
  const x = [p.h, p.r, p.delta], g = [];
  for (let j = 0; j < 3; j++) {
    const e = 1e-6 * (1 + Math.abs(x[j]));
    const q = x.slice(); q[j] += e;
    const geo = geometrie(a, { ...p, h: q[0], r: q[1], delta: q[2] });
    if (!geo || geo.roh.length !== basis.roh.length) return null;
    g.push((geo.roh[i].laenge - basis.roh[i].laenge) / e);
  }
  return g;
}

function zeitSpanne(a) {
  const ts = [...(a.ecken || []).map(e => Number(e.t)), Number(a.schluss?.t)].filter(Number.isFinite);
  return ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : 0;
}

/** Treffer eines Strahls auf der ersten Wand – Raum-Wandindex, Anteil, Höhe. */
function wandBezug(v, p, geo, t) {
  const w = Z.ersteWandM(v, p, geo.welt, t);
  if (!w) return null;
  const r = Z.wandUmrechnen(w.index, w.abstand, w.laenge, geo.welt.length, geo.raum.umgekehrt);
  return { index: r.index, anteil: w.laenge > 0 ? r.abstand / w.laenge : 0, hoehe: w.hoehe, tIndex: w.index };
}

/**
 * Eine Öffnung aus zwei diagonalen Ecken: Wand aus dem ersten Strahl, der
 * zweite wird auf dieselbe Wandebene gezwungen (der Sturz liegt oft knapp
 * neben der Zarge). Höhen über dem gezielten Boden, Lage als Anteile.
 */
function oeffnungRoh(o, p, geo) {
  const pa = o.a ? wandBezug(o.a, p, geo, o.ta) : null;
  if (!pa) return null;
  let pb = null;
  if (o.b) {
    const n = geo.welt.length;
    const t = Z.wandpunktM(o.b, p, geo.welt[pa.tIndex], geo.welt[(pa.tIndex + 1) % n], o.tb);
    if (t) {
      const r = Z.wandUmrechnen(pa.tIndex, t.abstand, t.laenge, n, geo.raum.umgekehrt);
      pb = { anteil: t.laenge > 0 ? r.abstand / t.laenge : 0, hoehe: t.hoehe };
    }
  }
  const b = pb || pa;
  return {
    index: pa.index,
    anteil0: Math.min(pa.anteil, b.anteil), anteil1: Math.max(pa.anteil, b.anteil),
    unten: Math.min(pa.hoehe, b.hoehe), oben: Math.max(pa.hoehe, b.hoehe)
  };
}

/**
 * Eckpunkte aus der Wandliste – wie `G.zug`, aber immer mit genau einer Ecke je
 * Wand: Bleibt eine Restlücke, schließt die letzte Wand sie (leicht schräg),
 * statt eine zusätzliche Schlusswand anzuhängen. So bleiben Wandindizes von
 * Öffnungen und Einbauten gültig.
 */
function zugPunkte(waende) {
  let x = 0, y = 0, r = 0;
  const p = [[0, 0]];
  for (const w of waende.slice(0, -1)) {
    x += w.laenge * Math.cos(r * Z.GRAD); y += w.laenge * Math.sin(r * Z.GRAD);
    p.push([x, y]);
    r += w.drehung;
  }
  return G.normieren(p);
}

/**
 * Vorschau während des Zielens: Ecken bisher (Welt) und Länge der Wände – mit
 * den Startwerten, ohne Ausgleich, damit man sieht, was das Handy gerade misst.
 */
export function vorschau(a) {
  const { p } = parameterStart(a);
  const H = raumhoehe(a, p);
  const pts = eckenWelt(a, p, H).map(e => e.p);
  const laengen = [];
  for (let i = 1; i < pts.length; i++) laengen.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { punkte: pts, laengen, p, H };
}

/** Wandindex im Raum → Wandindex in Tipp-Reihenfolge (für Hervorhebungen). */
export function wandNachTipp(a, raumIndex) {
  const geo = geometrie(a, parameterStart(a).p);
  if (!geo) return raumIndex;
  return Z.wandUmrechnen(raumIndex, 0, 0, geo.welt.length, geo.raum.umgekehrt).index;
}

// ---------------------------------------------------------------- Helfer

const KANTE_FEHLT = "Eine Laser-Raumhöhe wirkt als Maßstab erst mit einer gezielten Raumkante (Schritt „Raumhöhe“).";
const runde = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const klemm = (v, a, b) => Math.max(a, Math.min(b, v));
const klemm01 = v => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
const komma = (v, n) => Number(v).toFixed(n).replace(".", ",");
const fmt = m => `${komma(m, 2)} m`;
/** Hat die Öffnung eine Brüstung? Nur Fenster, ab 5 cm über dem FFB. */
const hatBruestung = (o, untenAbFFB) => o.art === "FENSTER" && untenAbFFB >= 0.05;
const artName = a => ({ TUER: "Tür", DURCHGANG: "Durchgang", FENSTER: "Fenster", TOR: "Tor" }[a] || a || "Öffnung");
