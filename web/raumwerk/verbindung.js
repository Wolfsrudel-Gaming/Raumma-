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
 * Die Geometrie geht von achsparallelen Räumen aus (Drehung 0), dem Normalfall
 * in der Gebäude-Übersicht. Längen in Metern.
 */

import { breite, tiefe } from "../geometrie.js";

/** Gegenüberliegende Seite – die Wand des Nachbarn. */
export function gegenseite(seite) {
  return { rechts: "links", links: "rechts", oben: "unten", unten: "oben" }[seite];
}

function kasten(r) {
  const x0 = Number(r.xM) || 0, y0 = Number(r.yM) || 0;
  return { x0, y0, x1: x0 + breite(r), y1: y0 + tiefe(r) };
}

/**
 * Wo grenzt [nachbar] an [raum]? Gibt `null`, wenn sie sich keine Wand teilen.
 * `seite` ist aus Sicht von [raum]; `cx,cy` ist die Mitte des gemeinsamen
 * Stücks (Weltkoordinaten), `laenge` seine Länge.
 */
export function angrenzung(raum, nachbar, fugeTol = 0.25, minLaenge = 0.6) {
  if (raum.id === nachbar.id || raum.geschoss !== nachbar.geschoss) return null;
  const a = kasten(raum), b = kasten(nachbar);
  const uey = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);   // Überlappung in y
  const uex = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);   // Überlappung in x

  if (Math.abs(a.x1 - b.x0) <= fugeTol && uey >= minLaenge)
    return seite("rechts", a.x1, mitte(a.y0, a.y1, b.y0, b.y1), uey);
  if (Math.abs(a.x0 - b.x1) <= fugeTol && uey >= minLaenge)
    return seite("links", a.x0, mitte(a.y0, a.y1, b.y0, b.y1), uey);
  if (Math.abs(a.y1 - b.y0) <= fugeTol && uex >= minLaenge)
    return seite("unten", mitte(a.x0, a.x1, b.x0, b.x1), a.y1, uex);
  if (Math.abs(a.y0 - b.y1) <= fugeTol && uex >= minLaenge)
    return seite("oben", mitte(a.x0, a.x1, b.x0, b.x1), a.y0, uex);
  return null;

  function seite(s, cx, cy, laenge) { return { seite: s, cx, cy, laenge }; }
  function mitte(a0, a1, b0, b1) { return (Math.max(a0, b0) + Math.min(a1, b1)) / 2; }
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

/** Wandindex und Abstand einer Öffnung auf der Seite [seite] von [raum]. */
function wand(raum, seite, cx, cy, br) {
  const b = breite(raum), t = tiefe(raum);
  const xM = Number(raum.xM) || 0, yM = Number(raum.yM) || 0;
  let index, roh;
  if (seite === "rechts") { index = 1; roh = (cy - yM); }
  else if (seite === "links") { index = 3; roh = t - (cy - yM); }
  else if (seite === "unten") { index = 2; roh = b - (cx - xM); }
  else { index = 0; roh = (cx - xM); }                     // oben
  const laenge = index % 2 === 0 ? b : t;
  const abstand = Math.max(0, Math.min(laenge - br, roh - br / 2));
  return { wandIndex: index, abstandM: Math.round(abstand * 100) / 100 };
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
    { id: `${v.id}-a`, raumId: a.id, ...wand(a, g.seite, g.cx, g.cy, br), ...gemein },
    { id: `${v.id}-b`, raumId: b.id, ...wand(b, gegenseite(g.seite), g.cx, g.cy, br), ...gemein },
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
  return { cx: g.cx, cy: g.cy, breiteM: br, senkrecht: g.seite === "rechts" || g.seite === "links", art: v.art };
}
