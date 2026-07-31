/*
 * Komponenten-Datenbank im Browser – Spiegel von `Komponente.kt`.
 *
 * Die parametrischen „Klötzchen" mit echten Baumaßen. Regel bei Änderungen wie
 * bei der Geometrie: Kotlin ist verbindlich, diese Datei folgt. Maße in Metern,
 * Kabel-/Rohrdurchmesser in Millimetern.
 */

/** Fachliche Klasse – entscheidet, welche Regeln greifen. */
export const Kategorie = {
  VERTEILUNG: "VERTEILUNG",
  SCHRANK: "SCHRANK",
  GERAET: "GERAET",
  WAERMEQUELLE: "WAERMEQUELLE",
  KABEL: "KABEL",
  ROHR: "ROHR",
  SONSTIGES: "SONSTIGES"
};

function k(schluessel, name, kategorie, breiteM, tiefeM, hoeheM, bedienseiteVorn = true, aussenDurchmesserMm = null) {
  return { schluessel, name, kategorie, breiteM, tiefeM, hoeheM, bedienseiteVorn, aussenDurchmesserMm };
}

/** Der mitgelieferte Katalog. Ergänzen = eine Zeile hinzufügen. */
export const KATALOG = [
  k("ZAEHLERSCHRANK", "Zählerschrank", Kategorie.VERTEILUNG, 0.60, 0.20, 1.50),
  k("VERTEILERSCHRANK", "Verteilerschrank (UV)", Kategorie.VERTEILUNG, 0.80, 0.25, 2.00),
  k("HAUPTVERTEILUNG", "Hauptverteilung (NSHV)", Kategorie.VERTEILUNG, 1.20, 0.40, 2.00),
  k("AP_VERTEILER", "Aufputz-Kleinverteiler", Kategorie.VERTEILUNG, 0.40, 0.12, 0.60),
  k("SCHALTSCHRANK", "Schaltschrank", Kategorie.SCHRANK, 0.80, 0.40, 2.00),
  k("SERVERSCHRANK", "19\"-Serverschrank", Kategorie.SCHRANK, 0.60, 0.80, 2.00),
  k("BATTERIESCHRANK", "Batterieschrank", Kategorie.SCHRANK, 0.60, 0.60, 1.80),
  k("USV", "USV-Anlage", Kategorie.GERAET, 0.50, 0.70, 1.20),
  k("LADEGERAET", "Wallbox / Ladegerät", Kategorie.GERAET, 0.35, 0.15, 0.50),
  k("KLIMA_INNEN", "Klima-Innengerät", Kategorie.GERAET, 0.90, 0.20, 0.30, false),
  k("THERME", "Heiztherme", Kategorie.WAERMEQUELLE, 0.45, 0.35, 0.80),
  k("WARMWASSER", "Warmwasserspeicher", Kategorie.WAERMEQUELLE, 0.60, 0.60, 1.60),
  k("KABEL_NYM5", "Kabel NYM-J 5×2,5", Kategorie.KABEL, 0.02, 0.02, 0.02, true, 13),
  k("KABEL_NYM3", "Kabel NYM-J 3×1,5", Kategorie.KABEL, 0.01, 0.01, 0.01, true, 9.5),
  k("LEERROHR_M25", "Leerrohr M25", Kategorie.ROHR, 0.03, 0.03, 0.03, true, 25),
  k("LEERROHR_M20", "Leerrohr M20", Kategorie.ROHR, 0.02, 0.02, 0.02, true, 20)
];

const NACH_SCHLUESSEL = new Map(KATALOG.map(c => [c.schluessel, c]));

/** Nachschlagen; unbekannter Schlüssel → undefined. */
export function finde(schluessel) {
  return NACH_SCHLUESSEL.get(schluessel);
}
