/*
 * Prüft die Zielgeometrie der würfelfreien Raumaufnahme (web/zielen.js).
 *
 * Vorgehen wie vor Ort, nur rückwärts: Ein bekannter Raum (L-Form) wird aus
 * einem Standpunkt „angezielt" – aus jeder Ecke wird die Lage berechnet, die
 * ein Handy dabei hätte. Die Rekonstruktion daraus muss den Raum wieder
 * ergeben: exakt ohne Rauschen, innerhalb der angegebenen Unsicherheit mit.
 *
 * Aufruf: node web/tests/zielen.test.mjs   (Exitcode != 0 bei Fehler)
 */
import * as Z from "../zielen.js";
import * as G from "../geometrie.js";

let ok = 0, fail = 0;
const nah = (name, got, want, tol = 1e-6) => {
  const p = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want} (±${tol})`); fail++; } else ok++;
};
const wahr = (name, b) => { if (!b) { console.error(`FAIL ${name}`); fail++; } else ok++; };

/** Lage (α, β, γ=0), mit der die Rückkamera genau in Richtung v schaut. */
function lageFuer(v) {
  const l = Math.hypot(...v);
  const [x, y, z] = v.map(c => c / l);
  return { alpha: Math.atan2(-x, y) / Z.GRAD, beta: Math.acos(-z) / Z.GRAD, gamma: 0 };
}
/** Zielstrahl vom Auge (Standpunkt s, Höhe h) zu einem Weltpunkt (x, y, z). */
const strahl = (s, h, p) => [p[0] - s[0], p[1] - s[1], (p[2] ?? 0) - h];

// ------------------------------------------------------------ Blickrichtung

let v = Z.blickAusEuler(0, 90, 0);
nah("hochkant → Nord x", v[0], 0); nah("hochkant → Nord y", v[1], 1); nah("hochkant → Nord z", v[2], 0);
v = Z.blickAusEuler(90, 90, 0);
nah("α=90 → West x", v[0], -1); nah("α=90 → West y", v[1], 0);
v = Z.blickAusEuler(0, 0, 0);
nah("flach → Kamera nach unten", v[2], -1);
nah("Neigung β=60 → 30° nach unten", Z.neigungGrad(Z.blickAusEuler(0, 60, 0)), 30);
nah("Gier West = 270°", Z.gierGrad(Z.blickAusEuler(90, 80, 0)), 270);

// Quaternion (Android) und Euler (Web) müssen dieselbe Richtung liefern.
function quatAusEuler(a, b, g) {
  const h = x => x * Z.GRAD / 2;
  const qz = [Math.cos(h(a)), 0, 0, Math.sin(h(a))];
  const qx = [Math.cos(h(b)), Math.sin(h(b)), 0, 0];
  const qy = [Math.cos(h(g)), 0, Math.sin(h(g)), 0];
  const mul = (p, q) => [
    p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
    p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
    p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
    p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0]
  ];
  return mul(mul(qz, qx), qy);
}
for (const [a, b, g] of [[10, 70, 5], [200, 45, -20], [333, 110, 30], [90, 20, -80]]) {
  const e = Z.blickAusEuler(a, b, g), q = Z.blickAusQuaternion(quatAusEuler(a, b, g));
  nah(`Quaternion = Euler (${a},${b},${g})`, Math.hypot(e[0] - q[0], e[1] - q[1], e[2] - q[2]), 0, 1e-9);
}

// Mitteln: symmetrisches Zittern hebt sich auf.
const m = Z.mitteln([Z.blickAusEuler(0, 60, 1), Z.blickAusEuler(0, 60, -1), Z.blickAusEuler(0, 61, 0), Z.blickAusEuler(0, 59, 0)]);
nah("mitteln → 30°", Z.neigungGrad(m.v), 30, 0.01);
wahr("mitteln Streuung ~1°", m.streuungGrad > 0.5 && m.streuungGrad < 1.5);

// ------------------------------------------------- L-förmiger Raum, exakt

// Weltkoordinaten (x Ost, y Nord). Wahre Ecken eines L-Raums 5,00 × 4,00 mit
// ausgeschnittener Ecke 2,00 × 1,50, im Uhrzeigersinn von oben gesehen.
const L = [[0, 4], [5, 4], [5, 0], [2, 0], [2, 1.5], [0, 1.5]];
const h = 1.42, s = [2.6, 2.4];
const lagen = L.map(p => lageFuer(strahl(s, h, p)));
const blicke = lagen.map(l => Z.blickAusEuler(l.alpha, l.beta, l.gamma));
const welt = blicke.map(b => { const p = Z.bodenpunkt(b, h, s); return [p.x, p.y]; });
L.forEach((p, i) => {
  nah(`Ecke ${i} x`, welt[i][0], p[0], 1e-9);
  nah(`Ecke ${i} y`, welt[i][1], p[1], 1e-9);
});

const raum = Z.raumAusEcken(welt);
nah("Fläche L-Raum 17 m²", G.flaechePunkte(raum.punkte), 5 * 4 - 2 * 1.5, 1e-9);
nah("Wand 1 waagerecht", raum.punkte[1][1] - raum.punkte[0][1], 0, 1e-9);
nah("Wand 1 Länge 5,00", Math.hypot(raum.punkte[1][0] - raum.punkte[0][0], raum.punkte[1][1] - raum.punkte[0][1]), 5, 1e-9);
wahr("auf (0,0) geschoben", Math.min(...raum.punkte.map(p => p[0])) > -1e-9 && Math.min(...raum.punkte.map(p => p[1])) > -1e-9);
wahr("im Uhrzeigersinn getippt → nicht umgekehrt", raum.umgekehrt === false);
// Im Raumsystem rechtwinklig: alle Drehungen ±90°.
const wl = G.waende(raum.punkte);
wahr("alle Ecken rechtwinklig", wl.every(w => Math.abs(Math.abs(w.drehung) - 90) < 0.01));
nah("Summe der Drehungen = 360°", wl.reduce((a, w) => a + w.drehung, 0), 360, 0.1);

// Gegen den Uhrzeigersinn getippt: gleiches Ergebnis, Reihenfolge umgedreht.
const gegen = [welt[0], ...welt.slice(1).reverse()];
const r2 = Z.raumAusEcken(gegen);
wahr("gegen Uhrzeigersinn → umgekehrt", r2.umgekehrt === true);
nah("gleiche Fläche", G.flaechePunkte(r2.punkte), G.flaechePunkte(raum.punkte), 1e-9);
const wl2 = G.waende(r2.punkte);
wahr("auch umgekehrt rechtwinklig, Summe +360°", Math.abs(wl2.reduce((a, w) => a + w.drehung, 0) - 360) < 0.1);

// ---------------------------------------------- Wandpunkt: Steckdose, Fenster

// Steckdose an der Wand von L[1]=(5,4) nach L[2]=(5,0): 1,20 m ab L[1], 0,30 m hoch.
const dose = [5, 4 - 1.2, 0.3];
const vDose = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, dose))));
const w = Z.ersteWand(vDose, h, welt, s);
wahr("Steckdose trifft Wand 1", w && w.index === 1);
nah("Steckdose Abstand 1,20", w.abstand, 1.2, 1e-9);
nah("Steckdose Höhe 0,30", w.hoehe, 0.3, 1e-9);
// Und ins Raumsystem abgebildet liegt sie auf der Raumwand.
const dr = raum.abbildung([w.x, w.y]);
const nw = G.naechsteWand({ umriss: G.umrissSchreiben(raum.punkte) }, dr[0], dr[1]);
nah("Steckdose im Raumsystem auf der Wand", nw.entfernung, 0, 0.006);

// Fensteroberkante über Augenhöhe (Strahl nach oben) auf Wand 0 (Nordwand).
const fenster = [3.1, 4, 2.15];
const vF = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, fenster))));
const wf = Z.ersteWand(vF, h, welt, s);
wahr("Fenster trifft Wand 0", wf && wf.index === 0);
nah("Fenster Höhe 2,15", wf.hoehe, 2.15, 1e-9);
nah("Fenster Abstand 3,10", wf.abstand, 3.1, 1e-9);

// Umrechnung des Wandbezugs bei umgekehrtem Raum.
const n = welt.length;
const um = Z.wandUmrechnen(1, 1.2, 4, n, true);
wahr("Wand 1 ↔ umgekehrt Wand n-2", um.index === n - 2);
nah("Abstand vom anderen Ende", um.abstand, 2.8, 1e-12);

// ---------------------------------------------------- Decke und Kalibrierung

const H = 2.61;
const vDecke = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, [5, 4, H]))));
const dp = Z.deckenpunkt(vDecke, h, H, s);
nah("Deckenpunkt x", dp.x, 5, 1e-9); nah("Deckenpunkt y", dp.y, 4, 1e-9);

// Raumhöhe aus Boden- und Deckenecke derselben senkrechten Kante.
const vEckeUnten = blicke[1];
const dUnten = Z.bodenpunkt(vEckeUnten, h, s).d;
nah("Raumhöhe aus Kante", h + dUnten * Math.tan(-Z.neigungGrad(vDecke) * Z.GRAD), H, 1e-9);

// Türzarge: Fuß und Sturz bei 2,01 m → Kamerahöhe.
const zarge = [2, 0.6];
const vFuss = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, [...zarge, 0]))));
const vSturz = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, [...zarge, 2.01]))));
nah("Kamerahöhe aus Tür", Z.hoeheAusSenkrechte(vFuss, vSturz, 2.01), h, 1e-9);
// Auch wenn der Kopf unter Augenhöhe liegt (Brüstung 0,90 m).
const vBr = Z.blickAusEuler(...Object.values(lageFuer(strahl(s, h, [...zarge, 0.9]))));
nah("Kamerahöhe aus niedriger Senkrechte", Z.hoeheAusSenkrechte(vFuss, vBr, 0.9), h, 1e-9);

// Falsche Annahme h = 1,50 → Bandmaß der Wand 1 (5,00 m) korrigiert alles.
const hFalsch = 1.5;
const weltF = blicke.map(b => { const p = Z.bodenpunkt(b, hFalsch, s); return [p.x, p.y]; });
const istW1 = Math.hypot(weltF[1][0] - weltF[0][0], weltF[1][1] - weltF[0][1]);
const k = Z.skalaAusLaengen([{ ist: istW1, soll: 5 }]);
nah("Skala → wahre Kamerahöhe", hFalsch * k, h, 1e-9);
nah("Skala mit zwei Maßen", Z.skalaAusLaengen([{ ist: 2, soll: 1 }, { ist: 4, soll: 2 }]), 0.5, 1e-12);
wahr("Skala ohne Maße → null", Z.skalaAusLaengen([]) === null);

// ------------------------------------------------- Rauschen und Fehlerangabe

// Deterministisches Pseudo-Rauschen ±0,3° auf α und β.
let seed = 7;
const zufall = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
let maxFehler = 0, maxSigma = 0;
L.forEach(p => {
  const l = lageFuer(strahl(s, h, p));
  const b = Z.blickAusEuler(l.alpha + 0.3 * zufall(), l.beta + 0.3 * zufall(), 0);
  const q = Z.bodenpunkt(b, h, s);
  maxFehler = Math.max(maxFehler, Math.hypot(q.x - p[0], q.y - p[1]));
  maxSigma = Math.max(maxSigma, Z.unsicherheitBoden(b, h, 0.3));
});
wahr(`Rauschen 0,3° → Fehler ${(maxFehler * 100).toFixed(1)} cm ≤ 2σ ${(2 * maxSigma * 100).toFixed(1)} cm`, maxFehler <= 2 * maxSigma);
wahr("Fehler bleibt unter 15 cm", maxFehler < 0.15);

// Flache Strahlen werden abgewiesen statt beliebig ungenau.
wahr("Strahl über Horizont → null", Z.bodenpunkt(Z.blickAusEuler(0, 95, 0), h) === null);
wahr("fast waagerecht → null", Z.bodenpunkt(Z.blickAusEuler(0, 88, 0), h) === null);
wahr("Unsicherheit wächst mit Entfernung",
  Z.unsicherheitBoden(Z.blickAusEuler(0, 30, 0), h) < Z.unsicherheitBoden(Z.blickAusEuler(0, 75, 0), h));

console.log(`zielen.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
