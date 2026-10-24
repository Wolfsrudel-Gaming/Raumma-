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
 *
 * Fremde Daten: Ein importiertes Projekt (oder ein manipulierter Speicher-
 * stand) ist Eingabe von außen. `bereinigen` bringt jedes Feld in seine
 * erwartete Form – IDs, Farben, Kürzel, Zahlen, Bild-URLs –, bevor irgendetwas
 * davon in Plan, Listen oder Bericht landet. `ausObjektStreng` lehnt eine
 * unbrauchbare Datei mit Begründung ab, statt das Projekt still durch das
 * Beispiel zu ersetzen.
 */

import { umrissLesen } from "../geometrie.js";

const SCHLUESSEL = "raumwerk.projekt.v1";
const SCHLUESSEL_VORHER = SCHLUESSEL + ".vorher";   // Stand vor dem letzten Ersetzen
const SCHLUESSEL_DEFEKT = SCHLUESSEL + ".defekt";   // unlesbarer Speicherstand (zur Rettung)

/**
 * Ab dieser Projektgröße (Zeichen ≈ Bytes) sollte die Oberfläche zum Export
 * raten – localStorage fasst je nach Browser etwa 5 MB.
 */
export const SPEICHER_WARNGRENZE = 3.5e6;

let id = 0;
/** Kurze, stabile ID – reicht fürs Frontend; das Backend vergibt UUIDs. */
export function neueId(praefix = "id") {
  return `${praefix}-${Date.now().toString(36)}-${(id++).toString(36)}`;
}

/**
 * Ein Beispiel-„Typenschild" als eingebettetes PNG (380 × 240, gerastert aus
 * einer Vektorzeichnung) – steht für ein echtes Vor-Ort-Foto, damit die
 * Foto-Funktion ohne Datei sofort sichtbar ist. Bewusst ein Rasterbild: Plan,
 * Handy-App und Bericht zeigen nur PNG/JPEG/WebP/GIF.
 */
const BEISPIEL_FOTO = "data:image/png;base64," + [
  "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"
].join("");

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
        umriss: "", hoeheM: 2.5, aufbauM: 0.06, xM: 0, yM: 0, drehungGrad: 0,
        farbe: "#cfe8e9", notiz: ""
      },
      {
        id: lagerId, name: "Lager", nummer: "T.02", geschoss: 0,
        breiteM: 2.5, breiteVorneM: null, tiefeM: 3.0, schraege: "KEINE",
        umriss: "", hoeheM: 2.5, aufbauM: 0.06, xM: 4.2, yM: 0, drehungGrad: 0,
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
    verbindungen: [
      { id: neueId("vb"), raumA: raumId, raumB: lagerId, art: "DURCHGANG", breiteM: 0.9 }
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

/**
 * Ein leeres Projekt für echte Arbeit: ein Raum 4 × 3 m, 2,50 m hoch – keine
 * Beispiel-Öffnungen, -Einbauten, -Fotos oder -Geräte, eine leere Variante.
 */
export function leeresProjekt(name = "Neues Projekt") {
  const raumId = neueId("raum");
  return {
    name: text(name) || "Neues Projekt",
    raeume: [
      {
        id: raumId, name: "Raum 1", nummer: "", geschoss: 0,
        breiteM: 4, breiteVorneM: null, tiefeM: 3, schraege: "KEINE",
        umriss: "", hoeheM: 2.5, aufbauM: 0, xM: 0, yM: 0, drehungGrad: 0,
        farbe: "#cfe8e9", notiz: ""
      }
    ],
    aktiverRaum: raumId,
    oeffnungen: [],
    einbauten: [],
    fotos: [],
    verbindungen: [],
    varianten: [{ id: neueId("var"), name: "Variante A", platzhalter: [] }],
    aktiveVariante: 0
  };
}

/**
 * Lädt das Projekt aus localStorage oder legt das Beispiel an. Ein
 * unlesbarer Stand wird vorher unter SCHLUESSEL_DEFEKT beiseitegelegt, damit
 * ihn das nächste Speichern nicht spurlos überschreibt.
 */
export function laden() {
  let roh = null;
  try { roh = localStorage.getItem(SCHLUESSEL); } catch (_) { /* kein Speicher (z. B. privater Modus) */ }
  if (roh) {
    try { return ausObjektStreng(JSON.parse(roh)); }
    catch (_) {
      try { localStorage.setItem(SCHLUESSEL_DEFEKT, roh); } catch (_) { /* voll – dann ohne Rettungskopie */ }
    }
  }
  return beispielProjekt();
}

/**
 * Speichert das Projekt. Gibt `false` zurück, wenn der Speicher voll ist
 * (z. B. zu viele Fotos) – dann bleibt der Stand im RAM, und die App weist auf
 * den Export hin. Früher warnen: `speicherBelegung` gegen SPEICHER_WARNGRENZE.
 */
export function speichern(projekt) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(projekt));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Ungefähr belegter Speicher in Bytes: Länge des Projekt-JSON (Fotos sind
 * Base64, also reines ASCII – ein Zeichen ≈ ein Byte). Ohne Argument zählt der
 * zuletzt gespeicherte Stand.
 */
export function speicherBelegung(projekt) {
  try {
    if (projekt) return JSON.stringify(projekt).length;
    const roh = localStorage.getItem(SCHLUESSEL);
    return roh ? roh.length : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Den aktuellen Stand beiseitelegen, bevor er ersetzt wird (Import, neues
 * Projekt, Beispiel). Ein voller Speicher ist kein Fehler – dann `false`;
 * ersetzt werden darf dann nur nach Rückfrage (`vorErsetzen`).
 */
export function vorherSichern(projekt) {
  if (!projekt) return false;
  let roh;
  try { roh = JSON.stringify(projekt); } catch (_) { return false; }
  try {
    localStorage.setItem(SCHLUESSEL_VORHER, roh);
    return true;
  } catch (_) {
    // Platz schaffen: erst die ältere Sicherung entfernen, dann noch einmal.
    try {
      localStorage.removeItem(SCHLUESSEL_VORHER);
      localStorage.setItem(SCHLUESSEL_VORHER, roh);
      return true;
    } catch (_) {
      return false;
    }
  }
}

/** Die letzte Sicherung von `vorherSichern` (bereinigt) – oder `null`. */
export function vorherLaden() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL_VORHER);
    return roh ? ausObjektStreng(JSON.parse(roh)) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Vor dem Ersetzen des Projekts (Import, neues Projekt, Beispiel) den Stand
 * sichern. Passt die Sicherung nicht mehr in den Speicher, wird nie still
 * ersetzt: `erstExportieren()` → true heißt „nichts ersetzen, erst
 * exportieren“; sonst muss `ohneSicherung()` → true ausdrücklich zustimmen.
 * Ergebnis: { ersetzen, gesichert, exportieren }.
 */
export function vorErsetzen(projekt, { erstExportieren, ohneSicherung } = {}) {
  if (vorherSichern(projekt)) return { ersetzen: true, gesichert: true, exportieren: false };
  if (typeof erstExportieren === "function" && erstExportieren()) return { ersetzen: false, gesichert: false, exportieren: true };
  const ja = typeof ohneSicherung === "function" && !!ohneSicherung();
  return { ersetzen: ja, gesichert: false, exportieren: false };
}

/**
 * Ein Foto ins Projekt legen und sofort speichern. Passt es nicht mehr in den
 * Speicher, wird es wieder herausgenommen – sonst bliebe das Projekt im RAM
 * über der Grenze, und jede spätere Änderung ginge beim Schließen verloren.
 * `true`, wenn Foto und Projekt gespeichert sind.
 */
export function fotoAblegen(projekt, foto) {
  if (!Array.isArray(projekt.fotos)) projekt.fotos = [];
  projekt.fotos.push(foto);
  if (speichern(projekt)) return true;
  const i = projekt.fotos.lastIndexOf(foto);
  if (i >= 0) projekt.fotos.splice(i, 1);
  return false;
}

/**
 * Import, streng: gibt das bereinigte Projekt zurück oder wirft einen `Error`
 * mit deutschem Grund. Ersetzt nie durch das Beispiel und fasst den Speicher
 * nicht an – erst der Aufrufer entscheidet, ob er den Stand übernimmt.
 */
export function ausObjektStreng(o) {
  if (!istObjekt(o)) throw new Error("Die Datei enthält kein RAUMWERK-Projekt (kein JSON-Objekt).");
  const p = migriere(o);
  if (p.raeume === undefined) throw new Error("Die Datei enthält keine Räume – ist das ein RAUMWERK-Projekt?");
  if (!Array.isArray(p.raeume)) throw new Error("Die Raumliste der Datei ist ungültig.");
  if (!p.raeume.length) throw new Error("Das Projekt enthält keinen Raum.");
  bereinigen(p);
  if (!p.raeume.length) throw new Error("Keiner der Räume in der Datei ist lesbar.");
  return p;
}

/**
 * Nachsichtig (für ältere Aufrufer): wie `ausObjektStreng`, aber ein völlig
 * unbrauchbares Objekt ergibt das Beispielprojekt statt eines Fehlers.
 */
export function ausObjekt(o) {
  try { return ausObjektStreng(o); } catch (_) { return beispielProjekt(); }
}

/** Alte Stände anheben und fehlende Listen anlegen – ohne zu bewerten. */
function migriere(p) {
  // Einzelraum-Projekte (alter Stand) auf die Räume-Liste heben.
  if (p.raum && !p.raeume) { p.raeume = [p.raum]; delete p.raum; }
  for (const k of ["oeffnungen", "einbauten", "fotos", "verbindungen"]) {
    if (!Array.isArray(p[k])) p[k] = [];
  }
  if (!Array.isArray(p.varianten) || !p.varianten.length) {
    p.varianten = [{ id: neueId("var"), name: "Variante A", platzhalter: [] }];
  }
  return p;
}

// --------------------------------------------------------- Bereinigen

const ID_MUSTER = /^[A-Za-z0-9_-]{1,80}$/;
const KUERZEL_MUSTER = /^[A-Z0-9_]{1,40}$/;            // art, komponente, befestigung, schraege
const WORT_MUSTER = /^[A-Za-z0-9_-]{1,40}$/;           // methode, quelle, haltung …
const FARBE_MUSTER = /^#[0-9a-fA-F]{3,8}$/;
const FELD_MUSTER = /^[A-Za-z0-9_]{1,80}$/;            // Schlüssel in Aufnahme-Rohdaten
// Nur Rasterbilder, und nur Zeichen, die in keinem Attribut etwas aufbrechen.
const BILD_MUSTER = /^data:image\/(png|jpeg|jpg|webp|gif)(;[A-Za-z0-9=._+-]+)*,[A-Za-z0-9+/=%._~-]*$/;
const MAX_NAME = 200, MAX_NOTIZ = 2000;
const STANDARD_FARBE = "#e6d8b5";
const VERBOTEN = new Set(["__proto__", "constructor", "prototype"]);

const istObjekt = o => !!o && typeof o === "object" && !Array.isArray(o);
const istLeer = v => v === null || v === undefined || v === "";

/** Text: String(), auf Länge gekappt; fehlend → "". */
function text(v, max = MAX_NAME) {
  return v === null || v === undefined ? "" : String(v).slice(0, max);
}

/** Zahl mit Endlichkeitsprüfung; fehlend/ungültig → Vorgabe, sonst geklemmt. */
function zahl(v, vorgabe, min = -1e6, max = 1e6) {
  if (istLeer(v) || typeof v === "boolean" || typeof v === "object") return vorgabe;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : vorgabe;
}

/**
 * Länge > 0 (Breite, Tiefe, Höhe); sonst Vorgabe. Gekappt wird nur, was den
 * Plan sprengen würde – ein unplausibles, aber endliches Maß bleibt stehen.
 */
const MAX_LAENGE = 1e4;
function laenge(v, vorgabe, max = MAX_LAENGE) {
  const n = zahl(v, NaN, -Infinity, max);
  return n > 0 ? n : vorgabe;
}

/** Ganzzahl ≥ 0 (Wandindex). */
function ganzzahl(v, vorgabe = 0) {
  const n = zahl(v, NaN, 0, 100000);
  return Number.isFinite(n) ? Math.trunc(n) : vorgabe;
}

const zahlOderNull = v => zahl(v, null);
/** Ungeklemmt – für Rohdaten mit großen Werten (Zeitstempel in ms). */
const endlichOderNull = v => zahl(v, null, -Infinity, Infinity);
const kuerzel = v => (typeof v === "string" && KUERZEL_MUSTER.test(v)) ? v : null;
const wort = v => (typeof v === "string" && WORT_MUSTER.test(v)) ? v : null;

/** Umriss als JSON-Text aus reinen Zahlen – oder "" (dann gilt Rechteck/Trapez). */
function umrissText(v) {
  if (istLeer(v)) return "";
  const p = umrissLesen(Array.isArray(v) ? JSON.stringify(v) : String(v));
  return p ? JSON.stringify(p) : "";
}

/** Bild-URL prüfen: nur data:image/(png|jpeg|webp|gif); sonst null. */
function bildUrl(v) {
  if (typeof v !== "string") return null;
  const u = v.replace(/\s+/g, "");
  return BILD_MUSTER.test(u) ? u : null;
}

/**
 * Eine ID übernehmen, wenn sie gültig und noch frei ist, sonst neu vergeben.
 * Die alte Schreibweise landet in `karte`, damit Verweise nachziehen können.
 */
function sichereId(roh, praefix, vergeben, karte) {
  const alt = (typeof roh === "string" || typeof roh === "number") ? String(roh) : null;
  const neu = alt !== null && ID_MUSTER.test(alt) && !vergeben.has(alt) ? alt : neueId(praefix);
  vergeben.add(neu);
  if (karte && alt !== null && !karte.has(alt)) karte.set(alt, neu);
  return neu;
}

/** Unbekannte Felder: nur reine Daten behalten (Text gekappt, Zahlen endlich). */
function reineDaten(v, tiefe = 0) {
  if (v === null) return null;
  if (typeof v === "string") return v.slice(0, MAX_NOTIZ);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v !== "object" || tiefe > 8) return undefined;
  if (Array.isArray(v)) return v.slice(0, 10000).map(x => reineDaten(x, tiefe + 1) ?? null);
  const o = {};
  for (const k of Object.keys(v)) {
    if (VERBOTEN.has(k)) continue;
    const w = reineDaten(v[k], tiefe + 1);
    if (w !== undefined) o[k] = w;
  }
  return o;
}

/** Alle Felder außer den schon geprüften auf reine Daten bringen. */
function restBereinigen(o, bekannt) {
  for (const k of Object.keys(o)) {
    if (VERBOTEN.has(k)) { delete o[k]; continue; }
    if (bekannt.has(k)) continue;
    const w = reineDaten(o[k]);
    if (w === undefined) delete o[k]; else o[k] = w;
  }
}

/**
 * Aufnahme-Rohdaten (Zielstrahlen, Bandmaße …) werden nur rechnerisch
 * benutzt: alles wird Zahl, außer den wenigen Kennwörtern. IDs von Öffnungen
 * und Einbauten folgen derselben Umbenennung wie im Projekt, damit
 * „Nachmessen" die Objekte wiederfindet.
 */
const AUFNAHME_KUERZEL = new Set(["art", "befestigung"]);
const AUFNAHME_WORT = new Set(["methode", "haltung", "boden", "ebene"]);

function aufnahmeWert(v, schluessel, tiefe, karte) {
  if (v === null || v === undefined || tiefe > 10) return null;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 5000).map(x => aufnahmeWert(x, schluessel, tiefe + 1, karte));
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) {
      if (VERBOTEN.has(k) || !FELD_MUSTER.test(k)) continue;
      o[k] = aufnahmeWert(v[k], k, tiefe + 1, karte);
    }
    return o;
  }
  if (schluessel === "id") {
    const s = String(v);
    if (ID_MUSTER.test(s)) return s;
    return (karte && karte.get(s)) || neueId("id");
  }
  if (AUFNAHME_KUERZEL.has(schluessel)) return kuerzel(v);
  if (AUFNAHME_WORT.has(schluessel)) return wort(v);
  return endlichOderNull(v);
}

function aufnahmeBereinigen(a, karten) {
  const o = {};
  for (const k of Object.keys(a)) {
    if (VERBOTEN.has(k) || !FELD_MUSTER.test(k)) continue;
    // Öffnungen und Einbauten der Aufnahme tragen dieselben IDs wie im Projekt.
    const karte = k === "oeffnungen" ? karten.oef : k === "einbauten" ? karten.ein : null;
    o[k] = aufnahmeWert(a[k], k, 0, karte);
  }
  return o;
}

/** Maß-Herkunft am Raum: { methode, datum, waende:[{quelle, sigmaM}], … }. */
function aufmassBereinigen(a) {
  if (a.methode !== undefined) a.methode = wort(a.methode);
  if (a.datum !== undefined) a.datum = text(a.datum, 40);
  if (a.waende !== undefined) {
    a.waende = (Array.isArray(a.waende) ? a.waende : []).filter(istObjekt).map(w => {
      w.quelle = wort(w.quelle);
      w.sigmaM = zahlOderNull(w.sigmaM);
      restBereinigen(w, new Set(["quelle", "sigmaM"]));
      return w;
    });
  }
  if (a.kamerahoeheM !== undefined) a.kamerahoeheM = zahlOderNull(a.kamerahoeheM);
  if (a.kalibriert !== undefined) a.kalibriert = a.kalibriert == null ? null : !!a.kalibriert;
  restBereinigen(a, new Set(["methode", "datum", "waende", "kamerahoeheM", "kalibriert"]));
  return a;
}

const RAUM_FELDER = new Set(["id", "name", "nummer", "geschoss", "breiteM", "breiteVorneM", "tiefeM",
  "schraege", "umriss", "hoeheM", "aufbauM", "xM", "yM", "drehungGrad", "farbe", "notiz", "aufmass", "aufnahme"]);

function raumBereinigen(r, i) {
  r.name = r.name === undefined || r.name === null ? `Raum ${i + 1}` : text(r.name);
  r.nummer = text(r.nummer);
  r.geschoss = Math.round(zahl(r.geschoss, 0, -50, 200));
  r.breiteM = laenge(r.breiteM, 4);
  r.breiteVorneM = istLeer(r.breiteVorneM) ? null : laenge(r.breiteVorneM, null);
  r.tiefeM = laenge(r.tiefeM, 3);
  r.schraege = kuerzel(r.schraege) || "KEINE";
  r.umriss = umrissText(r.umriss ?? r.outline);
  r.hoeheM = laenge(r.hoeheM, 2.5);
  r.aufbauM = zahl(r.aufbauM, 0, 0, 5);          // Bodenaufbau/Estrich, m über Rohboden
  r.xM = zahl(r.xM, 0, -1e5, 1e5);
  r.yM = zahl(r.yM, 0, -1e5, 1e5);
  r.drehungGrad = zahl(r.drehungGrad, 0, -3600, 3600);
  r.farbe = typeof r.farbe === "string" && FARBE_MUSTER.test(r.farbe) ? r.farbe : STANDARD_FARBE;
  r.notiz = text(r.notiz, MAX_NOTIZ);
  if (r.aufmass !== undefined) {
    if (istObjekt(r.aufmass)) aufmassBereinigen(r.aufmass); else delete r.aufmass;
  }
  // Die Aufnahme-Rohdaten folgen erst nach den Öffnungen/Einbauten (deren IDs).
  if (r.aufnahme !== undefined && !istObjekt(r.aufnahme)) r.aufnahme = null;
  restBereinigen(r, RAUM_FELDER);
}

const OEFF_FELDER = new Set(["id", "raumId", "art", "wandIndex", "abstandM", "breiteM", "hoeheM",
  "bruestungM", "bezeichnung", "ausAufnahme", "gezieltFrueher"]);

function oeffnungBereinigen(o, raumId, vergeben, karte) {
  const art = istLeer(o.art) ? "TUER" : kuerzel(o.art);
  if (!art) return null;
  o.id = sichereId(o.id, "oef", vergeben, karte);
  o.raumId = raumId;
  o.art = art;
  o.wandIndex = ganzzahl(o.wandIndex);
  o.abstandM = zahl(o.abstandM, 0, 0, MAX_LAENGE);
  o.breiteM = laenge(o.breiteM, 0.9);
  o.hoeheM = laenge(o.hoeheM, 2.0);
  o.bruestungM = zahl(o.bruestungM, 0, 0, MAX_LAENGE);
  if (o.bezeichnung !== undefined) o.bezeichnung = text(o.bezeichnung);
  if (o.ausAufnahme !== undefined) o.ausAufnahme = !!o.ausAufnahme;
  if (o.gezieltFrueher !== undefined) o.gezieltFrueher = !!o.gezieltFrueher;
  restBereinigen(o, OEFF_FELDER);
  return o;
}

const EINBAU_FELDER = new Set(["id", "raumId", "art", "befestigung", "wandIndex", "abstandM", "hoeheM",
  "relX", "relY", "bezeichnung", "notiz", "ausAufnahme", "gezieltFrueher"]);

function einbauBereinigen(e, raumId, vergeben, karte) {
  const art = kuerzel(e.art);
  if (!art) return null;
  e.id = sichereId(e.id, "ein", vergeben, karte);
  e.raumId = raumId;
  e.art = art;
  if (e.befestigung !== undefined) { const b = kuerzel(e.befestigung); if (b) e.befestigung = b; else delete e.befestigung; }
  if (e.wandIndex != null) e.wandIndex = ganzzahl(e.wandIndex);
  if (e.abstandM != null) e.abstandM = zahl(e.abstandM, 0, 0, MAX_LAENGE);
  if (e.hoeheM !== undefined) e.hoeheM = zahlOderNull(e.hoeheM);   // null = Normhöhe
  // relX/relY braucht jeder Einbau, der nicht an einer Wand sitzt.
  if (e.relX != null || e.befestigung !== "WAND") e.relX = zahl(e.relX, 0.5, -10, 10);
  if (e.relY != null || e.befestigung !== "WAND") e.relY = zahl(e.relY, 0.5, -10, 10);
  if (e.bezeichnung !== undefined) e.bezeichnung = text(e.bezeichnung);
  if (e.notiz !== undefined) e.notiz = text(e.notiz, MAX_NOTIZ);
  if (e.ausAufnahme !== undefined) e.ausAufnahme = !!e.ausAufnahme;
  if (e.gezieltFrueher !== undefined) e.gezieltFrueher = !!e.gezieltFrueher;
  restBereinigen(e, EINBAU_FELDER);
  return e;
}

const FOTO_FELDER = new Set(["id", "raumId", "relX", "relY", "titel", "datenUrl", "notiz"]);

/** Das frühere Beispiel-Typenschild war ein SVG – es wird durch das PNG ersetzt. */
function altesBeispielFoto(v) {
  if (typeof v !== "string" || !v.startsWith("data:image/svg+xml,")) return false;
  try { return decodeURIComponent(v.slice(19)).includes("TYPENSCHILD (Beispiel)"); } catch (_) { return false; }
}

function fotoBereinigen(f, raumId, vergeben) {
  const url = altesBeispielFoto(f.datenUrl) ? BEISPIEL_FOTO : bildUrl(f.datenUrl);
  if (!url) return null;
  f.id = sichereId(f.id, "foto", vergeben);
  f.raumId = raumId;
  f.datenUrl = url;
  f.relX = zahl(f.relX, 0.5, -10, 10);
  f.relY = zahl(f.relY, 0.5, -10, 10);
  f.titel = text(f.titel);
  f.notiz = text(f.notiz, MAX_NOTIZ);
  restBereinigen(f, FOTO_FELDER);
  return f;
}

const PH_FELDER = new Set(["id", "raumId", "komponente", "xM", "yM", "drehungGrad", "bezeichnung"]);

function platzhalterBereinigen(ph, raumId, vergeben) {
  const komponente = kuerzel(ph.komponente);
  if (!komponente) return null;
  ph.id = sichereId(ph.id, "ph", vergeben);
  ph.raumId = raumId;
  ph.komponente = komponente;
  ph.xM = zahl(ph.xM, 0, -1e5, 1e5);
  ph.yM = zahl(ph.yM, 0, -1e5, 1e5);
  ph.drehungGrad = zahl(ph.drehungGrad, 0, -3600, 3600);
  ph.bezeichnung = text(ph.bezeichnung);
  restBereinigen(ph, PH_FELDER);
  return ph;
}

const PROJEKT_FELDER = new Set(["name", "raeume", "aktiverRaum", "oeffnungen", "einbauten", "fotos",
  "verbindungen", "varianten", "aktiveVariante"]);

/**
 * Projekt an Ort und Stelle bereinigen und zurückgeben:
 * - IDs passen auf /^[A-Za-z0-9_-]{1,80}$/ und sind je Liste eindeutig, sonst
 *   neu vergeben – alle Verweise (aktiverRaum, raumId, raumA/raumB, Aufnahme)
 *   ziehen mit.
 * - Texte per String(), gekappt (Namen 200, Notizen 2000 Zeichen).
 * - Zahlen endlich; nur fehlende/ungültige Werte bekommen eine Vorgabe.
 * - Farbe #rgb…#rrggbbaa, Kürzel (art, komponente, befestigung, schraege)
 *   nur A–Z/0–9/_ – sonst Vorgabe oder das Objekt fällt weg.
 * - Fotos nur mit data:image/(png|jpeg|webp|gif); sonst fällt das Foto weg.
 * - Umriss muss lesbar sein, sonst "" (Rechteck/Trapez).
 * - Objekte, deren Raum fehlt, und Verbindungen zu fehlenden Räumen fallen weg.
 * - Weitere Felder bleiben als reine Daten erhalten (aufmass, scans …);
 *   die Aufnahme-Rohdaten werden durchgehend zu Zahlen.
 */
export function bereinigen(p) {
  if (!istObjekt(p)) return p;
  const karten = { raum: new Map(), oef: new Map(), ein: new Map() };

  // Räume zuerst: ihre (ggf. neuen) IDs braucht jeder Verweis.
  const raumIds = new Set();
  p.raeume = (Array.isArray(p.raeume) ? p.raeume : []).filter(istObjekt);
  for (const r of p.raeume) r.id = sichereId(r.id, "raum", raumIds, karten.raum);
  p.raeume.forEach(raumBereinigen);
  // Ein Objekt ohne Raumangabe gehört im Einraum-Projekt eindeutig zu diesem Raum.
  const einziger = p.raeume.length === 1 ? p.raeume[0].id : null;
  const raumVon = v => {
    if (istLeer(v)) return einziger;
    if (typeof v !== "string" && typeof v !== "number") return null;
    return karten.raum.get(String(v)) || null;
  };

  const liste = (feld, je) => {
    const vergeben = new Set();
    p[feld] = (Array.isArray(p[feld]) ? p[feld] : []).filter(istObjekt)
      .map(o => { const raumId = raumVon(o.raumId); return raumId ? je(o, raumId, vergeben) : null; })
      .filter(Boolean);
  };
  liste("oeffnungen", (o, raumId, v) => oeffnungBereinigen(o, raumId, v, karten.oef));
  liste("einbauten", (e, raumId, v) => einbauBereinigen(e, raumId, v, karten.ein));
  liste("fotos", fotoBereinigen);

  // Die Aufnahme-Rohdaten der Räume kennen jetzt die neuen Öffnungs-/Einbau-IDs.
  for (const r of p.raeume) if (istObjekt(r.aufnahme)) r.aufnahme = aufnahmeBereinigen(r.aufnahme, karten);

  const vbIds = new Set();
  p.verbindungen = (Array.isArray(p.verbindungen) ? p.verbindungen : []).filter(istObjekt).map(v => {
    const a = raumVon(v.raumA), b = raumVon(v.raumB);
    if (!a || !b || a === b || istLeer(v.raumA) || istLeer(v.raumB)) return null;
    v.id = sichereId(v.id, "vb", vbIds);
    v.raumA = a; v.raumB = b;
    v.art = kuerzel(v.art) || "DURCHGANG";
    v.breiteM = laenge(v.breiteM, 0.9);
    restBereinigen(v, new Set(["id", "raumA", "raumB", "art", "breiteM"]));
    return v;
  }).filter(Boolean);

  const varIds = new Set(), phIds = new Set();
  p.varianten = (Array.isArray(p.varianten) ? p.varianten : []).filter(istObjekt).map((v, i) => {
    v.id = sichereId(v.id, "var", varIds);
    v.name = v.name === undefined || v.name === null ? `Variante ${i + 1}` : text(v.name);
    v.platzhalter = (Array.isArray(v.platzhalter) ? v.platzhalter : []).filter(istObjekt)
      .map(ph => { const raumId = raumVon(ph.raumId); return raumId ? platzhalterBereinigen(ph, raumId, phIds) : null; })
      .filter(Boolean);
    restBereinigen(v, new Set(["id", "name", "platzhalter"]));
    return v;
  });
  if (!p.varianten.length) p.varianten = [{ id: neueId("var"), name: "Variante A", platzhalter: [] }];

  p.name = p.name === undefined || p.name === null ? "Projekt" : text(p.name);
  p.aktiverRaum = (!istLeer(p.aktiverRaum) && raumVon(p.aktiverRaum)) || (p.raeume[0] ? p.raeume[0].id : null);
  const av = zahl(p.aktiveVariante, 0);
  p.aktiveVariante = Number.isInteger(av) && av >= 0 && av < p.varianten.length ? av : 0;
  restBereinigen(p, PROJEKT_FELDER);
  return p;
}

// --------------------------------------------------------- Varianten

export function aktiveVariante(p) {
  return p.varianten[p.aktiveVariante] || p.varianten[0];
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

// ------------------------------------------- Gezielte Objekte von Hand ändern

/**
 * Von Hand geändert: Eine Öffnung oder ein Einbau aus der gespeicherten
 * Zielaufnahme (`ausAufnahme`) gehört ab jetzt dem Nutzer – das Nachmessen
 * rechnet sie nicht mehr neu und lässt sie, wie sie ist. `gezieltFrueher`
 * merkt sich die Herkunft: Eine neue Zielaufnahme ersetzt sie wie die
 * gezielten. Jeder Bearbeitungsweg (Blatt, Inspektor, Plan) ruft das vor der
 * Änderung auf.
 */
export function vonHand(o) {
  if (o && o.ausAufnahme) { o.ausAufnahme = false; o.gezieltFrueher = true; }
  return o;
}

const EINBAU_LAGE = ["befestigung", "wandIndex", "abstandM", "relX", "relY"];

/**
 * Einbau im Plan verschieben. Ein gezielter Einbau wird dabei zum Handeintrag –
 * außer er landet wieder genau auf seiner Lage vor dem Zug (der Plan nimmt
 * einen abgebrochenen Zug so zurück). `zug` merkt sich diese Lage, bis die
 * App ihn beim Loslassen leert (`zug.gezielt = null`).
 */
export function einbauVerschieben(e, patch, zug = {}) {
  if (e.ausAufnahme && zug.gezielt?.id !== e.id) zug.gezielt = { id: e.id, lage: EINBAU_LAGE.map(k => e[k]) };
  Object.assign(e, patch);
  if (zug.gezielt?.id === e.id) {
    e.ausAufnahme = EINBAU_LAGE.every((k, i) => e[k] === zug.gezielt.lage[i]);
    if (!e.ausAufnahme) e.gezieltFrueher = true;
  }
  return e;
}

/**
 * Für Bearbeitungen außerhalb der App (AR): Stand der gezielten Objekte
 * merken; `gezielteNachpruefen` macht danach die geänderten zu Handeinträgen.
 */
export function gezielteMerken(liste) {
  return (liste || []).filter(o => o && o.ausAufnahme).map(o => [o, JSON.stringify(o)]);
}

export function gezielteNachpruefen(staende) {
  for (const [o, s] of staende || []) if (o.ausAufnahme && JSON.stringify(o) !== s) vonHand(o);
}
