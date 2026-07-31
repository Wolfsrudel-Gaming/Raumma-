/*
 * Projektzustand des RAUMWERK-Planungswerkzeugs.
 *
 * Modell des Konzepts: Der **gemessene Raum** (Umriss, Öffnungen, Einbauten)
 * ist die Wirklichkeit und wird über alle Varianten geteilt. Eine **Variante**
 * ist ein durchgespieltes Szenario – sie unterscheidet sich nur in der
 * Anordnung der Klötzchen ([platzhalter]). Genau das ist „Alternativen
 * durchspielen, ohne ein zweites Mal anzureisen".
 *
 * Persistenz: localStorage. Kein Server nötig, damit das Werkzeug auch offline
 * und als reiner Kundenlink funktioniert. Die Form entspricht dem Datenmodell
 * des Kerns (deutsche Feldnamen), sodass ein späteres Backend sie 1:1 speichern
 * kann.
 */

const SCHLUESSEL = "raumwerk.projekt.v1";

let id = 0;
/** Kurze, stabile ID – reicht fürs Frontend; das Backend vergibt UUIDs. */
export function neueId(praefix = "id") {
  return `${praefix}-${Date.now().toString(36)}-${(id++).toString(36)}`;
}

/** Ein frisches Beispielprojekt: ein Technikraum, an dem sich alles zeigt. */
export function beispielProjekt() {
  const raumId = neueId("raum");
  return {
    name: "Technikraum (Beispiel)",
    raum: {
      id: raumId, name: "Technikraum", nummer: "T.01", geschoss: 0,
      breiteM: 4.2, breiteVorneM: null, tiefeM: 3.0, schraege: "KEINE",
      umriss: "", hoeheM: 2.5, xM: 0, yM: 0, drehungGrad: 0,
      farbe: "#cfe8e9", notiz: ""
    },
    oeffnungen: [
      { id: neueId("oef"), raumId, art: "TUER", bezeichnung: "Zugang",
        wandIndex: 0, abstandM: 1.6, breiteM: 0.885, hoeheM: 2.01, bruestungM: 0 }
    ],
    einbauten: [
      { id: neueId("ein"), raumId, art: "LAMPE", befestigung: "DECKE",
        relX: 0.5, relY: 0.5, hoeheM: 2.5 },
      { id: neueId("ein"), raumId, art: "SCHALTER", befestigung: "WAND",
        wandIndex: 0, abstandM: 2.6, hoeheM: 1.05 }
    ],
    varianten: [
      { id: neueId("var"), name: "Variante A", platzhalter: [
        { id: neueId("ph"), raumId, komponente: "ZAEHLERSCHRANK",
          xM: 0.9, yM: 2.9, drehungGrad: 180, bezeichnung: "" },
        { id: neueId("ph"), raumId, komponente: "VERTEILERSCHRANK",
          xM: 2.0, yM: 2.875, drehungGrad: 180, bezeichnung: "" }
      ] }
    ],
    aktiveVariante: 0
  };
}

/** Lädt das Projekt aus localStorage oder legt das Beispiel an. */
export function laden() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (roh) return migriere(JSON.parse(roh));
  } catch (_) { /* fällt auf das Beispiel zurück */ }
  return beispielProjekt();
}

/** Speichert das Projekt. Wird nach jeder Änderung aufgerufen. */
export function speichern(projekt) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(projekt));
  } catch (_) { /* Speicher voll o. Ä. – der Zustand bleibt im RAM erhalten */ }
}

/** Übernimmt ein eingelesenes Projekt (Import) und füllt fehlende Felder auf. */
export function ausObjekt(o) { return migriere(o); }

/** Nachsichtig: fehlende Felder auffüllen, damit ein alter Stand nicht bricht. */
function migriere(p) {
  if (!p.raum) return beispielProjekt();
  p.oeffnungen ??= [];
  p.einbauten ??= [];
  p.varianten ??= [{ id: neueId("var"), name: "Variante A", platzhalter: [] }];
  p.aktiveVariante ??= 0;
  if (p.aktiveVariante >= p.varianten.length) p.aktiveVariante = 0;
  return p;
}

// --------------------------------------------------------- Varianten

export function aktiveVariante(p) {
  return p.varianten[p.aktiveVariante];
}

export function platzhalter(p) {
  return aktiveVariante(p).platzhalter;
}

/** Neue Variante aus der aktiven kopieren – der übliche Weg, ein „Was wäre wenn". */
export function varianteKlonen(p, name) {
  const quelle = aktiveVariante(p);
  const kopie = {
    id: neueId("var"), name: name || `${quelle.name} (Kopie)`,
    platzhalter: quelle.platzhalter.map(ph => ({ ...ph, id: neueId("ph") }))
  };
  p.varianten.push(kopie);
  p.aktiveVariante = p.varianten.length - 1;
  return kopie;
}

export function varianteNeu(p, name) {
  const v = { id: neueId("var"), name: name || `Variante ${p.varianten.length + 1}`, platzhalter: [] };
  p.varianten.push(v);
  p.aktiveVariante = p.varianten.length - 1;
  return v;
}

export function varianteLoeschen(p, index) {
  if (p.varianten.length <= 1) return false;   // die letzte bleibt
  p.varianten.splice(index, 1);
  if (p.aktiveVariante >= p.varianten.length) p.aktiveVariante = p.varianten.length - 1;
  return true;
}
