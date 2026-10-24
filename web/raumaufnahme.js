/*
 * Raumaufnahme ohne Würfel – aus gezielten Strahlen wird ein fertiger Raum.
 *
 * Eine Aufnahme speichert nicht Koordinaten, sondern **Rohdaten**: die
 * Blickrichtungen, die beim Zielen gemessen wurden, und die angenommene
 * Kamerahöhe. Erst `rekonstruiere` macht daraus Umriss, Raumhöhe, Öffnungen
 * und Einbauten. Das hat einen großen Vorteil: Wird später eine Wand mit dem
 * Bandmaß nachgemessen, rechnet die App den ganzen Raum aus denselben Strahlen
 * neu – richtig skaliert, statt eine fertige Zeichnung zu verbiegen.
 *
 * Ablauf von `rekonstruiere`:
 *   1. Kamerahöhe h: Bandmaße (kleinste Quadrate) > Senkrechte (Türzarge)
 *      > angenommene Höhe. Alles Weitere ist linear in h.
 *   2. Ecken → Boden- bzw. Deckenpunkte → Raumsystem (`Z.raumAusEcken`).
 *   3. Optional rechtwinklig glätten, Bandmaße exakt einsetzen, Restlücke
 *      über die übrigen Wände ausgleichen (`G.ausgleichen`).
 *   4. Öffnungen (zwei diagonale Ecken) und Einbauten (ein Punkt) über den
 *      Schnitt ihres Strahls mit der Wand – Wand, Abstand, Höhe.
 *   5. Jede Wand trägt ihre Maß-Herkunft: „Bandmaß“ oder „gezielt ± x cm“.
 *
 * Form der Aufnahme (alles JSON, wird am Raum gespeichert):
 *   {
 *     version: 1, methode: "zielen",
 *     kamerahoeheM: 1.40,             // beim Zielen angenommen
 *     boden: "roh" | "fertig",        // worauf gezielt wurde (Estrich drin?)
 *     ecken: [{ v:[x,y,z], ebene:"boden"|"decke" }],   // in Tipp-Reihenfolge
 *     hoehe: { vUnten, vOben } | null,  // Raumhöhe an einer senkrechten Kante
 *     raumhoeheM: null | Zahl,          // alternativ getippt
 *     senkrechte: [{ vUnten, vOben, hoeheM }],  // Kalibrierung, z. B. Tür 2,01
 *     bandmasse: { "<Raum-Wandindex>": Meter },
 *     rechtwinklig: true,
 *     oeffnungen: [{ id, art, a: v (unten links), b: v (oben rechts) }],
 *     einbauten:  [{ id, art, v, befestigung }]
 *   }
 *
 * Reine Funktionen, kein DOM – Tests: web/tests/raumaufnahme.test.mjs.
 */

import * as Z from "./zielen.js";
import * as G from "./geometrie.js";

/** Typischer Winkelfehler eines ruhig gehaltenen Handys (1σ, Grad). */
export const SIGMA_GRAD = 0.4;
/** Unsicherheit eines Bandmaßes (1σ, Meter). */
export const SIGMA_BAND_M = 0.005;

/** Leere Aufnahme mit sinnvollen Vorgaben. */
export function neueAufnahme(kamerahoeheM = 1.4, boden = "fertig") {
  return {
    version: 1, methode: "zielen", kamerahoeheM, boden,
    ecken: [], hoehe: null, raumhoeheM: null, senkrechte: [],
    bandmasse: {}, rechtwinklig: true, oeffnungen: [], einbauten: []
  };
}

/** Kamerahöhe nach Kalibrierung – ohne Bandmaße (die brauchen den Umriss). */
export function hoeheVorBand(a) {
  const hs = (a.senkrechte || [])
    .map(s => Z.hoeheAusSenkrechte(s.vUnten, s.vOben, Number(s.hoeheM)))
    .filter(h => h > 0.2 && h < 3);
  if (hs.length) return hs.reduce((x, y) => x + y, 0) / hs.length;
  return Number(a.kamerahoeheM) || 1.4;
}

/** Raumhöhe aus der gezielten senkrechten Kante bei Kamerahöhe h (oder null). */
export function raumhoeheAusKante(a, h) {
  if (!a.hoehe || !a.hoehe.vUnten || !a.hoehe.vOben) return null;
  const tb = Math.tan(Z.neigungGrad(a.hoehe.vUnten) * Z.GRAD);
  const tg = Math.tan(-Z.neigungGrad(a.hoehe.vOben) * Z.GRAD);
  if (!(tb > 0) || !(tg > 0)) return null;
  return h * (1 + tg / tb);
}

/**
 * Raumhöhe über dem gezielten Boden: getippt (Laser/Zollstock) vor gezielt.
 * Ist beides da, dient die getippte zugleich als Maßstab (`rekonstruiere`).
 */
export function raumhoeheGezielt(a, h) {
  if (Number(a.raumhoeheM) > 0) return Number(a.raumhoeheM);
  return raumhoeheAusKante(a, h);
}

/** Weltpunkte der Ecken bei Kamerahöhe h; Deckenecken brauchen die Raumhöhe H. */
export function eckenWelt(a, h, H) {
  const pts = [];
  for (const e of a.ecken || []) {
    const p = e.ebene === "decke" ? (H ? Z.deckenpunkt(e.v, h, H) : null) : Z.bodenpunkt(e.v, h);
    if (p) pts.push({ p: [p.x, p.y], sigma: eckSigma(e, h, H) });
  }
  return pts;
}

/** 1σ-Lagefehler einer gezielten Ecke in Metern. */
function eckSigma(e, h, H) {
  if (e.ebene === "decke" && H) {
    const v = [e.v[0], e.v[1], -e.v[2]];   // gespiegelt: gleiche Geometrie, Höhe H−h
    return Z.unsicherheitBoden(v, H - h, SIGMA_GRAD);
  }
  return Z.unsicherheitBoden(e.v, h, SIGMA_GRAD);
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

/**
 * Rechnet eine Aufnahme in einen Raum um. Gibt `null`, solange weniger als
 * drei Ecken gesetzt sind.
 *
 * Ergebnis:
 *   punkte, umriss       – Raumsystem des Kerns, im Uhrzeigersinn, auf (0,0)
 *   waende[]             – { laenge, drehung, quelle: "band"|"gezielt", sigmaM, korrekturM }
 *   hoeheM               – lichte Raumhöhe ab Fertigfußboden (oder null)
 *   kamerahoeheM, skala  – kalibrierte Kamerahöhe, Faktor gegenüber der Annahme
 *   oeffnungen[], einbauten[] – im Datenmodell des Kerns (ohne raumId)
 *   restlueckeM          – Lücke vor dem Ausgleich (Qualitätsaussage)
 *   hinweise[]           – Sätze für die Oberfläche
 */
export function rekonstruiere(a, optionen = {}) {
  const aufbau = Number(optionen.aufbauM) || 0;
  const abzug = a.boden === "roh" ? aufbau : 0;   // gezielte Höhen → ab Fertigfußboden
  const hinweise = [];

  // 1. Kamerahöhe: Annahme bzw. Türzarge, dann jedes bekannte Maß (Bandmaß,
  //    bekannte Raum- oder Öffnungshöhe) per kleinste Quadrate. Alles ist
  //    linear in h – ein Faktor korrigiert alle Ecken und Höhen zugleich.
  let h = hoeheVorBand(a);
  let geo = geometrie(a, h);
  if (!geo) return null;
  const band = Object.entries(a.bandmasse || {})
    .map(([i, m]) => [Number(i), Number(m)])
    .filter(([i, m]) => Number.isInteger(i) && i >= 0 && i < geo.roh.length && m > 0);
  const paare = referenzen(a, geo, h, band);
  let skala = h / (Number(a.kamerahoeheM) || h);
  if (paare.length) {
    const k = Z.skalaAusLaengen(paare);
    if (k && k > 0.3 && k < 3) {
      h *= k; skala *= k;
      geo = geometrie(a, h);
      // Widersprechen sich mehrere Maße deutlich, ist eines falsch abgelesen.
      if (paare.length > 1) for (const q of paare) {
        const abw = Math.abs(q.ist * k - q.soll);
        if (abw > 0.15) hinweise.push(`${q.was}: ${fmt(q.soll)} weicht ${Math.round(abw * 100)} cm von der Zielmessung ab – richtig abgelesen?`);
      }
    }
  }
  if (geo.fehlend > 0)
    hinweise.push(`${geo.fehlend} Ecke(n) ohne Treffer ausgelassen (zu flach gezielt oder Raumhöhe für Deckenecken fehlt).`);
  if (Math.abs(skala - 1) > 0.08)
    hinweise.push(`Kamerahöhe auf ${fmt(h)} korrigiert (angenommen ${fmt(a.kamerahoeheM)}).`);
  if (!paare.length)
    hinweise.push("Noch kein Maßstab: eine Wand mit dem Bandmaß, die Raumhöhe oder eine Türhöhe eintragen – dann stimmt jedes Maß.");

  // 2./3. Wände: glätten, Bandmaße einsetzen, ausgleichen.
  let waende = geo.roh.map(w => ({ ...w }));
  const sigma = geo.roh.map((_, i) => Math.hypot(geo.sigma[i], geo.sigma[(i + 1) % geo.sigma.length]));
  if (a.rechtwinklig) waende = G.rechtwinklig(waende, 8);
  for (const [i, m] of band) waende[i].laenge = m;
  const fest = band.map(([i]) => i);
  const aus = G.ausgleichen(waende, fest);
  const korrektur = aus.korrektur;
  waende = aus.waende;
  const punkte = zugPunkte(waende);
  if (aus.restlueckeVorher > 0.03)
    hinweise.push(`Restlücke vor dem Ausgleich ${Math.round(aus.restlueckeVorher * 100)} cm – auf die nicht gemessenen Wände verteilt.`);
  if (aus.restlueckeNachher > 0.02)
    hinweise.push(`Restlücke ${Math.round(aus.restlueckeNachher * 100)} cm bleibt – die Bandmaße passen nicht zusammen.`);
  hinweise.push(...G.pruefen(punkte));

  const wl = waende.map((w, i) => {
    const istBand = fest.includes(i);
    return {
      laenge: w.laenge, drehung: w.drehung,
      quelle: istBand ? "band" : "gezielt",
      sigmaM: istBand ? SIGMA_BAND_M : Math.max(sigma[i], Math.abs(korrektur[i])),
      korrekturM: korrektur[i]
    };
  });
  wl.forEach((w, i) => {
    if (w.quelle === "gezielt" && w.sigmaM > 0.1)
      hinweise.push(`Wand ${i + 1} ist unsicher (± ${Math.round(w.sigmaM * 100)} cm) – mit dem Bandmaß nachmessen.`);
  });

  // Raumhöhe
  const Hroh = raumhoeheGezielt(a, h);
  const hoeheM = Hroh ? runde(Hroh - abzug) : null;

  // 4. Öffnungen und Einbauten über den Schnitt mit den (unausgeglichenen)
  //    Wänden; Abstände anteilig auf die ausgeglichene Wand übertragen.
  const laengen = waende.map(w => w.laenge);
  const oeffnungen = [];
  for (const o of a.oeffnungen || []) {
    const r = oeffnungRoh(o, h, geo);
    if (!r) { hinweise.push(`${artName(o.art)}: Wand nicht getroffen – erneut zielen.`); continue; }
    const lang = laengen[r.index];
    const x0 = klemm(r.anteil0 * lang, 0, lang), x1 = klemm(r.anteil1 * lang, 0, lang);
    let unten = r.unten - abzug, oben = r.oben - abzug;
    if (o.art !== "FENSTER" || unten < 0.05) unten = 0;     // Türen stehen auf dem Boden
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
  const bb = { b: Math.max(...geo.raum.punkte.map(p => p[0])) || 1, t: Math.max(...geo.raum.punkte.map(p => p[1])) || 1 };
  for (const e of a.einbauten || []) {
    if (e.befestigung === "DECKE") {
      const p = Hroh ? Z.deckenpunkt(e.v, h, Hroh) : null;
      if (!p) { hinweise.push(`${e.art}: Decke nicht getroffen (Raumhöhe fehlt?).`); continue; }
      const q = geo.raum.abbildung([p.x, p.y]);
      einbauten.push({ id: e.id, art: e.art, befestigung: "DECKE", relX: klemm01(q[0] / bb.b), relY: klemm01(q[1] / bb.t), hoeheM });
      continue;
    }
    const w = wandBezug(e.v, h, geo);
    if (w) {
      einbauten.push({
        id: e.id, art: e.art, befestigung: "WAND", wandIndex: w.index,
        abstandM: runde(klemm(w.anteil * laengen[w.index], 0, laengen[w.index])), hoeheM: runde(Math.max(0, w.hoehe - abzug))
      });
      continue;
    }
    // Auf den Boden gezielt: an die nächste Wand legen, Höhe nach Norm (Aufrufer).
    const p = Z.bodenpunkt(e.v, h);
    if (!p) { hinweise.push(`${e.art}: weder Wand noch Boden getroffen.`); continue; }
    const q = geo.raum.abbildung([p.x, p.y]);
    const nw = G.naechsteWand({ umriss: G.umrissSchreiben(geo.raum.punkte) }, q[0], q[1]);
    einbauten.push({
      id: e.id, art: e.art, befestigung: "WAND", wandIndex: nw.index,
      abstandM: runde(klemm(nw.abstand / (geo.roh[nw.index].laenge || 1) * laengen[nw.index], 0, laengen[nw.index])), hoeheM: null
    });
  }

  return {
    punkte, umriss: G.umrissSchreiben(punkte), waende: wl, hoeheM,
    kamerahoeheM: runde(h, 3), skala, kalibriert: paare.length > 0, oeffnungen, einbauten,
    restlueckeM: aus.restlueckeVorher, restlueckeNachherM: aus.restlueckeNachher,
    flaecheM2: G.flaechePunkte(punkte), hinweise
  };
}

/**
 * Alle bekannten Maße als Paare { ist (bei Kamerahöhe h), soll, was } – jedes
 * davon ist linear in h und taugt deshalb als Maßstab.
 */
function referenzen(a, geo, h, band) {
  const paare = band.map(([i, m]) => ({ ist: geo.roh[i].laenge, soll: m, was: `Wand ${i + 1}` }));
  const Hk = raumhoeheAusKante(a, h);
  if (Hk && Number(a.raumhoeheM) > 0) paare.push({ ist: Hk, soll: Number(a.raumhoeheM), was: "Raumhöhe" });
  for (const o of a.oeffnungen || []) {
    if (!(Number(o.hoeheBekanntM) > 0)) continue;
    const r = oeffnungRoh(o, h, geo);
    if (r && r.oben > 0) paare.push({ ist: r.oben, soll: Number(o.hoeheBekanntM), was: `${artName(o.art)}-Oberkante` });
  }
  return paare;
}

/** Treffer eines Strahls auf der ersten Wand – Raum-Wandindex, Anteil, Höhe. */
function wandBezug(v, h, geo) {
  const t = Z.ersteWand(v, h, geo.welt);
  if (!t) return null;
  const r = Z.wandUmrechnen(t.index, t.abstand, t.laenge, geo.welt.length, geo.raum.umgekehrt);
  return { index: r.index, anteil: t.laenge > 0 ? r.abstand / t.laenge : 0, hoehe: t.hoehe, tIndex: t.index };
}

/**
 * Eine Öffnung aus zwei diagonalen Ecken: Wand aus dem ersten Strahl, der
 * zweite wird auf dieselbe Wandebene gezwungen (der Sturz liegt oft knapp
 * neben der Zarge). Höhen über dem gezielten Boden, Lage als Anteile.
 */
function oeffnungRoh(o, h, geo) {
  const pa = o.a ? wandBezug(o.a, h, geo) : null;
  if (!pa) return null;
  let pb = null;
  if (o.b) {
    const n = geo.welt.length;
    const t = Z.wandpunkt(o.b, h, geo.welt[pa.tIndex], geo.welt[(pa.tIndex + 1) % n]);
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

/** Umriss, Wände und Fehler bei Kamerahöhe h – vor jedem Glätten. */
function geometrie(a, h) {
  const H = raumhoeheGezielt(a, h);
  const ew = eckenWelt(a, h, H);
  if (ew.length < 3) return null;
  const fehlend = (a.ecken || []).length - ew.length;
  const welt = ew.map(e => e.p);
  const raum = Z.raumAusEcken(welt);
  // Fehler in Raum-Reihenfolge (raumAusEcken kann umdrehen).
  const sigma = raum.reihenfolge.map(i => ew[i].sigma);
  return { welt, raum, roh: waendeRoh(raum.punkte), sigma, fehlend };
}

/**
 * Vorschau während des Zielens: Ecken bisher (Welt) und Länge der Wände – ohne
 * Glätten, damit man sieht, was das Handy gerade misst.
 */
export function vorschau(a) {
  const h = hoeheVorBand(a);
  const H = raumhoeheGezielt(a, h);
  const ew = eckenWelt(a, h, H);
  const pts = ew.map(e => e.p);
  const laengen = [];
  for (let i = 1; i < pts.length; i++) laengen.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { punkte: pts, laengen, h, H };
}

/** Wandindex im Raum → Wandindex in Tipp-Reihenfolge (für Hervorhebungen). */
export function wandNachTipp(a, raumIndex) {
  const h = hoeheVorBand(a);
  const geo = geometrie(a, h);
  if (!geo) return raumIndex;
  return Z.wandUmrechnen(raumIndex, 0, 0, geo.welt.length, geo.raum.umgekehrt).index;
}

// ---------------------------------------------------------------- Helfer

const runde = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const klemm = (v, a, b) => Math.max(a, Math.min(b, v));
const klemm01 = v => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
const fmt = m => `${Number(m).toFixed(2).replace(".", ",")} m`;
const artName = a => ({ TUER: "Tür", DURCHGANG: "Durchgang", FENSTER: "Fenster", TOR: "Tor" }[a] || a || "Öffnung");
