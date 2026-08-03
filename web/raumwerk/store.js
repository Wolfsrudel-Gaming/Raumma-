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

/**
 * Ein Beispiel-„Typenschild" als eingebettetes SVG – steht für ein echtes
 * Vor-Ort-Foto, damit die Foto-Funktion ohne Datei sofort sichtbar ist.
 */
const BEISPIEL_FOTO = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='380' height='240'>
    <rect width='380' height='240' fill='#1c2b30'/>
    <rect x='22' y='22' width='336' height='196' rx='8' fill='#c9ccce' stroke='#6b7378' stroke-width='3'/>
    <text x='40' y='58' font-family='sans-serif' font-size='19' font-weight='700' fill='#20303a'>TYPENSCHILD (Beispiel)</text>
    <line x1='40' y1='70' x2='340' y2='70' stroke='#8a9296' stroke-width='2'/>
    <text x='40' y='100' font-family='sans-serif' font-size='15' fill='#2a3a40'>Hersteller: Muster-Elektro GmbH</text>
    <text x='40' y='126' font-family='sans-serif' font-size='15' fill='#2a3a40'>Typ: UV-3R · Verteiler 3-reihig</text>
    <text x='40' y='152' font-family='sans-serif' font-size='15' fill='#2a3a40'>Nennstrom: In 63 A · 400/230 V</text>
    <text x='40' y='178' font-family='sans-serif' font-size='15' fill='#2a3a40'>Schutzart: IP44 · Baujahr 2019</text>
    <text x='40' y='202' font-family='sans-serif' font-size='12' fill='#5a6a70'>(Platzhalter – vor Ort das echte Foto)</text>
  </svg>`);

/** Ein frisches Beispielprojekt: ein Technikraum mit Nachbarraum. */
export function beispielProjekt() {
  const raumId = neueId("raum");
  const lagerId = neueId("raum");
  return {
    name: "Technikraum (Beispiel)",
    raeume: [
      {
        id: raumId, name: "Technikraum", nummer: "T.01", geschoss: 0,
        breiteM: 4.2, breiteVorneM: null, tiefeM: 3.0, schraege: "KEINE",
        umriss: "", hoeheM: 2.5, xM: 0, yM: 0, drehungGrad: 0,
        farbe: "#cfe8e9", notiz: ""
      },
      {
        id: lagerId, name: "Lager", nummer: "T.02", geschoss: 0,
        breiteM: 2.5, breiteVorneM: null, tiefeM: 3.0, schraege: "KEINE",
        umriss: "", hoeheM: 2.5, xM: 4.2, yM: 0, drehungGrad: 0,
        farbe: "#e6d8b5", notiz: ""
      }
    ],
    aktiverRaum: raumId,
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
    fotos: [
      { id: neueId("foto"), raumId, relX: 0.28, relY: 0.9, titel: "Zählerschrank – Typenschild",
        datenUrl: BEISPIEL_FOTO, notiz: "Zählernummer und Nennstrom ablesbar." }
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

/**
 * Speichert das Projekt. Gibt `false` zurück, wenn der Speicher voll ist
 * (z. B. zu viele Fotos) – dann bleibt der Stand im RAM, und die App weist auf
 * den Export hin.
 */
export function speichern(projekt) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(projekt));
    return true;
  } catch (_) {
    return false;
  }
}

/** Übernimmt ein eingelesenes Projekt (Import) und füllt fehlende Felder auf. */
export function ausObjekt(o) { return migriere(o); }

/** Nachsichtig: fehlende Felder auffüllen, damit ein alter Stand nicht bricht. */
function migriere(p) {
  // Einzelraum-Projekte (alter Stand) auf die Räume-Liste heben.
  if (p.raum && !p.raeume) { p.raeume = [p.raum]; delete p.raum; }
  if (!p.raeume || !p.raeume.length) return beispielProjekt();
  p.aktiverRaum ??= p.raeume[0].id;
  if (!p.raeume.some(r => r.id === p.aktiverRaum)) p.aktiverRaum = p.raeume[0].id;
  p.oeffnungen ??= [];
  p.einbauten ??= [];
  p.fotos ??= [];
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
