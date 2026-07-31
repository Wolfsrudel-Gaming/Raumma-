/*
 * Normprüfung im Browser – Spiegel von `Pruefung.kt`.
 *
 * Das Alleinstellungsmerkmal (Konzept §8), live gerechnet, während ein
 * Klötzchen gezogen wird. Dieselben Zahlen wie im Kotlin-Kern; die Kotlin-Tests
 * sind verbindlich.
 *
 * Leitplanke: Freiraum immer als **untere Schranke** (gemessen − Toleranz, auf
 * ganze cm abgerundet). Lieber „mind. 118 cm" als „ca. 121 cm".
 *
 * Punkte sind [x, y] in Metern im Raumkoordinatensystem, wie in geometrie.js.
 */

import { ecken } from "./geometrie.js";
import { finde, Kategorie } from "./komponenten.js";
import { REGELN, Richtung, VERSION, biegeradiusFaktor, biegeradiusMm } from "./regelwerk.js";

export const TOLERANZ_M = 0.02;
export const Schwere = { OK: "OK", HINWEIS: "HINWEIS", WARNUNG: "WARNUNG" };

/** Die vier Eckpunkte der Grundfläche eines Klötzchens, im Uhrzeigersinn. */
export function grundriss(ph, komp) {
  const cx = Number(ph.xM), cy = Number(ph.yM);
  const th = Number(ph.drehungGrad || 0) * Math.PI / 180;
  const ux = Math.cos(th), uy = Math.sin(th);       // Breitenachse
  const nx = -Math.sin(th), ny = Math.cos(th);      // Tiefenachse (Vorderseite = +n)
  const hw = Number(komp.breiteM) / 2, ht = Number(komp.tiefeM) / 2;
  const eck = (a, b) => [cx + ux * a + nx * b, cy + uy * a + ny * b];
  return [eck(-hw, -ht), eck(hw, -ht), eck(hw, ht), eck(-hw, ht)];
}

/**
 * Freie Tiefe vor der Vorderseite (roh, ohne Toleranz). Number.MAX_VALUE, wenn
 * nichts im Weg steht.
 */
export function freieTiefeVorne(ph, komp, hindernisse) {
  const th = Number(ph.drehungGrad || 0) * Math.PI / 180;
  const ux = Math.cos(th), uy = Math.sin(th);
  const nx = -Math.sin(th), ny = Math.cos(th);
  const cx = Number(ph.xM), cy = Number(ph.yM);
  const hw = Number(komp.breiteM) / 2, ht = Number(komp.tiefeM) / 2;

  let beste = Number.MAX_VALUE;
  for (const s of hindernisse) {
    const la0 = (s.a[0] - cx) * ux + (s.a[1] - cy) * uy;
    const la1 = (s.b[0] - cx) * ux + (s.b[1] - cy) * uy;
    const ld0 = (s.a[0] - cx) * nx + (s.a[1] - cy) * ny - ht;
    const ld1 = (s.b[0] - cx) * nx + (s.b[1] - cy) * ny - ht;
    const t = minTiefeImBand(la0, ld0, la1, ld1, hw);
    if (t != null && t < beste) beste = t;
  }
  return beste;
}

function minTiefeImBand(la0, ld0, la1, ld1, hw) {
  let s0 = 0, s1 = 1;
  if (Math.abs(la1 - la0) < 1e-12) {
    if (Math.abs(la0) > hw) return null;
  } else {
    const sPlus = (hw - la0) / (la1 - la0);
    const sMinus = (-hw - la0) / (la1 - la0);
    s0 = Math.max(0, Math.min(sPlus, sMinus));
    s1 = Math.min(1, Math.max(sPlus, sMinus));
    if (s0 > s1) return null;
  }
  const e0 = ld0 + (ld1 - ld0) * s0;
  const e1 = ld0 + (ld1 - ld0) * s1;
  const kand = [];
  if (e0 >= 0) kand.push(e0);
  if (e1 >= 0) kand.push(e1);
  if ((e0 < 0) !== (e1 < 0)) kand.push(0);
  return kand.length ? Math.min(...kand) : null;
}

/** Kleinster Abstand zweier Grundflächen (konvexe Vierecke), in Metern. */
export function abstand(a, b) {
  if (a.some(p => imPolygon(p, b)) || b.some(p => imPolygon(p, a))) return 0;
  let beste = Number.MAX_VALUE;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      beste = Math.min(beste, streckeAbstand(a1, a2, b1, b2));
    }
  }
  return beste;
}

/** Prüft alle Klötzchen gegen das Regelwerk. Gibt auch die erfüllten Regeln zurück. */
export function pruefe(raum, platzhalter, regeln = REGELN) {
  const befunde = [];
  const wand = wandSegmente(raum);
  const mitKomp = platzhalter
    .map(ph => ({ ph, komp: finde(ph.komponente) }))
    .filter(x => x.komp);

  for (const { ph, komp } of mitKomp) {
    const rMm = biegeradiusMm(komp.kategorie, komp.aussenDurchmesserMm);
    if (rMm != null) {
      const faktor = biegeradiusFaktor(komp.kategorie);
      befunde.push({
        platzhalterId: ph.id, komponenteName: komp.name,
        regelId: "BIEGERADIUS", regelTitel: "Mindestbiegeradius",
        quelle: "Herstellervorgabe (Richtwert)", richtung: null,
        erforderlichM: Math.round(rMm) / 1000, verfuegbarM: null,
        schwere: Schwere.HINWEIS, regelVersion: VERSION,
        text: `Mindestbiegeradius ca. ${rMm} mm (${faktor}×Ø ${komp.aussenDurchmesserMm} mm).`
      });
    }

    for (const regel of regeln.filter(r => r.kategorie === komp.kategorie)) {
      if (regel.richtung === Richtung.VORNE) {
        if (!komp.bedienseiteVorn) continue;
        const andere = mitKomp.filter(x => x.ph.id !== ph.id)
          .flatMap(x => boxSegmente(grundriss(x.ph, x.komp)));
        const roh = freieTiefeVorne(ph, komp, wand.concat(andere));
        const verf = konservativ(roh);
        const ok = verf >= regel.abstandM;
        befunde.push(befund(ph, komp, regel, verf, ok,
          ok ? `Freiraum vor ${komp.name}: mind. ${cm(verf)} (gefordert ${cm(regel.abstandM)}).`
            : `${komp.name} unterschreitet den Freiraum davor: nur mind. ${cm(verf)} statt ${cm(regel.abstandM)}.`));
      } else if (regel.richtung === Richtung.RUNDUM) {
        const eigen = grundriss(ph, komp);
        let naechster = null, best = Number.MAX_VALUE;
        for (const x of mitKomp) {
          if (x.ph.id === ph.id) continue;
          const d = abstand(eigen, grundriss(x.ph, x.komp));
          if (d < best) { best = d; naechster = x; }
        }
        const verf = konservativ(best);
        const ok = verf >= regel.abstandM;
        const nachbar = naechster ? naechster.komp.name : "Nachbarbauteil";
        befunde.push(befund(ph, komp, regel, verf, ok,
          ok ? `Abstand von ${komp.name} rundum: mind. ${cm(verf)} (gefordert ${cm(regel.abstandM)}).`
            : `${komp.name} zu nah an ${nachbar}: nur mind. ${cm(verf)} statt ${cm(regel.abstandM)}.`));
      }
    }
  }
  return befunde;
}

function befund(ph, komp, regel, verf, ok, text) {
  return {
    platzhalterId: ph.id, komponenteName: komp.name,
    regelId: regel.id, regelTitel: regel.titel, quelle: regel.quelle,
    richtung: regel.richtung, erforderlichM: regel.abstandM, verfuegbarM: verf,
    schwere: ok ? Schwere.OK : Schwere.WARNUNG, text, regelVersion: VERSION
  };
}

/** Die Wände eines Raumes als Segmente {a,b}. */
export function wandSegmente(raum) {
  const e = ecken(raum);
  return e.map((a, i) => ({ a, b: e[(i + 1) % e.length] }));
}

/** Die vier Kanten einer Grundfläche als Segmente. */
export function boxSegmente(ecken4) {
  return ecken4.map((a, i) => ({ a, b: ecken4[(i + 1) % ecken4.length] }));
}

/** Konservativ: (roh − Toleranz), auf ganze cm abgerundet, nie negativ. */
export function konservativ(rohM) {
  if (rohM >= Number.MAX_VALUE / 2) return 99.99;
  const cmWert = Math.floor((rohM - TOLERANZ_M) * 100 + 1e-9) / 100;
  return Math.max(0, Math.round(cmWert * 100) / 100);
}

const cm = m => `${Math.round(m * 100)} cm`;

function imPolygon(p, poly) {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) &&
      p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) drin = !drin;
  }
  return drin;
}

function punktStrecke(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function streckeAbstand(a, b, c, d) {
  if (streckenSchneiden(a, b, c, d)) return 0;
  return Math.min(punktStrecke(a, c, d), punktStrecke(b, c, d),
    punktStrecke(c, a, b), punktStrecke(d, a, b));
}

function streckenSchneiden(a, b, c, d) {
  const rich = (p, q, r) => {
    const v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    return Math.abs(v) < 1e-12 ? 0 : (v > 0 ? 1 : 2);
  };
  return rich(a, b, c) !== rich(a, b, d) && rich(c, d, a) !== rich(c, d, b);
}
