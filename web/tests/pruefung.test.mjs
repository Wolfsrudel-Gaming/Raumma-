/*
 * Prüft, dass der JS-Spiegel der Normprüfung dieselben Zahlen liefert wie der
 * Kotlin-Kern (dessen Werte in PruefungTest.kt festgeschrieben sind). Ohne DOM
 * lauffähig – die geprüften Module sind rein.
 *
 * Aufruf: node web/tests/pruefung.test.mjs   (Exitcode != 0 bei Fehler)
 */
import { pruefe, konservativ, grundriss } from "../pruefung.js";
import { finde } from "../komponenten.js";

let ok = 0, fail = 0;
const eq = (name, got, want) => {
  const p = (typeof got === "number" && typeof want === "number") ? Math.abs(got - want) < 1e-9 : got === want;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want}`); fail++; } else ok++;
};

// Konservative untere Schranke
eq("konservativ(2.80)", konservativ(2.80), 2.78);
eq("konservativ(1.209)", konservativ(1.209), 1.18);
eq("konservativ(0.01)", konservativ(0.01), 0.0);

// Grundfläche eines Klötzchens = Katalogmaße
const raum = { id: "r", breiteM: 4, tiefeM: 3, hoeheM: 2.5 };
const phZ = { id: "z", komponente: "ZAEHLERSCHRANK", xM: 2.0, yM: 2.9, drehungGrad: 180 };
const e = grundriss(phZ, finde("ZAEHLERSCHRANK"));
eq("grundriss breite", Math.round(Math.abs(e[1][0] - e[0][0]) * 100) / 100, 0.6);
eq("grundriss tiefe", Math.round(Math.abs(e[2][1] - e[1][1]) * 100) / 100, 0.2);

// Genug Platz -> OK
let b = pruefe(raum, [phZ]).find(x => x.regelId === "BEDIENBEREICH_VERTEILUNG");
eq("bedien OK", b.schwere, "OK");
eq("bedien verf 2.78", b.verfuegbarM, 2.78);

// Flacher Raum -> Warnung
const raum2 = { id: "r2", breiteM: 4, tiefeM: 1.2, hoeheM: 2.5 };
const phZ2 = { id: "z2", komponente: "ZAEHLERSCHRANK", xM: 2.0, yM: 1.1, drehungGrad: 180 };
b = pruefe(raum2, [phZ2]).find(x => x.regelId === "BEDIENBEREICH_VERTEILUNG");
eq("flach WARNUNG", b.schwere, "WARNUNG");
eq("flach verf 0.98", b.verfuegbarM, 0.98);

// Wärmequelle zu nah
const therme = { id: "t", komponente: "THERME", xM: 1.0, yM: 1.0, drehungGrad: 0 };
const schrank = { id: "s", komponente: "SCHALTSCHRANK", xM: 1.7, yM: 1.0, drehungGrad: 0 };
b = pruefe(raum, [therme, schrank]).find(x => x.regelId === "ABSTAND_WAERMEQUELLE");
eq("waerme WARNUNG", b.schwere, "WARNUNG");
eq("waerme text Schaltschrank", b.text.includes("Schaltschrank"), true);

// Biegeradius-Hinweis
const kabel = { id: "k", komponente: "KABEL_NYM5", xM: 2, yM: 1.5, drehungGrad: 0 };
b = pruefe(raum, [kabel]).find(x => x.regelId === "BIEGERADIUS");
eq("biegeradius HINWEIS", b.schwere, "HINWEIS");
eq("biegeradius 195mm", b.text.includes("195 mm"), true);

// Unbekannte Komponente -> übersprungen
eq("unbekannt leer", pruefe(raum, [{ id: "x", komponente: "GIBTESNICHT", xM: 2, yM: 1.5 }]).length, 0);

console.log(`pruefung.test: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
