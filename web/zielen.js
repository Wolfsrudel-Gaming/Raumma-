/*
 * Zielen – Raumaufnahme mit dem Handy, ohne Referenzwürfel und ohne ARCore.
 *
 * Das Prinzip ist alt und robust (Neigungsmesser-Aufmaß): Man steht im Raum,
 * hält das Handy auf bekannter Höhe h und zielt mit dem Fadenkreuz auf einen
 * Punkt am Boden – eine Raumecke, einen Türanschlag. Aus der Neigung β der
 * Kamera unter den Horizont folgt die waagerechte Entfernung
 *
 *     d = h / tan β
 *
 * und aus der Blickrichtung (Gier) die Richtung. Polar → kartesisch, und die
 * Ecken ergeben den Grundriss. Ist der Grundriss bekannt, trifft jeder weitere
 * Zielstrahl eine Wand: Steckdose, Schalter, Fensterecke, Türsturz bekommen so
 * Wand, Abstand und Höhe. Ein Strahl nach oben auf die Deckenkante liefert die
 * Raumhöhe.
 *
 * Warum das ohne Würfel geht: Alle Ergebnisse sind **linear in h**. Die Form
 * stimmt immer, nur der Maßstab hängt an h. Ein einziges bekanntes Maß – eine
 * Wand mit dem Bandmaß, die Türhöhe – legt h fest und skaliert alles mit
 * (`skalaAusLaengen`, `hoeheAusSenkrechte`).
 *
 * Gebraucht wird nur die Lage des Geräts: im Browser `deviceorientation`
 * (Chrome liefert dort eine relative, magnetfeldfreie Lage), in der
 * Android-App der Spiel-Rotationsvektor (Gyroskop + Beschleunigung, ohne
 * Magnetometer – Kompasse sind neben Stromleitungen und Stahl unbrauchbar).
 *
 * Koordinaten hier: Welt x = Ost, y = Nord, z = oben (wie DeviceOrientation
 * und Android). Erst `raumAusEcken` übersetzt in das Raumsystem des Kerns
 * (x rechts, y nach hinten/unten, Ecken im Uhrzeigersinn).
 *
 * Reine Funktionen, kein DOM – in Node testbar (web/tests/zielen.test.mjs).
 */

export const GRAD = Math.PI / 180;

/** Kleinste Neigung unter den Horizont, ab der ein Bodenpunkt noch Sinn ergibt. */
export const MIN_NEIGUNG_GRAD = 4;

/**
 * Sinnvoller Bereich für einen gezielten Bodenpunkt: flacher als 12° wird die
 * Entfernung (> ~6 m) zu ungenau; steiler als 75° steht man fast auf der
 * Ecke – dann ist unklar, ob die Linse vor oder hinter ihr sitzt. Die
 * Oberfläche lehnt Schüsse außerhalb ab („näher ran“ / „Schritt zurück“).
 */
export const ZIEL_MIN_GRAD = 12, ZIEL_MAX_GRAD = 75;

/** Liegt die Neigung eines Bodenschusses im sinnvollen Bereich? → "ok" | "flach" | "steil". */
export function zielBereich(v, p = {}) {
  const th = neigungGrad(v) - (p.delta || 0) / GRAD;
  return th < ZIEL_MIN_GRAD ? "flach" : th > ZIEL_MAX_GRAD ? "steil" : "ok";
}

// ------------------------------------------------------------ Blickrichtung

/**
 * Blickrichtung der Rückkamera aus DeviceOrientation-Winkeln (Grad).
 *
 * W3C: R = Rz(α)·Rx(β)·Ry(γ) bildet Gerät → Welt ab. Die Rückkamera schaut
 * entlang −z des Geräts, also ist die Blickrichtung −R·ez:
 *
 *     v = −( cα·sγ + sα·sβ·cγ,  sα·sγ − cα·sβ·cγ,  cβ·cγ )
 *
 * Probe: Handy hochkant, Bildschirm zum Nutzer (β = 90°) → v = (0, 1, 0),
 * also waagerecht nach „Nord“ der Lage. Kippt die Oberkante vom Nutzer weg
 * (β < 90°), schaut die Kamera nach unten.
 */
export function blickAusEuler(alpha, beta, gamma) {
  const a = (Number(alpha) || 0) * GRAD, b = (Number(beta) || 0) * GRAD, g = (Number(gamma) || 0) * GRAD;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return einheit([
    -(ca * sg + sa * sb * cg),
    -(sa * sg - ca * sb * cg),
    -(cb * cg)
  ]);
}

/**
 * Blickrichtung der Rückkamera aus einem Rotations-Quaternion [w, x, y, z]
 * (Android: Rotationsvektor bzw. Spiel-Rotationsvektor, Gerät → Welt).
 * Dritte Spalte der Drehmatrix, negiert.
 */
export function blickAusQuaternion(q) {
  const [w, x, y, z] = q.map(Number);
  return einheit([
    -2 * (x * z + w * y),
    -2 * (y * z - w * x),
    -(1 - 2 * (x * x + y * y))
  ]);
}

/** Neigung unter den Horizont in Grad (positiv = Kamera schaut nach unten). */
export function neigungGrad(v) {
  return Math.asin(Math.max(-1, Math.min(1, -v[2]))) / GRAD;
}

/** Richtung in Grad, 0 = Lage-Nord, im Uhrzeigersinn (wie ein Kompass). */
export function gierGrad(v) {
  const g = Math.atan2(v[0], v[1]) / GRAD;
  return (g + 360) % 360;
}

/**
 * Mehrere Blickrichtungen zu einer mitteln. Wer beim Antippen wackelt,
 * verfälscht sonst genau den Punkt, auf den es ankommt. `streuungGrad` ist die
 * mittlere Abweichung der Einzelwerte – die Oberfläche bittet darüber um
 * ruhiges Halten.
 */
export function mitteln(vs) {
  const liste = (vs || []).filter(v => v && v.every(Number.isFinite));
  if (!liste.length) return null;
  const s = [0, 0, 0];
  for (const v of liste) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  const m = einheit(s);
  let summe = 0;
  for (const v of liste) summe += Math.acos(Math.max(-1, Math.min(1, v[0] * m[0] + v[1] * m[1] + v[2] * m[2])));
  return { v: m, streuungGrad: summe / liste.length / GRAD, anzahl: liste.length };
}

// ------------------------------------------------------------- Treffpunkte

/**
 * Bodenpunkt, auf den die Kamera zielt, bei Kamerahöhe `h` über dem Boden.
 * Gibt `null`, wenn die Kamera nicht deutlich genug nach unten schaut – flache
 * Strahlen werden beliebig ungenau.
 */
export function bodenpunkt(v, h, stand = [0, 0]) {
  if (neigungGrad(v) < MIN_NEIGUNG_GRAD) return null;
  const t = h / -v[2];
  return { x: stand[0] + t * v[0], y: stand[1] + t * v[1], d: t * Math.hypot(v[0], v[1]) };
}

/** Punkt an der Decke (Raumhöhe `H` über dem Boden), oder `null`. */
export function deckenpunkt(v, h, H, stand = [0, 0]) {
  if (v[2] <= Math.sin(MIN_NEIGUNG_GRAD * GRAD) || H <= h) return null;
  const t = (H - h) / v[2];
  return { x: stand[0] + t * v[0], y: stand[1] + t * v[1], d: t * Math.hypot(v[0], v[1]) };
}

/**
 * Schnitt des Zielstrahls mit der senkrechten Ebene der Wand a→b (Weltpunkte).
 * Liefert den Abstand ab `a` entlang der Wand und die Höhe über dem Boden –
 * genau die Größen, mit denen der Kern Öffnungen und Einbauten verortet.
 * `null`, wenn der Strahl die Wand nicht (vorwärts) trifft.
 */
export function wandpunkt(v, h, a, b, stand = [0, 0]) {
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const laenge = Math.hypot(ux, uy);
  if (laenge < 1e-9) return null;
  const nx = -uy / laenge, ny = ux / laenge;
  const nenner = nx * v[0] + ny * v[1];
  if (Math.abs(nenner) < 1e-9) return null;
  const t = (nx * (a[0] - stand[0]) + ny * (a[1] - stand[1])) / nenner;
  if (!(t > 0)) return null;
  const x = stand[0] + t * v[0], y = stand[1] + t * v[1];
  const abstand = ((x - a[0]) * ux + (y - a[1]) * uy) / laenge;
  return { x, y, abstand, hoehe: h + t * v[2], t, laenge };
}

/**
 * Welche Wand trifft der Strahl zuerst? Durchsucht ein geschlossenes Vieleck
 * (Weltpunkte) und gibt den nächsten Treffer innerhalb der Wandlänge zurück,
 * samt `index` der Wand.
 */
export function ersteWand(v, h, ecken, stand = [0, 0]) {
  let beste = null;
  for (let i = 0; i < ecken.length; i++) {
    const w = wandpunkt(v, h, ecken[i], ecken[(i + 1) % ecken.length], stand);
    if (!w || w.abstand < -0.02 || w.abstand > w.laenge + 0.02) continue;
    if (!beste || w.t < beste.t) beste = { ...w, index: i };
  }
  return beste;
}

// ------------------------------------------------------------- Kalibrierung

/**
 * Kamerahöhe aus einer bekannten Senkrechten – z. B. einer Tür: unten auf den
 * Fußpunkt der Zarge zielen (vUnten), oben auf den Sturz derselben Zarge
 * (vOben). Mit bekannter Höhe H der Senkrechten gilt
 *
 *     H = h · (1 + tan γ / tan β)   ⇒   h = H / (1 + tan γ / tan β)
 *
 * (β = Neigung nach unten zum Fußpunkt, γ = Neigung nach oben zum Kopf; ein
 * Kopf unterhalb der Kamera ergibt negatives γ, die Formel bleibt gültig).
 */
export function hoeheAusSenkrechte(vUnten, vOben, hoeheM) {
  const tb = Math.tan(neigungGrad(vUnten) * GRAD);
  const tg = Math.tan(-neigungGrad(vOben) * GRAD);
  if (!(tb > 0)) return null;
  const f = 1 + tg / tb;
  return f > 0.05 ? hoeheM / f : null;
}

/**
 * Maßstab aus bekannten Längen. `paare` = [{ ist, soll }]: `ist` ist die bei
 * der angenommenen Höhe gerechnete Länge, `soll` das Bandmaß. Kleinste
 * Quadrate: k = Σ ist·soll / Σ ist². Die neue Kamerahöhe ist h·k – und weil
 * alles linear in h ist, skaliert jede Ecke, jede Höhe mit.
 */
export function skalaAusLaengen(paare) {
  let z = 0, n = 0;
  for (const p of paare || []) {
    const ist = Number(p.ist), soll = Number(p.soll);
    if (!(ist > 0) || !(soll > 0)) continue;
    z += ist * soll; n += ist * ist;
  }
  return n > 0 ? z / n : null;
}

/**
 * Ehrliche Fehlerangabe für einen Bodenpunkt (Konzept §7: jede Zahl mit ihrer
 * Genauigkeit). Ein Winkelfehler σ wirkt radial mit h/sin²β und seitlich mit d.
 * Gibt die Summe beider als 1σ-Radius in Metern zurück.
 */
export function unsicherheitBoden(v, h, sigmaGrad = 0.4) {
  const b = neigungGrad(v) * GRAD;
  if (b <= 0) return Infinity;
  const s = sigmaGrad * GRAD;
  const radial = h / (Math.sin(b) ** 2) * s;
  const seitlich = (h / Math.tan(b)) * s;
  return Math.hypot(radial, seitlich);
}

// ------------------------------------------------- Kameramodell (Haltung)

/**
 * Wo die Kamera beim Zielen wirklich sitzt – das einfache Modell oben nimmt
 * an, sie sitze genau auf der Drehachse. Tatsächlich dreht man sich um die
 * eigene Körperachse (Standpunkt S), das Handy ist dabei r ≈ 20–45 cm vor der
 * Achse, und die Linse sitzt L über dem Drehpunkt der Hand (bzw. des
 * Stativkopfs). Kippt das Handy um θ nach unten, wandert die Linse um L·sinθ
 * nach vorn und L·(1−cosθ) nach unten:
 *
 *     a = r + L·sinθ'      z = h + L·cosθ'      ρ_Boden = a + z·cot θ'
 *
 * θ' = θ − δ ist die um den festen Neigungsfehler δ des Geräts bereinigte
 * Neigung (Beschleunigungssensor, leicht schräges Kameramodul), ψ' = ψ − ω·(t−t0)
 * die um das langsame Weglaufen ω der Gier bereinigte Richtung.
 *
 * Ohne diese Terme liegen gezielte Ecken um r zu nah am Standpunkt – in der
 * Simulation 36–47 cm Wandfehler ohne Bandmaß. Mit ihnen (h, r, δ geschätzt,
 * siehe raumaufnahme.js) bleiben mit einem Bandmaß ~2–3 cm.
 *
 * Parameter p = { h, r, L, delta (rad), omega (rad/ms), t0 (ms), stand: [x, y] }.
 * Mit r = L = δ = ω = 0 ergeben die Funktionen exakt das einfache Modell.
 */
export const HALTUNG = {
  /** Handy vor der Brust, man dreht sich auf der Stelle. */
  hand: { r: 0.30, sigR: 0.10, L: 0.08, sigH: 0.08 },
  /** Handy-Halter auf dem (Kreuzlinienlaser-)Stativ: kein Arm, Höhe gemessen. */
  stativ: { r: 0.0, sigR: 0.01, L: 0.10, sigH: 0.005 }
};

/** Blick nach Abzug von Neigungsfehler und Gier-Drift: { th (rad, unten +), psi, v }. */
export function korrigiert(v, p = {}, t) {
  const th = Math.asin(Math.max(-1, Math.min(1, -v[2]))) - (p.delta || 0);
  const dt = p.omega ? (Number(t ?? p.t0 ?? 0) - Number(p.t0 || 0)) : 0;
  const psi = Math.atan2(v[0], v[1]) - (p.omega || 0) * dt;
  return { th, psi, v: [Math.sin(psi) * Math.cos(th), Math.cos(psi) * Math.cos(th), -Math.sin(th)] };
}

/** Lage der Linse: a vor der Achse, Höhe z, Richtung u, Ursprung o = [x, y, z]. */
export function kamera(v, p, t) {
  const k = korrigiert(v, p, t);
  const L = p.L || 0;
  const a = (p.r || 0) + L * Math.sin(k.th);
  const z = p.h + L * Math.cos(k.th);
  const u = [Math.sin(k.psi), Math.cos(k.psi)];
  const s = p.stand || [0, 0];
  return { a, z, th: k.th, psi: k.psi, u, v: k.v, o: [s[0] + a * u[0], s[1] + a * u[1], z] };
}

/** Bodenpunkt im Kameramodell, oder `null` bei zu flachem Strahl. d = Abstand zur Achse. */
export function bodenpunktM(v, p, t) {
  const k = kamera(v, p, t);
  if (k.th < MIN_NEIGUNG_GRAD * GRAD) return null;
  const rho = k.a + k.z / Math.tan(k.th);
  const s = p.stand || [0, 0];
  return { x: s[0] + rho * k.u[0], y: s[1] + rho * k.u[1], d: rho };
}

/** Deckenpunkt (Höhe H über dem Boden) im Kameramodell, oder `null`. */
export function deckenpunktM(v, p, H, t) {
  const k = kamera(v, p, t);
  const g = -k.th;
  if (g < MIN_NEIGUNG_GRAD * GRAD || !(H > k.z)) return null;
  const rho = k.a + (H - k.z) / Math.tan(g);
  const s = p.stand || [0, 0];
  return { x: s[0] + rho * k.u[0], y: s[1] + rho * k.u[1], d: rho };
}

/** Schnitt mit der Wandebene a→b – der Strahl beginnt an der Linse, nicht an der Achse. */
export function wandpunktM(v, p, a, b, t) {
  const k = kamera(v, p, t);
  return wandpunkt(k.v, k.z, a, b, [k.o[0], k.o[1]]);
}

/** Erste getroffene Wand eines Vielecks im Kameramodell (wie `ersteWand`). */
export function ersteWandM(v, p, ecken, t) {
  let beste = null;
  for (let i = 0; i < ecken.length; i++) {
    const w = wandpunktM(v, p, ecken[i], ecken[(i + 1) % ecken.length], t);
    if (!w || w.abstand < -0.02 || w.abstand > w.laenge + 0.02) continue;
    if (!beste || w.t < beste.t) beste = { ...w, index: i };
  }
  return beste;
}

/**
 * Höhe des oberen Punkts einer senkrechten Kante, deren Fuß auf dem Boden
 * angezielt wurde (Raumecke → Deckenkante, Türzarge → Sturz).
 */
export function kantenhoeheM(vUnten, vOben, p, tUnten, tOben) {
  const u = bodenpunktM(vUnten, p, tUnten);
  if (!u) return null;
  const k = kamera(vOben, p, tOben);
  return k.z + (u.d - k.a) * Math.tan(-k.th);
}

/**
 * Neigungsfehler δ des Geräts aus der Wende-Kalibrierung: dasselbe Ziel
 * einmal normal und einmal mit dem Handy um 180° um die Kameraachse gedreht
 * (auf dem Kopf) anzielen. Der Fehler wechselt dabei das Vorzeichen, das Ziel
 * nicht: δ = (θ₁ − θ₂)/2. Ergebnis in Grad.
 *
 * Die Formel setzt voraus, dass die Linse beim Umdrehen an ihrem Platz bleibt.
 * Wandert sie um e vom Drehpunkt weg (Linse 2e höher oder tiefer), verfälscht
 * das δ um ≈ e/D bei Zielentfernung D: 1 cm auf 2 m ≈ 0,3°, auf 10 m ≈ 0,06°.
 * Deshalb: fernes Ziel (≥ 10 m, durchs Fenster, den Flur hinunter), Handykante
 * an einer festen Kante anlegen, zwei Wendepaare vergleichen.
 */
export function neigungsfehlerGrad(vNormal, vGewendet) {
  return (neigungGrad(vNormal) - neigungGrad(vGewendet)) / 2;
}

/**
 * Gier-Drift aus dem Schlussschuss: am Ende noch einmal auf die erste Ecke
 * zielen. ω = (ψ_Schluss − ψ_erste) / (t_Schluss − t_erste) in rad/ms.
 */
export function gierDrift(vErste, tErste, vSchluss, tSchluss) {
  const dt = Number(tSchluss) - Number(tErste);
  if (!(dt > 0)) return 0;
  let d = Math.atan2(vSchluss[0], vSchluss[1]) - Math.atan2(vErste[0], vErste[1]);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d / dt;
}

// ------------------------------------------------------- Welt → Raumsystem

/**
 * Aus gezielten Ecken (Welt, in Tipp-Reihenfolge) wird ein Raum im System des
 * Kerns: x = Ost, y = −Nord (y zeigt nach unten wie im Grundriss), gedreht so,
 * dass Wand 1 waagerecht nach rechts läuft, im Uhrzeigersinn, auf (0,0)
 * geschoben.
 *
 * Wer gegen den Uhrzeigersinn getippt hat, bekommt die Reihenfolge umgedreht –
 * `umgekehrt` sagt das, damit nachfolgende Wandbezüge umgerechnet werden
 * können. `abbildung(p)` überführt jeden weiteren Weltpunkt (z. B. eine
 * Steckdose) ins selbe Raumsystem.
 */
export function raumAusEcken(eckenWelt) {
  if (!eckenWelt || eckenWelt.length < 3) return null;
  let p = eckenWelt.map(q => [q[0], -q[1]]);
  // Uhrzeigersinn im y-unten-System heißt: Shoelace-Summe positiv.
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  const umgekehrt = s < 0;
  const reihenfolge = p.map((_, i) => i);
  if (umgekehrt) {
    // Ecke 0 bleibt Ecke 0, der Rest läuft rückwärts.
    p = [p[0], ...p.slice(1).reverse()];
    reihenfolge.splice(0, reihenfolge.length, 0, ...reihenfolge.slice(1).reverse());
  }
  const phi = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
  const c = Math.cos(-phi), si = Math.sin(-phi);
  const drehe = q => [q[0] * c - q[1] * si, q[0] * si + q[1] * c];
  const gedreht = p.map(drehe);
  const minX = Math.min(...gedreht.map(q => q[0])), minY = Math.min(...gedreht.map(q => q[1]));
  const abbildung = welt => {
    const q = drehe([welt[0], -welt[1]]);
    return [q[0] - minX, q[1] - minY];
  };
  return {
    punkte: gedreht.map(q => [q[0] - minX, q[1] - minY]),
    umgekehrt,
    reihenfolge,          // reihenfolge[i] = Tipp-Index der Raum-Ecke i
    drehungRad: -phi,
    abbildung
  };
}

/**
 * Wandindex nach `raumAusEcken` aus dem Wandindex in Tipp-Reihenfolge. Läuft
 * der Raum umgekehrt, wird aus Wand i (Ecke i → i+1) die Wand n−1−i, und der
 * Abstand zählt vom anderen Ende.
 */
export function wandUmrechnen(index, abstand, laenge, n, umgekehrt) {
  if (!umgekehrt) return { index, abstand };
  return { index: (n - 1 - index + n) % n, abstand: laenge - abstand };
}

// ---------------------------------------------------------------- Helfer

function einheit(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
