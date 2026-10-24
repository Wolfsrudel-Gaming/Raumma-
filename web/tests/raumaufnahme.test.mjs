/*
 * Ende-zu-Ende der würfelfreien Raumaufnahme ohne Oberfläche – mit einem
 * **physikalisch realistischen** Zielvorgang: Man dreht sich um die eigene
 * Achse, die Linse sitzt r = 32 cm davor und 8 cm über dem Drehpunkt der Hand,
 * das Gerät hat 0,5° Neigungsfehler, die Hand zittert, die Gier läuft weg.
 * Angenommen wird eine falsche Kamerahöhe. `rekonstruiere` muss daraus den
 * L-Raum zurückgewinnen – so genau, wie die verfügbaren Maße es erlauben, und
 * die Qualitätsklasse muss das ehrlich sagen.
 *
 * Aufruf: node web/tests/raumaufnahme.test.mjs   (Exitcode != 0 bei Fehler)
 */
import * as Z from "../zielen.js";
import * as G from "../geometrie.js";
import * as A from "../raumaufnahme.js";

let ok = 0, fail = 0;
const nah = (name, got, want, tol) => {
  const p = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want} (±${tol})`); fail++; } else ok++;
};
const wahr = (name, b, info = "") => { if (!b) { console.error(`FAIL ${name} ${info}`); fail++; } else ok++; };

// Wahrer Raum in Weltkoordinaten (x Ost, y Nord): L-Form, 17 m², 2,62 m hoch.
const L = [[0, 4], [5, 4], [5, 0], [2, 0], [2, 1.5], [0, 1.5]];
const H = 2.62, S = [2.9, 2.5];

// Haltung der „Person“: Drehpunkt der Hand 1,30 m, Linse 8 cm darüber → 1,38 m.
const HAND = { hw: 1.30, r: 0.32, L: 0.08, biasGrad: 0.5, rauschGrad: 0, driftGradProMin: 0 };

let seed = 11;
const zufall = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; while (!u) u = zufall(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * zufall()); };

let uhr = 0;
/** Ein Schuss auf den Weltpunkt T = [x, y, z] – so, wie das Handy ihn misst. */
function schuss(T, g, dtMs = 5000) {
  uhr += dtMs;
  const dx = T[0] - S[0], dy = T[1] - S[1], D = Math.hypot(dx, dy), zT = T[2] ?? 0;
  let th = 0.3;   // Neigung so, dass die Linse (a, z) genau auf T schaut
  for (let k = 0; k < 60; k++) th = Math.atan2(g.hw + g.L * Math.cos(th) - zT, D - (g.r + g.L * Math.sin(th)));
  const psi = Math.atan2(dx, dy);
  const thM = th + g.biasGrad * Z.GRAD + g.rauschGrad * Z.GRAD * gauss();
  const psM = psi + g.driftGradProMin * Z.GRAD / 60000 * uhr + g.rauschGrad * Z.GRAD * gauss();
  return { v: [Math.sin(psM) * Math.cos(thM), Math.cos(psM) * Math.cos(thM), -Math.sin(thM)], t: uhr };
}

function aufnahme(g, { reihenfolge = L, schluss = false, annahme = 1.45 } = {}) {
  uhr = 0;
  const a = A.neueAufnahme(annahme, "fertig");
  a.ecken = reihenfolge.map(p => { const s = schuss(p, g); return { v: s.v, t: s.t, ebene: "boden" }; });
  if (schluss) a.schluss = schuss(reihenfolge[0], g);
  const u = schuss(L[1], g), o = schuss([...L[1], H], g, 3000);
  a.hoehe = { vUnten: u.v, tUnten: u.t, vOben: o.v, tOben: o.t };
  // Tür in der Nordwand (0,4)→(5,4): ab x = 3,40, 0,885 breit, lichte Höhe 1,97.
  const t1 = schuss([3.4, 4, 0], g), t2 = schuss([4.285, 4, 1.97], g, 3000);
  a.oeffnungen.push({ id: "t1", art: "TUER", a: t1.v, ta: t1.t, b: t2.v, tb: t2.t });
  // Fenster in der Ostwand: ab 1,00 vom Nordende, 1,20 breit, Brüstung 0,90, Höhe 1,30.
  const f1 = schuss([5, 3.0, 0.9], g), f2 = schuss([5, 1.8, 2.2], g, 3000);
  a.oeffnungen.push({ id: "f1", art: "FENSTER", a: f1.v, ta: f1.t, b: f2.v, tb: f2.t });
  // Steckdose Westwand y = 2,50 auf 30 cm; Schalter neben der Tür 1,05; Deckenleuchte.
  for (const [id, art, bef, T] of [["e1", "STECKDOSE", "WAND", [0, 2.5, 0.3]], ["e2", "SCHALTER", "WAND", [3.2, 4, 1.05]], ["e3", "LAMPE", "DECKE", [3.5, 2, H]]]) {
    const s = schuss(T, g, 4000);
    a.einbauten.push({ id, art, befestigung: bef, v: s.v, t: s.t });
  }
  return a;
}

/** Raum-Wandindex der Wand, deren Länge `soll` am nächsten kommt. */
const index = (r, soll) => r.waende.reduce((b, w, i) => Math.abs(w.laenge - soll) < Math.abs(r.waende[b].laenge - soll) ? i : b, 0);
/** Wahre Länge je Raum-Wandindex (Raum = Tipp-Reihenfolge oder umgekehrt, Ecke 0 bleibt). */
function wahreLaengen(reihenfolge = L) {
  const n = reihenfolge.length;
  const w = reihenfolge.map((a, i) => { const b = reihenfolge[(i + 1) % n]; return Math.hypot(b[0] - a[0], b[1] - a[1]); });
  return Z.raumAusEcken(reihenfolge).umgekehrt ? w.map((_, i) => w[(n - 1 - i + n) % n]) : w;
}
const maxWandFehler = (r, reihenfolge = L) => { const w = wahreLaengen(reihenfolge); return Math.max(...r.waende.map((x, i) => Math.abs(x.laenge - w[i]))); };
const wahrRaum = Z.raumAusEcken(L);
const wandMitPunkt = (punkte, q) => G.naechsteWand({ umriss: G.umrissSchreiben(punkte) }, q[0], q[1]);

// ---------------------------------- 1. Realistisch, exakt, zwei Bandmaße

let a = aufnahme(HAND);
let r = A.rekonstruiere(a);
wahr("Rekonstruktion vorhanden", !!r);
wahr("ohne Maßstab: Klasse SKIZZE", r.klasse === "SKIZZE", r.klasse);
wahr("ohne Maßstab: Hinweis", r.hinweise.some(t => /Noch kein Maßstab/.test(t)));
wahr("ohne Maßstab: nächstes Maß = längste Wand", r.naechstesMass && r.naechstesMass.wandIndex === index(r, 99));
a.bandmasse = { [index(r, 5.2)]: 5.0, [index(r, 4.15)]: 4.0 };
r = A.rekonstruiere(a);
nah("2 Bandmaße: Fläche 17 m²", r.flaecheM2, 17, 0.08);
nah("2 Bandmaße: größter Wandfehler", maxWandFehler(r), 0, 0.015);
// Kamerahöhe und Neigungsfehler sind aus Längen allein nur schwach trennbar –
// die Wände stimmen trotzdem, die Höhen auf ~2–3 cm (siehe unten: kalibriert).
nah("2 Bandmaße: Kamerahöhe ≈ 1,38", r.kamerahoeheM, 1.38, 0.05);
nah("2 Bandmaße: Armabstand 0,32 erkannt", r.armM, 0.32, 0.05);
nah("2 Bandmaße: Raumhöhe 2,62", r.hoeheM, H, 0.03);
wahr("2 Bandmaße: Klasse AUFMASS", r.klasse === "AUFMASS", `${r.klasse} ${JSON.stringify(r.waende.map(w => w.sigmaM))}`);
wahr("Bandmaß-Wände markiert", r.waende.filter(w => w.quelle === "band").length === 2);

const tuer = r.oeffnungen.find(o => o.id === "t1");
nah("Tür Breite 0,885", tuer.breiteM, 0.885, 0.02);
nah("Tür lichte Höhe 1,97", tuer.hoeheM, 1.97, 0.03);
nah("Tür Brüstung 0", tuer.bruestungM, 0, 1e-9);
nah("Tür an 5-m-Wand", r.waende[tuer.wandIndex].laenge, 5, 0.011);
const tm = wahrRaum.abbildung([3.4 + 0.4425, 4]);
nah("Türmitte am richtigen Ort", tuer.abstandM + tuer.breiteM / 2, wandMitPunkt(r.punkte, tm).abstand, 0.03);
const fenster = r.oeffnungen.find(o => o.id === "f1");
nah("Fenster Breite 1,20", fenster.breiteM, 1.2, 0.025);
nah("Fenster Brüstung 0,90", fenster.bruestungM, 0.9, 0.03);
nah("Fenster Höhe 1,30", fenster.hoeheM, 1.3, 0.03);
const dose = r.einbauten.find(e => e.id === "e1");
nah("Steckdose 30 cm hoch", dose.hoeheM, 0.3, 0.03);
nah("Steckdose an 2,5-m-Wand", r.waende[dose.wandIndex].laenge, 2.5, 0.02);
nah("Steckdose Abstand", dose.abstandM, wandMitPunkt(r.punkte, wahrRaum.abbildung([0, 2.5])).abstand, 0.03);
nah("Schalter 1,05 hoch", r.einbauten.find(e => e.id === "e2").hoeheM, 1.05, 0.03);
const lampe = r.einbauten.find(e => e.id === "e3");
const lq = wahrRaum.abbildung([3.5, 2]);
nah("Lampe relX", lampe.relX, lq[0] / 5, 0.015);
nah("Lampe relY", lampe.relY, lq[1] / 4, 0.015);
wahr("Umriss ohne Prüfhinweise", G.pruefen(r.punkte).length === 0, G.pruefen(r.punkte).join(" | "));

// Mit Wende-Kalibrierung (δ bekannt) oder Laser-Raumhöhe sitzen auch die Höhen.
// (Laser-Raumhöhe hält Boden und Decke fest; Höhen in Augenhöhe bleiben ±2–3 cm.)
for (const [name, extra, tolMitte] of [["kalibriert", { neigungsfehlerGrad: 0.5 }, 0.012], ["Laser-Raumhöhe", { raumhoeheM: H }, 0.03]]) {
  const rk = A.rekonstruiere({ ...a, ...extra });
  nah(`${name}: Kamerahöhe 1,38`, rk.kamerahoeheM, 1.38, tolMitte + 0.005);
  nah(`${name}: Steckdose 30 cm`, rk.einbauten.find(e => e.id === "e1").hoeheM, 0.3, 0.012);
  nah(`${name}: Schalter 105 cm`, rk.einbauten.find(e => e.id === "e2").hoeheM, 1.05, tolMitte);
  nah(`${name}: Tür 1,97`, rk.oeffnungen.find(o => o.id === "t1").hoeheM, 1.97, 0.015);
  nah(`${name}: größter Wandfehler`, maxWandFehler(rk), 0, 0.015);
}

// Das alte Modell (Auge auf der Achse) hätte hier um Dezimeter danebengelegen:
const naiv = A.rekonstruiere({ ...a, bandmasse: { [index(r, 5)]: 5.0 }, armM: 0, linseM: 0, haltung: "stativ" });
wahr(`Modellfehler sichtbar: naiv max ${(maxWandFehler(naiv) * 100).toFixed(0)} cm`, maxWandFehler(naiv) > 0.05);

// ------------------------------------------- 2. Ein Bandmaß (Normalfall)

a = aufnahme(HAND);
r = A.rekonstruiere(a);
a.bandmasse = { [index(r, 5.2)]: 5.0 };
r = A.rekonstruiere(a);
const w1 = wahreLaengen();
wahr(`1 Bandmaß: größter Wandfehler ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 6 cm`, maxWandFehler(r) <= 0.06);
wahr("1 Bandmaß: Fehlerangabe deckt den Fehler (2σ)", r.waende.every((w, i) => w.quelle === "band" || 2 * w.sigmaM + 0.005 >= Math.abs(w.laenge - w1[i])),
  JSON.stringify(r.waende.map((w, i) => [w.laenge.toFixed(3), w1[i], (w.sigmaM * 100).toFixed(1)])));
nah("1 Bandmaß: Fläche", r.flaecheM2, 17, 0.4);

// ----------------------------- 3. Zittern ±0,2°, Drift 2°/min, Schlussschuss

const ZITTER = { ...HAND, rauschGrad: 0.2, driftGradProMin: 2 };
a = aufnahme(ZITTER, { schluss: true });
r = A.rekonstruiere(a);
a.bandmasse = { [index(r, 5.2)]: 5.0 };
r = A.rekonstruiere(a);
const fz = maxWandFehler(r);
wahr(`Zittern + Drift + Schlussschuss: max ${(fz * 100).toFixed(1)} cm ≤ 10 cm`, fz <= 0.10);
nah("Zittern: Restlücke danach 0", r.restlueckeNachherM, 0, 0.005);
wahr("Zittern: rechtwinklig", G.waende(r.punkte).every(w => Math.abs(Math.abs(w.drehung) - 90) < 0.2));
const ohneSchluss = aufnahme(ZITTER);
ohneSchluss.bandmasse = a.bandmasse;
wahr("ohne Schlussschuss: Tipp", A.rekonstruiere(ohneSchluss).hinweise.some(t => /Schlussschuss/.test(t)));

// ------------------------------------- 4. Maßstab nur aus Tür oder Raumhöhe

a = aufnahme(HAND);
a.oeffnungen[0].hoeheBekanntM = 1.97;
r = A.rekonstruiere(a);
wahr("Türhöhe als Maßstab: kalibriert", r.kalibriert);
wahr(`Türhöhe als Maßstab: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 20 cm`, maxWandFehler(r) <= 0.20);
wahr("Türhöhe als Maßstab: nicht mehr SKIZZE", r.klasse !== "SKIZZE", r.klasse);

a = aufnahme(HAND);
a.raumhoeheM = H;                       // Laser nach oben
r = A.rekonstruiere(a);
wahr(`Raumhöhe als Maßstab: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 20 cm`, maxWandFehler(r) <= 0.20);
nah("Raumhöhe als Maßstab: Höhe exakt übernommen", r.hoeheM, H, 1e-9);

// --------------------------- 5. Stativ: Höhe bekannt, Neigung kalibriert

const STATIV = { hw: 1.20, r: 0, L: 0.10, biasGrad: 0.4, rauschGrad: 0.05, driftGradProMin: 0 };
a = aufnahme(STATIV, { annahme: 1.30 });
a.haltung = "stativ";
a.neigungsfehlerGrad = 0.4;            // aus der Wende-Kalibrierung
r = A.rekonstruiere(a);
wahr(`Stativ ohne Bandmaß: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 4 cm`, maxWandFehler(r) <= 0.04);

// Wende-Kalibrierung selbst: Ziel einmal normal, einmal auf dem Kopf.
uhr = 0;
const normal = schuss([3, 4, 0.3], { ...HAND, biasGrad: 0.6 });
const gewendet = schuss([3, 4, 0.3], { ...HAND, biasGrad: -0.6 });
nah("Wende-Kalibrierung findet 0,6°", Z.neigungsfehlerGrad(normal.v, gewendet.v), 0.6, 1e-9);

// ------------------------------------- 6. Gegen den Uhrzeigersinn getippt

const gegen = [L[0], ...L.slice(1).reverse()];
a = aufnahme(HAND, { reihenfolge: gegen });
r = A.rekonstruiere(a);
a.bandmasse = { [index(r, 5.2)]: 5.0, [index(r, 4.15)]: 4.0 };
r = A.rekonstruiere(a);
wahr(`gegen: max ${(maxWandFehler(r, gegen) * 100).toFixed(1)} cm`, maxWandFehler(r, gegen) <= 0.015);
const tg = r.oeffnungen.find(o => o.id === "t1");
nah("gegen: Tür an 5-m-Wand", r.waende[tg.wandIndex].laenge, 5, 0.011);
const dg = r.einbauten.find(e => e.id === "e1");
nah("gegen: Steckdose Abstand konsistent", dg.abstandM, wandMitPunkt(r.punkte, Z.raumAusEcken(gegen).abbildung([0, 2.5])).abstand, 0.03);

// ----------------------------- 7. Ideales Auge auf der Achse bleibt korrekt

const IDEAL = { hw: 1.38, r: 0, L: 0, biasGrad: 0, rauschGrad: 0, driftGradProMin: 0 };
a = aufnahme(IDEAL);
r = A.rekonstruiere(a);
a.bandmasse = { [index(r, 5.2)]: 5.0, [index(r, 4.15)]: 4.0 };
r = A.rekonstruiere(a);
wahr(`ideal: max ${(maxWandFehler(r) * 100).toFixed(1)} cm`, maxWandFehler(r) <= 0.015);

// ---------------------------------------- 8. Estrich: Höhen ab Fertigfußboden

a = aufnahme(HAND);
a.boden = "roh";
r = A.rekonstruiere(a);
a.bandmasse = { [index(r, 5.2)]: 5.0, [index(r, 4.15)]: 4.0 };
r = A.rekonstruiere(a, { aufbauM: 0.07 });
nah("Estrich: Steckdose 23 cm ab FFB", r.einbauten.find(e => e.id === "e1").hoeheM, 0.23, 0.02);
nah("Estrich: Raumhöhe 2,55 ab FFB", r.hoeheM, 2.55, 0.02);
nah("Estrich: Tür steht trotzdem auf dem Boden", r.oeffnungen.find(o => o.id === "t1").bruestungM, 0, 1e-9);

// ------------------------------------------------------------- 9. Grenzfälle

wahr("< 3 Ecken → null", A.rekonstruiere({ ...A.neueAufnahme(), ecken: a.ecken.slice(0, 2) }) === null);
const af = aufnahme(HAND);
af.ecken.push({ v: Z.blickAusEuler(0, 89, 0), ebene: "boden", t: 99999 });
const rf = A.rekonstruiere(af);
wahr("flache Ecke ausgelassen + Hinweis", rf.punkte.length === 6 && rf.hinweise.some(h => /ausgelassen/.test(h)), rf.hinweise.join(" | "));
const ab = aufnahme(HAND);
const rb0 = A.rekonstruiere(ab);
ab.bandmasse = { [index(rb0, 5.2)]: 5.0, [index(rb0, 4.15)]: 4.6 };   // grob falsch abgelesen
const rb = A.rekonstruiere(ab);
wahr("widersprüchliches Bandmaß wird gemeldet", rb.hinweise.some(h => /richtig abgelesen/.test(h)), rb.hinweise.join(" | "));
const vs = A.vorschau(aufnahme(HAND));
wahr("Vorschau liefert Ecken", vs.punkte.length === 6 && vs.laengen.length === 5);
const al = aufnahme(HAND);
const live = A.unsicherheitLive(al.ecken[0].v, al);
wahr(`Live-Unsicherheit ehrlich (${(live * 100).toFixed(0)} cm ≥ 10 cm ohne Maßstab)`, live >= 0.10 && live < 1);

console.log(`raumaufnahme.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
