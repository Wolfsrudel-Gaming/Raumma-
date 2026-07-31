/*
 * Schaltzeichen für den Grundriss.
 *
 * Im Plan stehen keine Bildchen, sondern Zeichen: ein Halbkreis mit Stiel ist
 * eine Steckdose, ein Kreis mit Kreuz eine Leuchte. Die Formen folgen der
 * üblichen Installationsplan-Darstellung (DIN EN 60617-11, DIN 18015-3).
 *
 * Zwei Eigenheiten technischer Zeichnungen sind bewusst übernommen:
 *  * Symbole werden **nicht maßstäblich** gezeichnet. Eine Steckdose ist
 *    10 cm breit – im Maßstab wäre sie ein Punkt. Sie bekommt deshalb eine
 *    feste, lesbare Größe in Bildpunkten.
 *  * Sie werden zur Wand gedreht, damit erkennbar bleibt, an welcher Wand das
 *    Gerät sitzt. Gezeichnet sind sie „nach oben aufragend"; wer sie um die
 *    Wandrichtung **plus 180°** dreht, bekommt sie mit der flachen Seite an
 *    der Wand und dem Rest im Raum.
 *
 * Jede Funktion liefert SVG-Text um den Ursprung. Einfügen etwa so:
 *   `<g transform="translate(x y) rotate(winkel)">${fixtureSymbol(art)}</g>`
 *
 * Neue Art ergänzen: einen `case` hinzufügen und die Art in den Katalog
 * (`Normmasse.arten`) aufnehmen. Fehlt ein Zeichen, kommt ein neutrales
 * Quadrat – nichts bricht.
 */

export const SYM_R = 9;          // Grundgröße eines Symbols in Bildpunkten

/** Bausteine, aus denen die Zeichen zusammengesetzt sind. */
function symHalbkreis(gefuellt) {
  return `<path d="M ${-SYM_R} 0 A ${SYM_R} ${SYM_R} 0 0 1 ${SYM_R} 0 Z"
    fill="${gefuellt ? "#1d2a2a" : "#fff"}" stroke="#1d2a2a" stroke-width="1.4"/>`;
}
function symKreis(r) {
  return `<circle cx="0" cy="0" r="${r || SYM_R}" fill="#fff" stroke="#1d2a2a" stroke-width="1.4"/>`;
}
function symLinie(x1, y1, x2, y2, dick) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
    stroke="#1d2a2a" stroke-width="${dick || 1.4}" stroke-linecap="round"/>`;
}
function symText(t) {
  return `<text x="0" y="${SYM_R + 9}" font-size="8" text-anchor="middle" fill="#1d2a2a">${t}</text>`;
}

/**
 * Das Zeichen einer Objektart, gezeichnet um den Ursprung.
 * Der Aufrufer verschiebt und dreht es an seinen Platz.
 */
export function fixtureSymbol(typ) {
  const steckdose = n => symHalbkreis(false) + symLinie(0, 0, 0, -SYM_R - 5) +
    (n > 1 ? symLinie(-4, -SYM_R - 2, 4, -SYM_R - 2) : "") +
    (n > 2 ? symLinie(-4, -SYM_R - 5, 4, -SYM_R - 5) : "");
  // Schalter: Kreis mit Hebel – die Zahl der Striche unterscheidet die Art.
  const schalter = (extra) => symKreis(5) + symLinie(0, -5, 7, -13) + (extra || "");
  switch (typ) {
    case "STECKDOSE": return steckdose(1);
    case "STECKDOSE_2FACH": return steckdose(2);
    case "STECKDOSE_3FACH": return steckdose(3);
    case "STECKDOSE_CEE": return symHalbkreis(false) + symLinie(0, 0, 0, -SYM_R - 5) + symText("CEE");
    case "SCHALTER": return schalter();
    case "WECHSELSCHALTER": return schalter(symLinie(-2, -7, 5, -14));
    case "KREUZSCHALTER": return schalter(symLinie(-7, -13, 0, -5) + symLinie(-2, -7, 5, -14));
    case "TASTER": return schalter() + `<circle cx="7" cy="-13" r="2.2" fill="#1d2a2a"/>`;
    case "DIMMER": return schalter() +
      `<path d="M -9 6 L 9 6 L 9 1 Z" fill="#1d2a2a"/>`;
    case "BEWEGUNGSMELDER": return symKreis(6) +
      `<path d="M -10 4 A 11 11 0 0 1 10 4" fill="none" stroke="#1d2a2a" stroke-width="1.2"/>` +
      symText("BM");
    case "LAMPE": return symKreis() + symLinie(-6.5, -6.5, 6.5, 6.5) + symLinie(-6.5, 6.5, 6.5, -6.5);
    case "WANDLEUCHTE": return symHalbkreis(false) + symLinie(-6, -6, 6, -6) +
      symLinie(-4, 0, 4, 0);
    case "NOTLEUCHTE": return symKreis() + symLinie(-6.5, -6.5, 6.5, 6.5) +
      symLinie(-6.5, 6.5, 6.5, -6.5) + symText("NOT");
    case "NETZWERKDOSE": return symHalbkreis(false) + symLinie(0, 0, 0, -SYM_R - 5) + symText("EDV");
    case "ANTENNENDOSE": return symHalbkreis(false) + symLinie(0, -2, 0, -14) +
      symLinie(-5, -14, 5, -14) + symText("TV");
    case "TELEFONDOSE": return symHalbkreis(false) + symLinie(0, 0, 0, -SYM_R - 5) + symText("Tel");
    case "RAUCHMELDER": return symKreis() + `<circle cx="0" cy="0" r="3" fill="#1d2a2a"/>` + symText("RM");
    case "SICHERUNGSKASTEN": return `<rect x="-12" y="-8" width="24" height="16" fill="#fff"
        stroke="#1d2a2a" stroke-width="1.6"/>` + symLinie(-12, 8, 12, -8, 1) + symText("UV");
    case "KLIMA": return `<rect x="-13" y="-6" width="26" height="12" rx="3" fill="#fff"
        stroke="#1d2a2a" stroke-width="1.4"/>` + symLinie(-8, 2, 8, 2, 1);
    case "HEIZKOERPER": return `<rect x="-14" y="-6" width="28" height="12" fill="#fff"
        stroke="#1d2a2a" stroke-width="1.4"/>` +
      [-8, -4, 0, 4, 8].map(x => symLinie(x, -6, x, 6, 1)).join("");
    case "THERMOSTAT": return symKreis(7) + symText("T");
    case "SANITAER": return symKreis(8) + symLinie(0, -8, 0, 8, 1);
    default: return `<rect x="-8" y="-8" width="16" height="16" fill="#fff"
      stroke="#1d2a2a" stroke-width="1.4"/>`;
  }
}

/**
 * Öffnungen im Grundriss: Die Wandlinie bekommt eine Lücke, und in die Lücke
 * kommt das übliche Zeichen – bei der Tür der Flügel mit Aufschlagbogen
 * (DIN 1356-1), beim Fenster die doppelte Linie.
 */
export function openingSymbol(typ, laenge) {
  const l = Math.max(6, laenge);
  if (typ === "FENSTER") {
    return symLinie(-l / 2, -2, l / 2, -2, 1.2) + symLinie(-l / 2, 2, l / 2, 2, 1.2);
  }
  if (typ === "DURCHGANG") return "";        // nur die Lücke
  if (typ === "TOR") {
    return symLinie(-l / 2, 0, l / 2, 0, 1.2) +
      symLinie(-l / 2, -3, l / 2, 3, 1);
  }
  // Tür: Flügel senkrecht zur Wand, dazu der Bogen, den er überstreicht.
  return symLinie(-l / 2, 0, -l / 2, -l, 1.6) +
    `<path d="M ${-l / 2} ${-l} A ${l} ${l} 0 0 1 ${l / 2} 0" fill="none"
       stroke="#1d2a2a" stroke-width="1" stroke-dasharray="3 2"/>`;
}

