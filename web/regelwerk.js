/*
 * Regelwerk im Browser – Spiegel von `Regelwerk.kt`.
 *
 * Die versionierte Normbasis (Konzept §8). Werte sind konservative Richtwerte
 * mit Quellenangabe und einzeln austauschbar. Kotlin ist verbindlich.
 */

import { Kategorie } from "./komponenten.js";

/** In welche Richtung ein geforderter Freiraum gilt. */
export const Richtung = { VORNE: "VORNE", RUNDUM: "RUNDUM" };

/** Fassung der Regelbasis – wandert in jeden Befund. */
export const VERSION = "2026.07";

function regel(id, titel, kategorie, richtung, abstandM, quelle, hinweis = "") {
  return { id, titel, kategorie, richtung, abstandM, quelle, hinweis };
}

export const REGELN = [
  regel(
    "BEDIENBEREICH_VERTEILUNG", "Bedien- und Arbeitsbereich vor Verteilungen",
    Kategorie.VERTEILUNG, Richtung.VORNE, 1.20,
    "DIN VDE 0100-729 / DGUV Information 203-077",
    "Freier Bedienbereich vor Niederspannungs-Schaltgerätekombinationen."
  ),
  regel(
    "GANGBREITE_SCHRANK", "Zugang / Gangbreite vor Schränken",
    Kategorie.SCHRANK, Richtung.VORNE, 0.80,
    "ASR A1.8 / DIN VDE 0100-729",
    "Mindestbreite eines Verkehrswegs zur Bedienung und Wartung."
  ),
  regel(
    "WARTUNG_GERAET", "Wartungsfreiraum vor Geräten",
    Kategorie.GERAET, Richtung.VORNE, 0.50,
    "Herstellervorgabe (Richtwert)",
    "Zugang für Bedienung und Instandhaltung."
  ),
  regel(
    "ABSTAND_WAERMEQUELLE", "Mindestabstand zu Wärmequellen",
    Kategorie.WAERMEQUELLE, Richtung.RUNDUM, 0.30,
    "Herstellervorgabe / Brandschutz (Richtwert)",
    "Abstand wärmeabgebender Geräte zu anderen Bauteilen."
  )
];

/** Die Regeln, die für eine Kategorie gelten. */
export function fuer(kategorie) {
  return REGELN.filter(r => r.kategorie === kategorie);
}

/** Faktor Biegeradius ÷ Außendurchmesser (Kabel 15×, Rohr 6×). */
export function biegeradiusFaktor(kategorie) {
  if (kategorie === Kategorie.KABEL) return 15;
  if (kategorie === Kategorie.ROHR) return 6;
  return null;
}

/** Mindestbiegeradius in Millimetern, oder null. */
export function biegeradiusMm(kategorie, aussenDMm) {
  const faktor = biegeradiusFaktor(kategorie);
  if (faktor == null || aussenDMm == null) return null;
  return Math.round(aussenDMm * faktor);
}
