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

// ---- L-Raum (freier Umriss) neben Rechtecken: die echte Wand zählt, nicht der Kasten.
// L: (0,0)→(5,0)→(5,4)→(2,4)→(2,1.5)→(0,1.5); Wände 0 oben, 1 rechts, 2 unten,
// 3 innen senkrecht, 4 innen waagerecht, 5 links.
const L = { id: "l", geschoss: 0, xM: 0, yM: 0, drehungGrad: 0, breiteM: 5, tiefeM: 4,
  umriss: JSON.stringify([[0, 0], [5, 0], [5, 4], [2, 4], [2, 1.5], [0, 1.5]]) };

// Rechteck in der Nische (x 0…2, y 1.5…4): teilt Wand 3 (2,5 m) und Wand 4 (2 m) – die längere gewinnt.
const N = { id: "n", geschoss: 0, xM: 0, yM: 1.5, breiteM: 2, tiefeM: 2.5, drehungGrad: 0 };
const gn = angrenzung(L, N);
eq("Nische: Wand des L", gn.wandA, 3);
eq("Nische: Wand des Rechtecks", gn.wandB, 1);
eq("Nische: Länge 2,5", gn.laenge, 2.5);
eq("Nische: Seite aus Sicht L", gn.seite, "links");
eq("Nische: cx", gn.cx, 2);
eq("Nische: cy", gn.cy, 2.75);
const on = oeffnungen({ id: "vn", raumA: "l", raumB: "n", art: "TUER", breiteM: 0.9 }, [L, N]);
eq("Nische: L-Öffnung Wand 3", on[0].wandIndex, 3);
eq("Nische: L-Öffnung Abstand", on[0].abstandM, 0.8);
eq("Nische: Rechteck-Öffnung Wand 1", on[1].wandIndex, 1);
eq("Nische: Rechteck-Öffnung Abstand", on[1].abstandM, 0.8);
// Umgekehrt angefragt: dieselbe Stelle.
const nl = angrenzung(N, L);
eq("Nische rückwärts: Wand des Rechtecks", nl.wandA, 1);
eq("Nische rückwärts: Wand des L", nl.wandB, 3);
eq("Nische rückwärts: Seite", nl.seite, "rechts");

// Rechteck unter dem kurzen Unterschenkel (x 2…5, y 4…6): Wand 2 des L.
const U = { id: "u", geschoss: 0, xM: 2, yM: 4, breiteM: 3, tiefeM: 2, drehungGrad: 0 };
const gu = angrenzung(L, U);
eq("unten: Wand 2 des L", gu.wandA, 2);
eq("unten: Wand 0 des Rechtecks", gu.wandB, 0);
eq("unten: Seite", gu.seite, "unten");
const ou = oeffnungen({ id: "vu", raumA: "l", raumB: "u", art: "DURCHGANG", breiteM: 0.9 }, [L, U]);
eq("unten: L Abstand 1.05 (ab Ecke 5,4)", ou[0].abstandM, 1.05);
eq("unten: Rechteck Abstand 1.05 (ab Ecke 2,4)", ou[1].abstandM, 1.05);
eq("unten: marke waagerecht", marke({ id: "vu", raumA: "l", raumB: "u", breiteM: 0.9 }, [L, U]).senkrecht, false);

// Der alte Kasten-Test hätte hier eine Nachbarschaft gesehen: Rechteck rechts
// unterhalb der Nische, das nur die Ecke (2,4) berührt – keine gemeinsame Wand.
const E = { id: "e", geschoss: 0, xM: 0, yM: 4, breiteM: 1.9, tiefeM: 2, drehungGrad: 0 };
eq("nur Ecke/Kasten: kein Nachbar", angrenzung(L, E), null);

// Rechts neben dem L, versetzt: Überlappung y 2…4 auf Wand 1.
const R = { id: "r", geschoss: 0, xM: 5.1, yM: 2, breiteM: 3, tiefeM: 3, drehungGrad: 0 };
const gr = angrenzung(L, R);
eq("rechts mit Fuge 10 cm: Wand 1", gr.wandA, 1);
eq("rechts mit Fuge: Wand 3 des Rechtecks", gr.wandB, 3);
eq("rechts mit Fuge: Länge 2", gr.laenge, 2);
eq("rechts mit Fuge: cy 3", gr.cy, 3);

// Gedrehte Räume werden ehrlich ausgelassen, andere Geschosse auch.
eq("gedreht: kein Nachbar", angrenzung(L, { ...N, drehungGrad: 15 }), null);
eq("anderes Geschoss: kein Nachbar", angrenzung(L, { ...N, geschoss: 1 }), null);
// Zu kurze Berührung (< 60 cm) zählt nicht.
eq("zu kurz: kein Nachbar", angrenzung(L, { id: "k", geschoss: 0, xM: 4.5, yM: 4, breiteM: 3, tiefeM: 2, drehungGrad: 0 }), null);
// Getrennte Verbindung → keine Öffnungen, keine Marke.
eq("getrennt: keine Öffnungen", oeffnungen({ id: "vx", raumA: "l", raumB: "c", art: "TUER" }, [L, C]).length, 0);

console.log(`verbindung.test: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
