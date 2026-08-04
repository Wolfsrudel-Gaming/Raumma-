/*
 * Prüft die Geometrie der Raum-Verbindungen (Türen/Durchgänge): Nachbarschaft
 * erkennen und deckungsgleiche Öffnungen ableiten.
 *
 * Aufruf: node web/tests/verbindung.test.mjs
 */
import { angrenzung, oeffnungen, marke, nachbarn } from "../raumwerk/verbindung.js";

let ok = 0, fail = 0;
const eq = (name, got, want) => {
  const p = JSON.stringify(got) === JSON.stringify(want) || (typeof got === "number" && Math.abs(got - want) < 1e-9);
  if (!p) { console.error(`FAIL ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); fail++; } else ok++;
};

const A = { id: "a", geschoss: 0, xM: 0, yM: 0, breiteM: 4.2, tiefeM: 3.0, drehungGrad: 0 };
const B = { id: "b", geschoss: 0, xM: 4.2, yM: 0, breiteM: 2.5, tiefeM: 3.0, drehungGrad: 0 };
const C = { id: "c", geschoss: 0, xM: 10, yM: 0, breiteM: 2.0, tiefeM: 2.0, drehungGrad: 0 };

const g = angrenzung(A, B);
eq("seite rechts", g.seite, "rechts");
eq("cx 4.2", g.cx, 4.2);
eq("cy 1.5", g.cy, 1.5);
eq("laenge 3", g.laenge, 3);
eq("kein Nachbar C", angrenzung(A, C), null);
eq("nachbarn zählt B", nachbarn(A, [B, C]).length, 1);

const v = { id: "v1", raumA: "a", raumB: "b", art: "DURCHGANG", breiteM: 0.9 };
const oo = oeffnungen(v, [A, B]);
eq("zwei Öffnungen", oo.length, 2);
eq("A wandIndex 1", oo[0].wandIndex, 1);
eq("A abstand 1.05", oo[0].abstandM, 1.05);
eq("B wandIndex 3", oo[1].wandIndex, 3);
eq("B abstand 1.05", oo[1].abstandM, 1.05);
eq("gleiche Breite", oo[0].breiteM, 0.9);

const m = marke(v, [A, B]);
eq("marke cx 4.2", m.cx, 4.2);
eq("marke senkrecht", m.senkrecht, true);

console.log(`verbindung.test: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
