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
/** Ein Schuss auf den Weltpunkt T = [x, y, z] – so, wie das Handy ihn misst (Standpunkt `von`). */
function schuss(T, g, dtMs = 5000, von = S) {
  uhr += dtMs;
  const dx = T[0] - von[0], dy = T[1] - von[1], D = Math.hypot(dx, dy), zT = T[2] ?? 0;
  let th = 0.3;   // Neigung so, dass die Linse (a, z) genau auf T schaut
  for (let k = 0; k < 60; k++) th = Math.atan2(g.hw + g.L * Math.cos(th) - zT, D - (g.r + g.L * Math.sin(th)));
  const psi = Math.atan2(dx, dy);
  const thM = th + g.biasGrad * Z.GRAD + g.rauschGrad * Z.GRAD * gauss();
  const psM = psi + g.driftGradProMin * Z.GRAD / 60000 * uhr + g.rauschGrad * Z.GRAD * gauss();
  return { v: [Math.sin(psM) * Math.cos(thM), Math.cos(psM) * Math.cos(thM), -Math.sin(thM)], t: uhr };
}

function aufnahme(g, { reihenfolge = L, schluss = false, annahme = 1.45, tuerOben = 1.97 } = {}) {
  uhr = 0;
  const a = A.neueAufnahme(annahme, "fertig");
  a.ecken = reihenfolge.map(p => { const s = schuss(p, g); return { v: s.v, t: s.t, ebene: "boden" }; });
  if (schluss) a.schluss = schuss(reihenfolge[0], g);
  const u = schuss(L[1], g), o = schuss([...L[1], H], g, 3000);
  a.hoehe = { vUnten: u.v, tUnten: u.t, vOben: o.v, tOben: o.t };
  // Tür in der Nordwand (0,4)→(5,4): ab x = 3,40, 0,885 breit, lichte Höhe 1,97.
  const t1 = schuss([3.4, 4, 0], g), t2 = schuss([4.285, 4, tuerOben], g, 3000);
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
wahr("2 Bandmaße: Schließkorrektur unauffällig", !r.hinweise.some(h => /mehr, als die Messung/.test(h)), r.hinweise.join(" | "));
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

// Ohne Kalibrierung sagt die App die Höhen-Unsicherheit ehrlich an.
wahr(`Höhen-Unsicherheit ausgewiesen (± ${(r.sigmaHoeheM * 100).toFixed(1)} cm)`, r.sigmaHoeheM > 0.01 && r.sigmaHoeheM < 0.1);
nah("Höhenfehler innerhalb 2σ", Math.abs(r.einbauten.find(e => e.id === "e2").hoeheM - 1.05), 0, 2 * r.sigmaHoeheM + 0.01);
wahr("kalibriert: kleinere Höhen-Unsicherheit", A.rekonstruiere({ ...a, neigungsfehlerGrad: 0.5 }).sigmaHoeheM < r.sigmaHoeheM);

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

// Bekannte Öffnungshöhe = die angezeigte Höhe (C5): beim Fenster mit Brüstung
// Ober- minus Unterkante (1,30), nicht die Oberkante über dem Boden (2,20).
a = aufnahme(HAND);
a.oeffnungen[1].hoeheBekanntM = 1.30;
r = A.rekonstruiere(a);
wahr(`Fensterhöhe 1,30 als Maßstab: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 10 cm`, maxWandFehler(r) <= 0.10);
nah("Fensterhöhe 1,30 als Maßstab: Fenster 1,30 hoch", r.oeffnungen.find(o => o.id === "f1").hoeheM, 1.30, 0.02);
nah("Fensterhöhe 1,30 als Maßstab: Brüstung 0,90", r.oeffnungen.find(o => o.id === "f1").bruestungM, 0.90, 0.03);
// Estrich fehlt (7 cm): die Tür steht 2,04 über dem Rohboden, angezeigt und
// eingetragen wird die lichte Höhe ab FFB 1,97.
a = aufnahme(HAND, { tuerOben: 2.04 });
a.boden = "roh";
a.oeffnungen[0].hoeheBekanntM = 1.97;
r = A.rekonstruiere(a, { aufbauM: 0.07 });
wahr(`Estrich + Türhöhe 1,97 ab FFB: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 10 cm`, maxWandFehler(r) <= 0.10);
nah("Estrich + Türhöhe: Tür 1,97 ab FFB", r.oeffnungen.find(o => o.id === "t1").hoeheM, 1.97, 0.02);
wahr("Estrich + Türhöhe: kalibriert", r.kalibriert && r.klasse !== "SKIZZE", r.klasse);

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
// Die Umrechnung selbst ist exakt (gleiche Aufnahme, auf den Rohboden bezogen);
// absolut gilt die angesagte Höhen-Unsicherheit (unkalibriert ± ~5 cm).
const rRoh = A.rekonstruiere({ ...a, boden: "fertig" });
nah("Estrich: Raumhöhe = Rohbodenhöhe − 7 cm", r.hoeheM, rRoh.hoeheM - 0.07, 0.006);
nah("Estrich: Steckdose = Rohbodenhöhe − 7 cm", r.einbauten.find(e => e.id === "e1").hoeheM, rRoh.einbauten.find(e => e.id === "e1").hoeheM - 0.07, 0.006);
nah("Estrich: Steckdose 23 cm ab FFB", r.einbauten.find(e => e.id === "e1").hoeheM, 0.23, Math.max(0.02, 2 * r.sigmaHoeheM));
nah("Estrich: Raumhöhe 2,55 ab FFB", r.hoeheM, 2.55, Math.max(0.02, 2 * r.sigmaHoeheM));
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

// ------------- 10. Ohne Glätten: fast parallele freie Wände (Review kern#0)
// Bandmaß auf beiden langen Wänden, die kurzen laufen nur Zehntelgrad
// gegeneinander. Früher fuhr der Ausgleich sie auf 0,00 m (Fläche 0,13 m²).
const VIER = [[0, 4], [5, 4.05], [5.03, 0], [0, 0]], S4 = [2.4, 2.1];
const vierAufnahme = (R, g, s0) => {
  seed = s0; uhr = 0;
  const x = A.neueAufnahme(1.45);
  x.ecken = R.map(q => { const t = schuss(q, g, 5000, S4); return { v: t.v, t: t.t, ebene: "boden" }; });
  return x;
};
const wv = wahreLaengen(VIER);
a = vierAufnahme(VIER, { ...HAND, rauschGrad: 0.15 }, 3);
a.rechtwinklig = false;
wv.forEach((l, i) => { if (l > 4.5) a.bandmasse[i] = l; });
r = A.rekonstruiere(a);
wahr(`schief, Bandmaß lang: max ${(maxWandFehler(r, VIER) * 100).toFixed(1)} cm ≤ 10 cm`, maxWandFehler(r, VIER) <= 0.10,
  JSON.stringify(r.waende.map(w => w.laenge.toFixed(3))));
nah("schief, Bandmaß lang: Fläche", r.flaecheM2, G.flaechePunkte(VIER), 0.5);

// ----------- 11. Altbau-Ecke 85° bei „rechtwinklig glätten“ (Review kern#3)
// Die Schließkorrektur (35 cm) ist mehr, als das Rauschen erklärt: Sie gehört
// in die Unsicherheit der verschobenen Wand, die Klasse darf nicht AUFMASS sein.
// (Ab ~5° sicher erkannt; eine 87°-Ecke liegt mit ~20 cm an der Rauschgrenze.)
const ALT = [[0, 4], [5, 4], [5, 0], [0.35, 0]];
const wa = wahreLaengen(ALT);
a = vierAufnahme(ALT, { ...HAND, rauschGrad: 0.1 }, 4);
a.bandmasse = { [wa.findIndex(l => Math.abs(l - 5) < 1e-9)]: 5.0, [wa.findIndex(l => Math.abs(l - 4) < 1e-9)]: 4.0 };
r = A.rekonstruiere(a);
wahr("Altbau-Ecke: nicht AUFMASS", r.klasse !== "AUFMASS", `${r.klasse} ${JSON.stringify(r.waende.map(w => [w.laenge.toFixed(3), w.sigmaM.toFixed(3)]))}`);
wahr("Altbau-Ecke: 2σ deckt jede Wand", r.waende.every((w, i) => 2 * w.sigmaM + 0.005 >= Math.abs(w.laenge - wa[i])),
  JSON.stringify(r.waende.map((w, i) => [w.laenge.toFixed(3), wa[i].toFixed(3), w.sigmaM.toFixed(3)])));
// Erst ein Bandmaß an der verschobenen Wand entscheidet – „Glätten aus“ auf
// bloßen Verdacht machte rechtwinklige Räume schlechter (Prüfer, fa_L).
const verdacht = r.hinweise.find(h => /mehr, als die Messung erklärt/.test(h)) || "";
wahr("Altbau-Ecke: Hinweis verlangt das Bandmaß, nennt die Ecke", /mit dem Bandmaß nachmessen/.test(verdacht) && /nicht rechtwinklig \(Wand/.test(verdacht) && !/ausschalten/.test(verdacht), r.hinweise.join(" | "));
wahr("Altbau-Ecke: nächstes Maß an der verschobenen Wand", r.naechstesMass && Math.abs(r.waende[r.naechstesMass.wandIndex].korrekturM) > 0.15);
// Mit dem Bandmaß dort widersprechen sich die Maße unter rechten Winkeln –
// jetzt ist die schiefe Ecke belegt, und erst jetzt heißt es „ausschalten“.
const k3 = r.naechstesMass.wandIndex;
a.bandmasse = { ...a.bandmasse, [k3]: wa[k3] };
r = A.rekonstruiere(a);
wahr("Altbau-Ecke + Kontrollmaß: Glätten ausschalten", r.hinweise.some(h => /passen nicht zu rechten Winkeln/.test(h) && /Rechtwinklig glätten“ ausschalten/.test(h)), r.hinweise.join(" | "));
wahr("Altbau-Ecke + Kontrollmaß: nicht AUFMASS", r.klasse !== "AUFMASS", r.klasse);
delete a.bandmasse[k3];
a.rechtwinklig = false;
r = A.rekonstruiere(a);
wahr(`Altbau-Ecke ohne Glätten: max ${(maxWandFehler(r, ALT) * 100).toFixed(1)} cm ≤ 5 cm`, maxWandFehler(r, ALT) <= 0.05);
// Ohne Glätten hält der Ausgleich die gezielten Richtungen fest – deren Zittern
// gehört in die Unsicherheit der freien Wände (früher ± 0,5 cm bei 2,4 cm Fehler).
wahr("Altbau-Ecke ohne Glätten: 2σ deckt jede Wand", r.waende.every((w, i) => 2 * w.sigmaM >= Math.abs(w.laenge - wa[i])),
  JSON.stringify(r.waende.map((w, i) => [w.laenge.toFixed(3), wa[i].toFixed(3), w.sigmaM.toFixed(3)])));

// ------------ 12. Wende-Kalibrierung mit Linsenversatz (Review kern#2, C6)
// 1 cm Versatz beim Umdrehen auf ein Ziel in 2 m verfälscht δ um ≈ 0,3°. Das
// gespeicherte δ ist also nicht ± 0,15° genau; die Unsicherheit muss auch
// 0,7° daneben (2,5 cm Versatz) noch decken – mit 0,15° lag der Fehler bei 2,7σ.
a = aufnahme(STATIV, { annahme: 1.30 });
a.haltung = "stativ";
a.neigungsfehlerGrad = 0.4 + 0.7;       // wahr 0,4°
r = A.rekonstruiere(a);
const wl0 = wahreLaengen();
wahr("Stativ, δ 0,7° daneben: 2σ deckt jede Wand", r.waende.every((w, i) => 2 * w.sigmaM + 0.005 >= Math.abs(w.laenge - wl0[i])),
  JSON.stringify(r.waende.map((w, i) => [w.laenge.toFixed(3), wl0[i], w.sigmaM.toFixed(3)])));

// ------------ 13. Laser-Raumhöhe ohne gezielte Kante (Review kern#4, C7)
a = aufnahme(HAND);
a.hoehe = null;
a.raumhoeheM = H;
r = A.rekonstruiere(a);
wahr("Laser ohne Kante: kein Maßstab", !r.kalibriert && r.klasse === "SKIZZE", r.klasse);
const kein = r.hinweise.find(h => /Noch kein Maßstab/.test(h)) || "";
wahr("Laser ohne Kante: Hinweis empfiehlt den Laser nicht als Maßstab", !/die Raumhöhe \(Laser\) oder/.test(kein) && /erst mit einer gezielten Raumkante/.test(kein), kein);
wahr("Laser ohne Kante: Höhen-Hinweis verlangt die Kante", r.hinweise.filter(h => /Raumhöhe \(Laser\)/.test(h)).every(h => /Raumkante/.test(h)), r.hinweise.join(" | "));
a = aufnahme(HAND);
r = A.rekonstruiere(a);
wahr("mit Kante: Laser als Maßstab empfohlen", r.hinweise.some(h => /Noch kein Maßstab/.test(h) && /Raumhöhe \(Laser\)/.test(h)));

// ------------- 14. Rechte Winkel sind eine Annahme (Prüfer, snap_mc 87°)
// Zwei Bandmaße an einem Rechteck: Die freien Wände legt allein der Schluss
// unter rechten Winkeln fest. Das Ergebnis sagt das (annahmen) und schlägt
// das Kontrollmaß vor, das die Winkel prüft; danach ist es keine Annahme mehr.
const RECHTECK = [[0, 4], [5, 4], [5, 0], [0, 0]];
const wr = wahreLaengen(RECHTECK);
a = vierAufnahme(RECHTECK, { ...HAND, rauschGrad: 0.1 }, 3);
a.bandmasse = { [wr.findIndex(l => Math.abs(l - 5) < 1e-9)]: 5.0, [wr.findIndex(l => Math.abs(l - 4) < 1e-9)]: 4.0 };
r = A.rekonstruiere(a);
wahr("Rechteck, 2 Bandmaße: Annahme rechtwinklig genannt", r.annahmen.includes("rechtwinklig"), JSON.stringify(r.annahmen));
wahr("Rechteck, 2 Bandmaße: Kontrollmaß vorgeschlagen", r.naechstesMass && r.naechstesMass.kontrolle && !(String(r.naechstesMass.wandIndex) in a.bandmasse), JSON.stringify(r.naechstesMass));
wahr("Rechteck, 2 Bandmaße: freie Wände nicht ± 0,5 cm", r.waende.filter(w => w.quelle !== "band").every(w => w.sigmaM > 0.01), JSON.stringify(r.waende.map(w => w.sigmaM.toFixed(3))));
a.bandmasse = { ...a.bandmasse, [r.naechstesMass.wandIndex]: wr[r.naechstesMass.wandIndex] };
r = A.rekonstruiere(a);
wahr("Rechteck + Kontrollmaß: keine Annahme mehr", r.annahmen.length === 0 && r.klasse === "AUFMASS", `${r.klasse} ${JSON.stringify(r.annahmen)}`);
// 87°-Ecke mit zwei Bandmaßen: ~20 cm Lücke liegen an der Rauschgrenze des
// Zielens – statistisch nicht immer zu erkennen. Dann darf AUFMASS nur unter
// der genannten Annahme stehen, mit dem Kontrollmaß, das sie prüft; und mit
// diesem Kontrollmaß fällt die schiefe Ecke auf.
const SCHIEF87 = [[0, 4], [5, 4], [5, 0], [0.21, 0]];
const w87 = wahreLaengen(SCHIEF87);
let ohneVorbehalt = 0, kontrolleVerfehlt = 0, verdeckt = 0;
for (let k = 1; k <= 40; k++) {
  a = vierAufnahme(SCHIEF87, { ...HAND, rauschGrad: 0.2 }, 100 + k);
  a.bandmasse = { [w87.findIndex(l => Math.abs(l - 5) < 1e-9)]: 5.0, [w87.findIndex(l => Math.abs(l - 4) < 1e-9)]: 4.0 };
  r = A.rekonstruiere(a);
  const f = r.waende.map((w, i) => Math.abs(w.laenge - w87[i]));
  if (r.klasse !== "AUFMASS" || Math.max(...f) <= 0.10) continue;
  verdeckt++;
  if (!r.annahmen.includes("rechtwinklig") || !r.naechstesMass?.kontrolle) { ohneVorbehalt++; continue; }
  a.bandmasse = { ...a.bandmasse, [r.naechstesMass.wandIndex]: w87[r.naechstesMass.wandIndex] };
  const r2 = A.rekonstruiere(a);
  if (r2.klasse === "AUFMASS" && !r2.hinweise.some(h => /passen nicht zu rechten Winkeln/.test(h))) kontrolleVerfehlt++;
}
wahr(`87°-Ecke: AUFMASS mit > 10 cm Fehler nur unter Vorbehalt (${ohneVorbehalt} von ${verdeckt})`, ohneVorbehalt === 0);
wahr(`87°-Ecke: das Kontrollmaß deckt die Ecke auf (${kontrolleVerfehlt} verfehlt)`, kontrolleVerfehlt === 0);
wahr(`87°-Ecke: meist schon ohne Kontrollmaß erkannt (${40 - verdeckt}/40)`, verdeckt <= 10);

// ------------- 15. Ohne Glätten: Winkel tragen die Unsicherheit von h, r, δ
// L-Raum, zwei Bandmaße, nicht kalibriert: Nahe und ferne Ecken verzerren
// sich unterschiedlich – das gehört in die Wände (früher 2σ nur 38 %).
const LS = [3.4, 2.6];
let deckt = 0, aufmassFalsch = 0;
for (let k = 1; k <= 40; k++) {
  seed = 7 * k + 1;
  uhr = 0;
  const g = { ...HAND, rauschGrad: 0.15 };
  a = A.neueAufnahme(1.45, "fertig");
  a.rechtwinklig = false;
  a.ecken = L.map(q => { const s = schuss(q, g, 5000, LS); return { v: s.v, t: s.t, ebene: "boden" }; });
  a.schluss = schuss(L[0], g, 5000, LS);
  const wl = wahreLaengen();
  a.bandmasse = { 0: wl[0], 1: wl[1] };
  r = A.rekonstruiere(a);
  const f = r.waende.map((w, i) => Math.abs(w.laenge - wl[i]));
  if (r.waende.every((w, i) => f[i] <= 2 * w.sigmaM + 0.005)) deckt++;
  if (r.klasse === "AUFMASS" && Math.max(...f) > 0.10) aufmassFalsch++;
}
wahr(`ohne Glätten, L: 2σ deckt meist jede Wand (${deckt}/40)`, deckt >= 34);
wahr(`ohne Glätten, L: nie AUFMASS mit > 10 cm Fehler (${aufmassFalsch}/40)`, aufmassFalsch === 0);

// ------------- 16. Alte Aufnahmen (version 2): bekannte Höhe = Oberkante
// Bis version 2 hieß hoeheBekanntM „Oberkante über dem gezielten Boden“ –
// gespeicherte Aufnahmen rechnen so weiter, statt den Maßstab zu kippen.
a = aufnahme(HAND);
a.version = 2;
a.oeffnungen[1].hoeheBekanntM = 2.20;      // Fenster-Oberkante, damals richtig
r = A.rekonstruiere(a);
wahr(`version 2, Fenster-Oberkante 2,20: max ${(maxWandFehler(r) * 100).toFixed(1)} cm ≤ 10 cm`, maxWandFehler(r) <= 0.10);
wahr("neue Aufnahmen: version 3", A.neueAufnahme().version === 3);

console.log(`raumaufnahme.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
