/*
 * Geometrie im Browser – Spiegel von `Geometrie.kt`.
 *
 * Warum doppelt? Weil der Editor sofort reagieren muss, während noch getippt
 * wird, und weil der Plan auch ohne Netz stimmen soll. Ein Rundruf zum Server
 * für jede Ziffer wäre weder schnell noch offline-tauglich.
 *
 * **Regel bei Änderungen:** Was hier gerechnet wird, wird auch in
 * `Geometrie.kt` gerechnet – und umgekehrt. Die Kotlin-Tests sind die
 * verbindliche Beschreibung; diese Datei folgt ihnen. Wer eine Formel ändert,
 * ändert beide Stellen und passt den Test an.
 *
 * Koordinaten: Ursprung links oben, x nach rechts, y nach hinten, Meter.
 * Ein Umriss ist ein Array von [x, y]-Paaren im Uhrzeigersinn.
 */

/** Liest den frei erfassten Umriss. Nachsichtig: bei Unsinn kommt null. */
export function umrissLesen(text) {
  if (!text) return null;
  try {
    const p = JSON.parse(text)
      .filter(q => q && q.length >= 2)
      .map(q => [Number(q[0]), Number(q[1])]);
    return p.length >= 3 && p.every(q => isFinite(q[0]) && isFinite(q[1])) ? p : null;
  } catch (_) {
    return null;
  }
}

export function umrissSchreiben(punkte) {
  const r = v => Math.round(v * 100) / 100;
  return JSON.stringify(punkte.map(p => [r(p[0]), r(p[1])]));
}

/** Eckpunkte im Uhrzeigersinn – aus dem Umriss oder aus Breite/Tiefe/Schräge. */
export function ecken(raum) {
  const frei = umrissLesen(raum.umriss ?? raum.outline);
  if (frei) return frei;
  const hinten = Number(raum.breiteM ?? raum.widthM) || 0;
  const vorneRoh = raum.breiteVorneM ?? raum.frontWidthM;
  const vorne = (vorneRoh === null || vorneRoh === undefined) ? hinten : Number(vorneRoh);
  const tiefe = Number(raum.tiefeM ?? raum.lengthM) || 0;
  const w = Math.max(hinten, vorne);
  const schraege = raum.schraege ?? raum.skew;
  const spanne = len => schraege === "LINKS" ? [w - len, w]
    : schraege === "BEIDSEITIG" ? [(w - len) / 2, (w + len) / 2]
      : [0, len];
  const [vx0, vx1] = spanne(vorne), [hx0, hx1] = spanne(hinten);
  return [[vx0, 0], [vx1, 0], [hx1, tiefe], [hx0, tiefe]];
}

/** Breite des umschließenden Rechtecks. */
export function breite(raum) {
  const frei = umrissLesen(raum.umriss ?? raum.outline);
  if (frei) return Math.max(...frei.map(p => p[0]));
  const hinten = Number(raum.breiteM ?? raum.widthM) || 0;
  const vorneRoh = raum.breiteVorneM ?? raum.frontWidthM;
  const vorne = (vorneRoh === null || vorneRoh === undefined) ? hinten : Number(vorneRoh);
  return Math.max(hinten, vorne);
}

/** Tiefe des umschließenden Rechtecks. */
export function tiefe(raum) {
  const frei = umrissLesen(raum.umriss ?? raum.outline);
  return frei ? Math.max(...frei.map(p => p[1])) : (Number(raum.tiefeM ?? raum.lengthM) || 0);
}

/**
 * Grundfläche in m².
 * Freier Umriss: Gaußsche Trapezformel. Kurzform: Mittellinie × Tiefe.
 * Breite × Tiefe wäre bei einer Nische zu viel.
 */
export function flaeche(raum) {
  const frei = umrissLesen(raum.umriss ?? raum.outline);
  if (frei) return flaechePunkte(frei);
  const hinten = Number(raum.breiteM ?? raum.widthM) || 0;
  const vorneRoh = raum.breiteVorneM ?? raum.frontWidthM;
  const vorne = (vorneRoh === null || vorneRoh === undefined) ? hinten : Number(vorneRoh);
  return (hinten + vorne) / 2 * (Number(raum.tiefeM ?? raum.lengthM) || 0);
}

export function flaechePunkte(p) {
  let summe = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    summe += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(summe) / 2;
}

/** Länge jeder Wand, in der Reihenfolge der Ecken. */
export function wandLaengen(raum) {
  const p = ecken(raum);
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}

/** Nächstgelegene Wand zu einem Punkt (Meter im Raum). */
export function naechsteWand(raum, mx, my) {
  const p = ecken(raum);
  let beste = { index: 0, abstand: 0, entfernung: Infinity };
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / l2));
    const px = a[0] + dx * t, py = a[1] + dy * t;
    const d = Math.hypot(mx - px, my - py);
    if (d < beste.entfernung) beste = { index: i, abstand: t * Math.sqrt(l2), entfernung: d };
  }
  return beste;
}

/** Liegt ein Punkt im Raum? Gilt für jedes einfache Vieleck. */
export function imRaum(raum, x, y) {
  const p = ecken(raum);
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) &&
      x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) drin = !drin;
  }
  return drin;
}

/**
 * Wandstücke nach Abzug der Öffnungen – volle Wand daneben, Brüstung darunter,
 * Sturz darüber. Ohne diese Zerlegung ist eine Tür nur ein aufgemaltes Symbol.
 */
export function wandStuecke(raum, wandIndex, oeffnungen) {
  const laenge = wandLaengen(raum)[wandIndex] || 0;
  const hoehe = Number(raum.hoeheM ?? raum.heightM) || 0;
  if (laenge <= 0 || hoehe <= 0) return [];
  const loecher = (oeffnungen || [])
    .filter(o => (o.wandIndex ?? o.wallIndex) === wandIndex)
    .map(o => {
      const von = Math.max(0, Math.min(laenge, Number(o.abstandM ?? o.offsetM)));
      const bis = Math.max(0, Math.min(laenge,
        Number(o.abstandM ?? o.offsetM) + Number(o.breiteM ?? o.widthM)));
      return { von, bis, o };
    })
    .filter(l => l.bis > l.von)
    .sort((a, b) => a.von - b.von);

  const stuecke = [];
  let t = 0;
  for (const l of loecher) {
    if (l.von > t) stuecke.push({ von: t, bis: l.von, unten: 0, oben: hoehe });
    const bruestung = Math.min(Number(l.o.bruestungM ?? l.o.sillM) || 0, hoehe);
    const sturz = Math.min(bruestung + (Number(l.o.hoeheM ?? l.o.heightM) || 0), hoehe);
    if (bruestung > 0) stuecke.push({ von: l.von, bis: l.bis, unten: 0, oben: bruestung });
    if (sturz < hoehe) stuecke.push({ von: l.von, bis: l.bis, unten: sturz, oben: hoehe });
    t = Math.max(t, l.bis);
  }
  if (t < laenge) stuecke.push({ von: t, bis: laenge, unten: 0, oben: hoehe });
  return stuecke;
}

/**
 * Lage und Drehung eines Einbaus im Raum.
 *
 * An der Wand: auf der Wandlinie, senkrecht dazu um `abruecken` versetzt.
 * Senkrecht, nicht Richtung Raummitte – sonst wandert das Gerät auch an der
 * Wand entlang und sitzt nicht mehr dort, wo es gemessen wurde.
 */
export function lageImRaum(raum, einbau, abruecken = 0.04) {
  const befestigung = einbau.befestigung ?? einbau.mount;
  const index = einbau.wandIndex ?? einbau.wallIndex;
  const e = ecken(raum);
  if (befestigung === "WAND" && index != null && e.length) {
    const a = e[index % e.length], b = e[(index + 1) % e.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(len, Number(einbau.abstandM ?? einbau.offsetM) || 0));
    const px = a[0] + dx / len * t, py = a[1] + dy / len * t;
    const mx = e.reduce((s, p) => s + p[0], 0) / e.length;
    const my = e.reduce((s, p) => s + p[1], 0) / e.length;
    let nx = -dy / len, ny = dx / len;
    if ((mx - px) * nx + (my - py) * ny < 0) { nx = -nx; ny = -ny; }
    return {
      x: px + nx * abruecken, y: py + ny * abruecken,
      winkel: Math.atan2(dy, dx) * 180 / Math.PI
    };
  }
  return {
    x: Number(einbau.relX) * breite(raum),
    y: Number(einbau.relY) * tiefe(raum),
    winkel: 0
  };
}

/* ------------------------------------------------------------ Polygonzug */

/**
 * Wandliste → Umriss. Start (0,0), Blick nach rechts; nach jeder Wand um
 * ihren Winkel drehen (positiv = rechts).
 *
 * `restluecke` ist die Qualitätsaussage des Aufmaßes: Schließt sich der Zug
 * nicht, steckt ein Messfehler drin.
 */
export function zug(waende) {
  let x = 0, y = 0, richtung = 0;
  const roh = [[0, 0]];
  for (const w of waende) {
    const bogen = richtung * Math.PI / 180;
    x += w.laenge * Math.cos(bogen);
    y += w.laenge * Math.sin(bogen);
    roh.push([x, y]);
    richtung += w.drehung;
  }
  const letzte = roh[roh.length - 1];
  const restluecke = Math.hypot(letzte[0] - roh[0][0], letzte[1] - roh[0][1]);
  const geschlossen = restluecke < 0.02;
  return {
    punkte: normieren(geschlossen ? roh.slice(0, -1) : roh),
    restluecke,
    geschlossen,
    schlusswandErgaenzt: !geschlossen
  };
}

/** Umriss → Wandliste, um einen vorhandenen Raum wandweise zu bearbeiten. */
export function waende(punkte) {
  const n = punkte.length;
  const liste = [];
  for (let i = 0; i < n; i++) {
    const a = punkte[i], b = punkte[(i + 1) % n], c = punkte[(i + 2) % n];
    const laenge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let drehung = (Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]))
      * 180 / Math.PI;
    while (drehung > 180) drehung -= 360;
    while (drehung <= -180) drehung += 360;
    liste.push({
      laenge: Math.round(laenge * 100) / 100,
      drehung: Math.round(drehung * 10) / 10
    });
  }
  return liste;
}

/** Auf den Nullpunkt schieben und auf Zentimeter runden. */
export function normieren(punkte) {
  if (!punkte.length) return punkte;
  const minX = Math.min(...punkte.map(p => p[0]));
  const minY = Math.min(...punkte.map(p => p[1]));
  return punkte.map(p => [
    Math.round((p[0] - minX) * 100) / 100,
    Math.round((p[1] - minY) * 100) / 100
  ]);
}

/** Hinweise statt Ausnahmen – der Mensch entscheidet, was ein Fehler ist. */
export function pruefen(punkte) {
  const hinweise = [];
  if (punkte.length < 3) return ["Weniger als drei Ecken – daraus wird kein Raum."];
  punkte.forEach((a, i) => {
    const b = punkte[(i + 1) % punkte.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.05) hinweise.push(`Wand ${i + 1} ist nur ${Math.round(l * 100)} cm lang – Tippfehler?`);
  });
  if (flaechePunkte(punkte) < 0.5)
    hinweise.push("Fläche unter 0,5 m² – der Zug ist vermutlich in sich verdreht.");
  if (schneidetSichSelbst(punkte))
    hinweise.push("Die Wände kreuzen sich – meist ist eine Drehung falsch herum eingetragen.");
  return hinweise;
}

export function schneidetSichSelbst(p) {
  const n = p.length;
  const rich = (a, b, c) => {
    const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    return Math.abs(v) < 1e-9 ? 0 : (v > 0 ? 1 : 2);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      if (rich(a, b, c) !== rich(a, b, d) && rich(c, d, a) !== rich(c, d, b)) return true;
    }
  }
  return false;
}
