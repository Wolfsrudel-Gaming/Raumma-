/*
 * Verbindungen zwischen Räumen – Türen und Durchgänge als **gemeinsame**
 * Öffnung (ein Bezug, nicht zwei getrennte Löcher).
 *
 * Der Kern-README nennt das eine bewusste Lücke: „Eine Tür zwischen zwei Räumen
 * ist heute zwei Öffnungen." Hier wird sie geschlossen – auf Gebäudeebene, wo
 * die Räume ihre Lage haben. Eine `Verbindung` verweist auf zwei Räume; die
 * konkrete Öffnung in jeder Wand wird bei Bedarf abgeleitet, sodass sie in
 * Grundriss und 3D am selben Ort erscheint.
 *
 * Gesucht wird die **echte Wand** jedes Raums: die Umriss-Wand von A, die mit
 * einer Umriss-Wand von B auf einer Linie liegt (Fuge bis 25 cm) und sich mit
 * ihr ausreichend überlappt. So passt das auch für L-Räume, Nischen und schräge
 * Wände – nicht nur für Rechtecke mit vier Wänden. Gedrehte Räume
 * (drehungGrad ≠ 0) bleiben außen vor: Sie gelten als nicht angrenzend.
 * Längen in Metern, Weltkoordinaten = Raumkoordinaten + (xM, yM).
 */

import { ecken, imRaum } from "../geometrie.js";

/** Gegenüberliegende Seite – die Wand des Nachbarn. */
export function gegenseite(seite) {
  return { rechts: "links", links: "rechts", oben: "unten", unten: "oben" }[seite];
}

const PARALLEL_TOL = 0.035;   // ≈ 2° – sin des Winkels zwischen zwei Wänden

/** Gedrehte Räume werden nicht verbunden (die Wandlage wäre geraten). */
function gedreht(r) {
  const d = Number(r.drehungGrad) || 0;
  return Math.abs(((d % 360) + 360) % 360) > 1e-6;
}

/** Wände eines Raums in Weltkoordinaten: Anfang, Richtung, Länge, Innennormale. */
function waendeWelt(r) {
  let p;
  try { p = ecken(r); } catch (_) { return []; }
  if (!Array.isArray(p) || p.length < 3) return [];
  const ox = Number(r.xM) || 0, oy = Number(r.yM) || 0;
  const liste = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const laenge = Math.hypot(dx, dy);
    if (!(laenge > 1e-6) || !isFinite(laenge)) continue;
    const ux = dx / laenge, uy = dy / laenge;
    liste.push({ index: i, ax: a[0] + ox, ay: a[1] + oy, ux, uy, laenge, innen: innenNormale(r, a, ux, uy, laenge) });
  }
  return liste;
}

/**
 * Normale, die ins Rauminnere zeigt – per Punkt-im-Raum-Test knapp neben der
 * Wandmitte. Bei entarteten Umrissen null (dann wird die Seite nicht geprüft).
 */
function innenNormale(r, a, ux, uy, laenge) {
  const mx = a[0] + ux * laenge / 2, my = a[1] + uy * laenge / 2;
  const nx = -uy, ny = ux, d = 0.02;
  try {
    const plus = imRaum(r, mx + nx * d, my + ny * d);
    const minus = imRaum(r, mx - nx * d, my - ny * d);
    if (plus && !minus) return [nx, ny];
    if (minus && !plus) return [-nx, -ny];
  } catch (_) { /* entarteter Umriss */ }
  return null;
}

/**
 * Wo grenzt [nachbar] an [raum]? Gibt `null`, wenn sie sich keine Wand teilen.
 * `seite` ist aus Sicht von [raum] (grobe Himmelsrichtung im Plan); `cx,cy`
 * ist die Mitte des gemeinsamen Stücks (Weltkoordinaten, auf der Wand von
 * [raum]), `laenge` seine Länge. `wandA`/`wandB` sind die Wandindizes in den
 * Umrissen beider Räume, `richtung` die Wandrichtung (Einheitsvektor).
 */
export function angrenzung(raum, nachbar, fugeTol = 0.25, minLaenge = 0.6) {
  if (!raum || !nachbar || raum.id === nachbar.id || raum.geschoss !== nachbar.geschoss) return null;
  if (gedreht(raum) || gedreht(nachbar)) return null;
  const wa = waendeWelt(raum), wb = waendeWelt(nachbar);
  let beste = null;
  for (const a of wa) {
    for (const b of wb) {
      // parallel (gleich- oder gegenläufig)?
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > PARALLEL_TOL) continue;
      // auf einer Linie – beide Enden von b nahe der Linie von a?
      const abst = (px, py) => Math.abs((px - a.ax) * -a.uy + (py - a.ay) * a.ux);
      const bx1 = b.ax + b.ux * b.laenge, by1 = b.ay + b.uy * b.laenge;
      if (abst(b.ax, b.ay) > fugeTol || abst(bx1, by1) > fugeTol) continue;
      // Räume liegen auf verschiedenen Seiten der Wand (nicht ineinander).
      if (a.innen && b.innen && a.innen[0] * b.innen[0] + a.innen[1] * b.innen[1] > 0) continue;
      // Überlappung entlang der Wand von a.
      const t = (px, py) => (px - a.ax) * a.ux + (py - a.ay) * a.uy;
      const tb0 = t(b.ax, b.ay), tb1 = t(bx1, by1);
      const von = Math.max(0, Math.min(tb0, tb1)), bis = Math.min(a.laenge, Math.max(tb0, tb1));
      const laenge = bis - von;
      if (laenge < minLaenge - 1e-9) continue;
      if (!beste || laenge > beste.laenge + 1e-9) beste = { a, b, von, bis, laenge };
    }
  }
  if (!beste) return null;
  const { a, b, von, bis, laenge } = beste;
  const tm = (von + bis) / 2;
  const cx = runde6(a.ax + a.ux * tm), cy = runde6(a.ay + a.uy * tm);
  return {
    seite: seiteAus(a), cx, cy, laenge: runde6(laenge),
    wandA: a.index, wandB: b.index, richtung: [a.ux, a.uy]
  };
}

/** Grobe Seite aus Sicht des Raums: wohin zeigt die Außennormale der Wand? */
function seiteAus(w) {
  // Ohne Innennormale: im Uhrzeigersinn (y nach unten) liegt außen links der Laufrichtung.
  const [ix, iy] = w.innen || [-w.uy, w.ux];
  const ax = -ix, ay = -iy;
  if (Math.abs(ax) >= Math.abs(ay)) return ax > 0 ? "rechts" : "links";
  return ay > 0 ? "unten" : "oben";
}

/** Alle Nachbarräume von [raum] (für die Oberfläche: „Tür einfügen an …"). */
export function nachbarn(raum, andere) {
  const treffer = [];
  for (const o of andere) {
    const g = angrenzung(raum, o);
    if (g) treffer.push({ raum: o, ...g });
  }
  return treffer;
}

/** Abstand ab Wandanfang, damit die Öffnung mittig auf (cx,cy) sitzt. */
function aufWand(raum, wandIndex, cx, cy, br) {
  const w = waendeWelt(raum).find(x => x.index === wandIndex);
  if (!w) return { wandIndex, abstandM: 0 };
  const tm = (cx - w.ax) * w.ux + (cy - w.ay) * w.uy;
  const abstand = Math.max(0, Math.min(w.laenge - br, tm - br / 2));
  return { wandIndex, abstandM: Math.round(abstand * 100) / 100 };
}

/**
 * Die zwei abgeleiteten Öffnungen einer Verbindung – je eine in beiden Räumen,
 * am selben Ort. Leere Liste, wenn die Räume nicht (mehr) aneinandergrenzen.
 */
export function oeffnungen(v, raeume) {
  const a = raeume.find(r => r.id === v.raumA);
  const b = raeume.find(r => r.id === v.raumB);
  if (!a || !b) return [];
  const g = angrenzung(a, b);
  if (!g) return [];
  const br = Math.min(Number(v.breiteM) || 0.9, g.laenge - 0.05);
  const hoehe = v.art === "TUER" ? 2.01 : 2.10;
  const gemein = { art: v.art || "DURCHGANG", breiteM: br, hoeheM: hoehe, bruestungM: 0, verbindung: v.id };
  return [
    { id: `${v.id}-a`, raumId: a.id, ...aufWand(a, g.wandA, g.cx, g.cy, br), ...gemein },
    { id: `${v.id}-b`, raumId: b.id, ...aufWand(b, g.wandB, g.cx, g.cy, br), ...gemein },
  ];
}

/** Markierung fürs Gebäude-Bild: Mitte und Ausrichtung der Verbindung. */
export function marke(v, raeume) {
  const a = raeume.find(r => r.id === v.raumA);
  const b = raeume.find(r => r.id === v.raumB);
  if (!a || !b) return null;
  const g = angrenzung(a, b);
  if (!g) return null;
  const br = Math.min(Number(v.breiteM) || 0.9, g.laenge - 0.05);
  return {
    cx: g.cx, cy: g.cy, breiteM: br, art: v.art, richtung: g.richtung,
    senkrecht: Math.abs(g.richtung[1]) > Math.abs(g.richtung[0])
  };
}

const runde6 = v => Math.round(v * 1e6) / 1e6;
