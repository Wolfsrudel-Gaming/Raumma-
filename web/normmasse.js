/*
 * Normmaße im Browser – Spiegel von `Normmasse.kt`.
 *
 * Übliche Einbauhöhen (DIN 18015-3, DIN 18040) und Öffnungsmaße (DIN 18101).
 * Richtwerte, keine Vorschrift – überall überschreibbar. Kotlin ist verbindlich.
 */

/** Katalog der Einbauarten: Schlüssel → Anzeigename, in Auswahllisten-Reihenfolge. */
export const ARTEN = new Map([
  ["STECKDOSE", "Steckdose"],
  ["STECKDOSE_2FACH", "Steckdose 2-fach"],
  ["STECKDOSE_3FACH", "Steckdose 3-fach"],
  ["STECKDOSE_CEE", "CEE-Steckdose"],
  ["SCHALTER", "Schalter"],
  ["WECHSELSCHALTER", "Wechselschalter"],
  ["KREUZSCHALTER", "Kreuzschalter"],
  ["TASTER", "Taster"],
  ["DIMMER", "Dimmer"],
  ["BEWEGUNGSMELDER", "Bewegungsmelder"],
  ["LAMPE", "Leuchte"],
  ["WANDLEUCHTE", "Wandleuchte"],
  ["NOTLEUCHTE", "Notleuchte / Rettungszeichen"],
  ["NETZWERKDOSE", "Netzwerkdose"],
  ["ANTENNENDOSE", "Antennendose"],
  ["TELEFONDOSE", "Telefondose"],
  ["RAUCHMELDER", "Rauchmelder"],
  ["SICHERUNGSKASTEN", "Verteiler / Sicherungskasten"],
  ["KLIMA", "Klimagerät (Innenteil)"],
  ["HEIZKOERPER", "Heizkörper"],
  ["THERMOSTAT", "Thermostat"],
  ["SANITAER", "Sanitärobjekt"],
  ["KUECHE", "Küchengerät"],
  ["SCHRANK", "Schrank"],
  ["REGAL", "Regal"],
  ["SONSTIGES", "Sonstiges"]
]);

/** Höhe der Mitte über dem Fußboden in Metern; null = an die Decke (Raumhöhe). */
export function hoehe(art) {
  switch (String(art).toUpperCase()) {
    case "STECKDOSE": case "STECKDOSE_2FACH": case "STECKDOSE_3FACH": return 0.30;
    case "STECKDOSE_CEE": return 1.20;
    case "SCHALTER": case "WECHSELSCHALTER": case "KREUZSCHALTER": case "TASTER": case "DIMMER": return 1.05;
    case "THERMOSTAT": return 1.05;
    case "BEWEGUNGSMELDER": return 2.20;
    case "NETZWERKDOSE": case "ANTENNENDOSE": case "TELEFONDOSE": return 0.30;
    case "WANDLEUCHTE": return 2.00;
    case "NOTLEUCHTE": return 2.20;
    case "SICHERUNGSKASTEN": return 1.60;
    case "KLIMA": return 2.20;
    case "SANITAER": return 1.00;
    case "HEIZKOERPER": return 0.45;
    case "RAUCHMELDER": case "LAMPE": return null;
    default: return 1.20;
  }
}

/** Wohin ein Objekt dieser Art normalerweise gehört: WAND, DECKE oder BODEN. */
export function befestigung(art) {
  switch (String(art).toUpperCase()) {
    case "LAMPE": case "RAUCHMELDER": return "DECKE";
    case "SCHRANK": case "REGAL": case "KUECHE": return "BODEN";
    default: return "WAND";
  }
}

/** Breite, Höhe und Brüstung einer Öffnung nach Art. */
export function oeffnung(art) {
  switch (art) {
    case "DURCHGANG": return { breiteM: 1.20, hoeheM: 2.10, bruestungM: 0 };
    case "FENSTER": return { breiteM: 1.20, hoeheM: 1.40, bruestungM: 0.90 };
    case "TOR": return { breiteM: 3.00, hoeheM: 2.50, bruestungM: 0 };
    default: return { breiteM: 0.885, hoeheM: 2.01, bruestungM: 0 };   // TUER
  }
}
