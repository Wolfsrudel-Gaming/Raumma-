/*
 * Parität des Aufmaß-Spiegels (web/geometrie.js) mit dem Kotlin-Kern: dieselben
 * Fälle und Zahlen wie in AufmassTest.kt – Polygonzug, rechtwinklig glätten,
 * Zug ausgleichen.
 *
 * Aufruf: node web/tests/aufmass.test.mjs   (Exitcode != 0 bei Fehler)
 */
import * as G from "../geometrie.js";

let ok = 0, fail = 0;
const nah = (name, got, want, tol = 0.005) => {
  const p = Number.isFinite(got) && Math.abs(got - want) < tol;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want}`); fail++; } else ok++;
};
const gleich = (name, got, want) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  if (!p) { console.error(`FAIL ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); fail++; } else ok++;
};
const W = (laenge, drehung) => ({ laenge, drehung });

// Polygonzug wie im Kern
let z = G.zug([W(6, 90), W(4, 90), W(6, 90), W(4, 90)]);
gleich("Rechteck Ecken", z.punkte, [[0, 0], [6, 0], [6, 4], [0, 4]]);
nah("Rechteck Fläche", G.flaechePunkte(z.punkte), 24);
z = G.zug([W(6, 90), W(2, 90), W(0.8, -90), W(2, 90), W(5.2, 90), W(4, 90)]);
nah("Nische 22,4 m²", G.flaechePunkte(z.punkte), 22.4);
z = G.zug([W(6, 90), W(4, 90), W(6, 90)]);
nah("Schlusswand ergänzt: Restlücke 4", z.restluecke, 4);

// rechtwinklig
const roh = [W(5.02, 88.7), W(3.98, 91.5), W(2.0, 135.0), W(4.97, -89.6), W(4.01, 3.0)];
gleich("rechtwinklig Drehungen", G.rechtwinklig(roh).map(w => w.drehung), [90, 90, 135, -90, 0]);
gleich("rechtwinklig Längen bleiben", G.rechtwinklig(roh).map(w => w.laenge), roh.map(w => w.laenge));
nah("enge Toleranz lässt 91,5°", G.rechtwinklig(roh, 1)[1].drehung, 91.5, 1e-12);

// Ausgleich: Wände 1, 2 gemessen, 3, 4 gezielt
let a = G.ausgleichen([W(6, 90), W(4, 90), W(5.88, 90), W(4.09, 90)], [0, 1]);
nah("Lücke vorher 0,15", a.restlueckeVorher, 0.15);
nah("Lücke nachher 0", a.restlueckeNachher, 0, 1e-9);
nah("Wand 1 fest", a.waende[0].laenge, 6, 1e-12);
nah("Wand 2 fest", a.waende[1].laenge, 4, 1e-12);
nah("Wand 3 → 6,00", a.waende[2].laenge, 6, 1e-9);
nah("Wand 4 → 4,00", a.waende[3].laenge, 4, 1e-9);
nah("Korrektur 3 +0,12", a.korrektur[2], 0.12, 1e-9);
nah("Korrektur 4 −0,09", a.korrektur[3], -0.09, 1e-9);
nah("Zug schließt", G.zug(a.waende).restluecke, 0, 0.02);

// Parallele freie Wände: nur der schließbare Anteil
a = G.ausgleichen([W(6, 90), W(4, 90), W(5.9, 90), W(4.05, 90)], [1, 3]);
nah("parallel Wand 1 → 5,95", a.waende[0].laenge, 5.95, 1e-9);
nah("parallel Wand 3 → 5,95", a.waende[2].laenge, 5.95, 1e-9);
nah("parallel Restlücke 0,05", a.restlueckeNachher, 0.05, 1e-9);

// L-Raum ohne feste Wände
a = G.ausgleichen([W(5.03, 90), W(4.02, 90), W(2.96, 90), W(2.48, -90), W(2.01, 90), W(1.53, 90)]);
nah("L-Raum geschlossen", a.restlueckeNachher, 0, 1e-9);
gleich("L-Raum Korrekturen klein", a.korrektur.every(k => Math.abs(k) < 0.03), true);
nah("L-Raum 15 m²", G.flaechePunkte(G.zug(a.waende).punkte), 15, 0.25);

// Alles fest → nichts zu verteilen, Lücke bleibt sichtbar
a = G.ausgleichen([W(6, 90), W(4, 90), W(5.9, 90), W(4, 90)], [0, 1, 2, 3]);
nah("alles fest → Lücke bleibt", a.restlueckeNachher, 0.1, 1e-9);

console.log(`aufmass.test: ${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
