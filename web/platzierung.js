/*
 * Platzierung im Browser – Spiegel von `Platzierung.kt`.
 *
 * Räume im Gebäude anordnen, ohne mit dem Finger schieben zu müssen: an einen
 * Nachbarn anlegen („der Lagerraum liegt hinter der Küche"), beim Ziehen an
 * Nachbarkanten einrasten, Geschosse stapeln. Kotlin ist verbindlich.
 *
 * Räume tragen deutsche Feldnamen (xM, yM, geschoss …), Längen in Metern.
 */

import { breite, tiefe } from "./geometrie.js";

export const Seite = { LINKS: "LINKS", RECHTS: "RECHTS", DAVOR: "DAVOR", DAHINTER: "DAHINTER" };
export const Buendig = { ANFANG: "ANFANG", MITTE: "MITTE", ENDE: "ENDE" };

const r2 = v => Math.round(v * 100) / 100;

/** Setzt [raum] an [nachbar] an und gibt die neue Lage {xM,yM} zurück. */
export function anlegen(raum, nachbar, seite, buendig = Buendig.ANFANG, fugeM = 0) {
  const rb = breite(raum), rt = tiefe(raum);
  const nb = breite(nachbar), nt = tiefe(nachbar);
  const nx = Number(nachbar.xM) || 0, ny = Number(nachbar.yM) || 0;
  const fuge = Math.max(0, Math.min(5, fugeM));

  const laengs = (eigen, fremd, start) =>
    buendig === Buendig.MITTE ? start + (fremd - eigen) / 2
      : buendig === Buendig.ENDE ? start + fremd - eigen
        : start;

  let x, y;
  switch (seite) {
    case Seite.RECHTS: x = nx + nb + fuge; y = laengs(rt, nt, ny); break;
    case Seite.LINKS: x = nx - rb - fuge; y = laengs(rt, nt, ny); break;
    case Seite.DAHINTER: x = laengs(rb, nb, nx); y = ny + nt + fuge; break;
    default: x = laengs(rb, nb, nx); y = ny - rt - fuge; break;   // DAVOR
  }
  return { xM: r2(Math.max(0, x)), yM: r2(Math.max(0, y)) };
}

/** Rastet eine gezogene Lage an den Kanten der übrigen Räume ein → [x,y]. */
export function einrasten(raum, xM, yM, andere, rasterM = 0.25, fangM = 0.35) {
  let x = Math.round(xM / rasterM) * rasterM;
  let y = Math.round(yM / rasterM) * rasterM;
  const b = breite(raum), t = tiefe(raum);
  for (const o of andere) {
    if (o.id === raum.id || o.geschoss !== raum.geschoss) continue;
    const ox = Number(o.xM) || 0, oy = Number(o.yM) || 0;
    const ob = breite(o), ot = tiefe(o);
    for (const [eigen, fremd] of [[0, 0], [0, ob], [b, 0], [b, ob]]) {
      const kandidat = ox + fremd - eigen;
      if (Math.abs(xM - kandidat) < fangM) x = kandidat;
    }
    for (const [eigen, fremd] of [[0, 0], [0, ot], [t, 0], [t, ot]]) {
      const kandidat = oy + fremd - eigen;
      if (Math.abs(yM - kandidat) < fangM) y = kandidat;
    }
  }
  return [Math.max(0, r2(x)), Math.max(0, r2(y))];
}

/** Höhenlage der Geschosse: jedes beginnt über dem höchsten Raum darunter. */
export function geschossBasis(raeume, deckeM = 0.30) {
  if (!raeume.length) return {};
  const hoeheJe = {};
  for (const r of raeume) {
    const h = Number(r.hoeheM) || 0;
    hoeheJe[r.geschoss] = Math.max(hoeheJe[r.geschoss] ?? 0, h);
  }
  const basis = {};
  let oben = 0;
  Object.keys(hoeheJe).map(Number).filter(g => g >= 0).sort((a, b) => a - b).forEach(g => {
    basis[g] = oben; oben += hoeheJe[g] + deckeM;
  });
  let unten = 0;
  Object.keys(hoeheJe).map(Number).filter(g => g < 0).sort((a, b) => b - a).forEach(g => {
    unten -= hoeheJe[g] + deckeM; basis[g] = unten;
  });
  return basis;
}
