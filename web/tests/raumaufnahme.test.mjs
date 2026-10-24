/*
 * Ende-zu-Ende der würfelfreien Raumaufnahme ohne Oberfläche: Ein bekannter
 * L-Raum wird aus einem Standpunkt „angezielt" – Ecken, Raumhöhe, Tür,
 * Fenster, Steckdose, Schalter, Deckenleuchte –, mit falsch angenommener
 * Kamerahöhe und leichtem Zittern. `rekonstruiere` muss daraus den Raum
 * zurückgewinnen; ein einziges Bandmaß korrigiert den Maßstab.
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
const H = 2.62, hWahr = 1.38, s = [2.9, 2.5];

let seed = 11;
const zufall = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
/** Blickrichtung vom Auge auf einen Weltpunkt, mit optionalem Zittern (Grad). */
function ziel(p, zittern = 0) {
  const d = [p[0] - s[0], p[1] - s[1], (p[2] ?? 0) - hWahr];
  const l = Math.hypot(...d);
  const alpha = Math.atan2(-d[0] / l, d[1] / l) / Z.GRAD + zittern * zufall();
  const beta = Math.acos(-d[2] / l) / Z.GRAD + zittern * zufall();
  return Z.blickAusEuler(alpha, beta, 0);
}

function aufnahme(zittern, reihenfolge = L) {
  const a = A.neueAufnahme(1.5, "fertig");   // Annahme 1,50 statt 1,38
  a.ecken = reihenfolge.map(p => ({ v: ziel(p, zittern), ebene: "boden" }));
  a.hoehe = { vUnten: ziel(L[1], zittern), vOben: ziel([...L[1], H], zittern) };
  // Tür in der Nordwand (0,4)→(5,4): 0,885 breit ab x=3,40, 2,01 hoch.
  a.oeffnungen.push({ id: "t1", art: "TUER", a: ziel([3.4, 4, 0], zittern), b: ziel([4.285, 4, 2.01], zittern) });
  // Fenster in der Ostwand (5,4)→(5,0): ab 1,00 vom Nordende, 1,20 breit, Brüstung 0,90, Höhe 1,30.
  a.oeffnungen.push({ id: "f1", art: "FENSTER", a: ziel([5, 3.0, 0.9], zittern), b: ziel([5, 1.8, 2.2], zittern) });
  // Steckdose in der Westwand (0,1.5)→(0,4) bei y=2,5, 30 cm hoch; Schalter neben der Tür.
  a.einbauten.push({ id: "e1", art: "STECKDOSE", befestigung: "WAND", v: ziel([0, 2.5, 0.3], zittern) });
  a.einbauten.push({ id: "e2", art: "SCHALTER", befestigung: "WAND", v: ziel([3.2, 4, 1.05], zittern) });
  a.einbauten.push({ id: "e3", art: "LAMPE", befestigung: "DECKE", v: ziel([3.5, 2, H], zittern) });
  return a;
}

/** Erwartung im Raumsystem: dieselbe Abbildung auf die wahren Ecken. */
const wahrRaum = Z.raumAusEcken(L);
const wandMitPunkt = (punkte, q) => {
  const nw = G.naechsteWand({ umriss: G.umrissSchreiben(punkte) }, q[0], q[1]);
  return nw;
};

// --------------------------------------------- 1. exakt, nur Höhe falsch

let a = aufnahme(0);
let r = A.rekonstruiere(a);
wahr("Rekonstruktion vorhanden", !!r);
nah("Fläche skaliert mit (1,50/1,38)²", r.flaecheM2, 17 * (1.5 / hWahr) ** 2, 0.05);
// Ein Bandmaß an der Wand mit 5,00 m korrigiert alles.
const i5 = r.waende.findIndex(w => Math.abs(w.laenge - 5 * 1.5 / hWahr) < 0.03);
wahr("5-m-Wand gefunden", i5 >= 0, JSON.stringify(r.waende.map(w => w.laenge)));
a.bandmasse = { [i5]: 5.0 };
r = A.rekonstruiere(a);
nah("Kamerahöhe kalibriert", r.kamerahoeheM, hWahr, 0.002);
nah("Fläche 17 m²", r.flaecheM2, 17, 0.02);
nah("Raumhöhe 2,62", r.hoeheM, H, 0.01);
wahr("Band-Wand als Bandmaß markiert", r.waende[i5].quelle === "band");
wahr("übrige Wände gezielt", r.waende.filter(w => w.quelle === "gezielt").length === 5);
const laengen = r.waende.map(w => Math.round(w.laenge * 100) / 100).sort((x, y) => x - y);
wahr("Wandlängen 1,5/2/2,5/3/4/5", JSON.stringify(laengen) === JSON.stringify([1.5, 2, 2.5, 3, 4, 5]), JSON.stringify(laengen));

const tuer = r.oeffnungen.find(o => o.id === "t1");
nah("Tür Breite 0,885", tuer.breiteM, 0.885, 0.011);
nah("Tür Höhe 2,01", tuer.hoeheM, 2.01, 0.011);
nah("Tür Brüstung 0", tuer.bruestungM, 0, 1e-9);
nah("Tür liegt an 5-m-Wand", r.waende[tuer.wandIndex].laenge, 5, 0.011);
// Türmitte im Raumsystem dort, wo die wahre Tür liegt.
const tm = wahrRaum.abbildung([3.4 + 0.4425, 4]);
const tw = wandMitPunkt(r.punkte, tm);
wahr("Türmitte auf derselben Wand", tw.index === tuer.wandIndex);
nah("Türmitte Abstand", tuer.abstandM + tuer.breiteM / 2, tw.abstand, 0.015);

const fenster = r.oeffnungen.find(o => o.id === "f1");
nah("Fenster Breite 1,20", fenster.breiteM, 1.2, 0.011);
nah("Fenster Brüstung 0,90", fenster.bruestungM, 0.9, 0.011);
nah("Fenster Höhe 1,30", fenster.hoeheM, 1.3, 0.011);
nah("Fenster an 4-m-Wand", r.waende[fenster.wandIndex].laenge, 4, 0.011);

const dose = r.einbauten.find(e => e.id === "e1");
nah("Steckdose 30 cm hoch", dose.hoeheM, 0.3, 0.011);
nah("Steckdose an 2,5-m-Wand", r.waende[dose.wandIndex].laenge, 2.5, 0.011);
const dw = wandMitPunkt(r.punkte, wahrRaum.abbildung([0, 2.5]));
wahr("Steckdose auf richtiger Wand", dw.index === dose.wandIndex);
nah("Steckdose Abstand", dose.abstandM, dw.abstand, 0.015);
const sch = r.einbauten.find(e => e.id === "e2");
nah("Schalter 1,05 hoch", sch.hoeheM, 1.05, 0.011);
const lampe = r.einbauten.find(e => e.id === "e3");
wahr("Lampe an der Decke", lampe.befestigung === "DECKE");
const lq = wahrRaum.abbildung([3.5, 2]);
nah("Lampe relX", lampe.relX, lq[0] / 5, 0.01);
nah("Lampe relY", lampe.relY, lq[1] / 4, 0.01);

// Umriss-Prüfung des Kerns: keine Auffälligkeiten.
wahr("Umriss ohne Prüfhinweise", G.pruefen(r.punkte).length === 0, G.pruefen(r.punkte).join(" | "));

// ------------------------------------- 2. gegen den Uhrzeigersinn getippt

const gegen = [L[0], ...L.slice(1).reverse()];
const ag = aufnahme(0, gegen);
const rg0 = A.rekonstruiere(ag);
const i5g = rg0.waende.findIndex(w => Math.abs(w.laenge - 5 * 1.5 / hWahr) < 0.03);
ag.bandmasse = { [i5g]: 5.0 };
const rg = A.rekonstruiere(ag);
nah("gegen: Fläche 17", rg.flaecheM2, 17, 0.02);
const tg = rg.oeffnungen.find(o => o.id === "t1");
nah("gegen: Tür an 5-m-Wand", rg.waende[tg.wandIndex].laenge, 5, 0.011);
nah("gegen: Tür Breite", tg.breiteM, 0.885, 0.011);
const dg = rg.einbauten.find(e => e.id === "e1");
nah("gegen: Steckdose an 2,5-m-Wand", rg.waende[dg.wandIndex].laenge, 2.5, 0.011);
// Abstand zählt im Uhrzeigersinn ab Wandanfang: Steckdose sitzt 1,0 m vom Ende (0,1.5)…
const dgw = wandMitPunkt(rg.punkte, Z.raumAusEcken(gegen).abbildung([0, 2.5]));
nah("gegen: Steckdose Abstand konsistent", dg.abstandM, dgw.abstand, 0.015);

// ------------------------------- 3. mit Zittern (±0,3°) und Rechtwinkligkeit

const az = aufnahme(0.3);
const rz0 = A.rekonstruiere(az);
const i5z = rz0.waende.reduce((best, w, i) => Math.abs(w.laenge - 5 * 1.5 / hWahr) < Math.abs(rz0.waende[best].laenge - 5 * 1.5 / hWahr) ? i : best, 0);
az.bandmasse = { [i5z]: 5.0 };
const rz = A.rekonstruiere(az);
wahr("Zittern: alle Ecken rechtwinklig", G.waende(rz.punkte).every(w => Math.abs(Math.abs(w.drehung) - 90) < 0.2));
nah("Zittern: Fläche ±0,4 m²", rz.flaecheM2, 17, 0.4);
nah("Zittern: Restlücke danach 0", rz.restlueckeNachherM, 0, 0.005);
nah("Zittern: Band-Wand exakt", rz.waende[i5z].laenge, 5, 1e-9);
const maxAbw = Math.max(...rz.waende.map((w, i) => {
  const soll = [5, 4, 3, 2.5, 2, 1.5].reduce((b, x) => Math.abs(x - w.laenge) < Math.abs(b - w.laenge) ? x : b, 99);
  return Math.abs(w.laenge - soll);
}));
wahr(`Zittern: jede Wand ±12 cm (max ${(maxAbw * 100).toFixed(1)} cm)`, maxAbw < 0.12);
wahr("Zittern: Fehlerangabe deckt Abweichung", rz.waende.every(w => w.quelle === "band" || w.sigmaM > 0));
const tz = rz.oeffnungen.find(o => o.id === "t1");
nah("Zittern: Tür Breite ±5 cm", tz.breiteM, 0.885, 0.05);
nah("Zittern: Tür Höhe ±6 cm", tz.hoeheM, 2.01, 0.06);

// Zwei Bandmaße → alle gemessenen Wände exakt, Rest geschlossen.
const i4z = rz.waende.findIndex(w => Math.abs(w.laenge - 4) < 0.15);
az.bandmasse = { [i5z]: 5.0, [i4z]: 4.0 };
const rz2 = A.rekonstruiere(az);
nah("zwei Bandmaße: 5,00 exakt", rz2.waende[i5z].laenge, 5, 1e-9);
nah("zwei Bandmaße: 4,00 exakt", rz2.waende[i4z].laenge, 4, 1e-9);
nah("zwei Bandmaße: geschlossen", rz2.restlueckeNachherM, 0, 0.005);

// ------------------------------------------ 4. Kalibrierung über die Tür

const at = aufnahme(0);
at.senkrechte = [{ vUnten: ziel([3.4, 4, 0]), vOben: ziel([3.4, 4, 2.01]), hoeheM: 2.01 }];
const rt = A.rekonstruiere(at);
nah("Tür-Kalibrierung: Kamerahöhe", rt.kamerahoeheM, hWahr, 0.002);
nah("Tür-Kalibrierung: Fläche ohne Bandmaß", rt.flaecheM2, 17, 0.02);

// ---------------------------------------- 5. Estrich: Höhen ab Fertigfußboden

const ae = aufnahme(0);
ae.boden = "roh";
ae.bandmasse = { [i5]: 5.0 };
const re = A.rekonstruiere(ae, { aufbauM: 0.07 });
nah("Estrich: Steckdose 23 cm ab FFB", re.einbauten.find(e => e.id === "e1").hoeheM, 0.23, 0.011);
nah("Estrich: Raumhöhe 2,55 ab FFB", re.hoeheM, 2.55, 0.011);
nah("Estrich: Tür steht trotzdem auf dem Boden", re.oeffnungen.find(o => o.id === "t1").bruestungM, 0, 1e-9);

// ------------------------------------------------------- 6. Grenzfälle

wahr("< 3 Ecken → null", A.rekonstruiere({ ...A.neueAufnahme(), ecken: [{ v: ziel(L[0]) }, { v: ziel(L[1]) }] }) === null);
const af = aufnahme(0);
af.ecken.push({ v: Z.blickAusEuler(0, 89, 0), ebene: "boden" });   // fast waagerecht
const rf = A.rekonstruiere(af);
wahr("flache Ecke ausgelassen + Hinweis", rf.punkte.length === 6 && rf.hinweise.some(h => /ausgelassen/.test(h)), rf.hinweise.join(" | "));
const ab = aufnahme(0);
ab.bandmasse = { [i5]: 5.0, 1: 9.99 };   // grob falsch abgelesen
const rb = A.rekonstruiere(ab);
wahr("widersprüchliches Bandmaß wird gemeldet", rb.hinweise.some(h => /richtig abgelesen/.test(h)), rb.hinweise.join(" | "));
const v = A.vorschau(aufnahme(0));
wahr("Vorschau liefert Ecken", v.punkte.length === 6 && v.laengen.length === 5);

// ------------------------- 7. Maßstab aus Raumhöhe (Laser) oder Türhöhe

const ah = aufnahme(0);
ah.raumhoeheM = H;   // Laser nach oben: 2,62
const rh = A.rekonstruiere(ah);
nah("Raumhöhe als Maßstab: Kamerahöhe", rh.kamerahoeheM, hWahr, 0.002);
nah("Raumhöhe als Maßstab: Fläche", rh.flaecheM2, 17, 0.02);
wahr("Raumhöhe als Maßstab: kalibriert", rh.kalibriert === true);
const ad = aufnahme(0);
ad.oeffnungen[0].hoeheBekanntM = 2.01;
const rd = A.rekonstruiere(ad);
nah("Türhöhe als Maßstab: Fläche", rd.flaecheM2, 17, 0.02);
nah("Türhöhe als Maßstab: Tür 2,01", rd.oeffnungen[0].hoeheM, 2.01, 0.005);
const ohne = A.rekonstruiere(aufnahme(0));
wahr("ohne Maßstab → Hinweis", !ohne.kalibriert && ohne.hinweise.some(t => /Noch kein Maßstab/.test(t)));

console.log(`raumaufnahme.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
