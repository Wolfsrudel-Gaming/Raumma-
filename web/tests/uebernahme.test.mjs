/*
 * Übernahme und Nachmessen (web/raumwerk/uebernahme.js) samt der reinen
 * Rechnungen des Assistenten (web/raumwerk/assistent.js) – ohne Oberfläche:
 *
 *   · Nachmessen eines gezielten Raums holt gelöschte Objekte nicht zurück,
 *     lässt Handkorrekturen stehen (ausAufnahme = false), erzeugt keine
 *     doppelten IDs; eine gelöschte Tür ist kein Maßstab mehr.
 *   · „Neu aufmessen“ verwirft gezielte Objekte nicht still.
 *   · Nachmessen einer Wand hält rechte Winkel (Rechteck bleibt Rechteck).
 *   · Maßband/Rechteck: nur Getipptes ist Bandmaß; offener Zug sperrt.
 *   · Kamerahöhe wird nie still ersetzt; Wende-Kalibrierung mit zwei Paaren;
 *     Neustart des Lagesensors (Epoche) dreht alte Schüsse in den neuen Bezug.
 *
 * Aufruf: node web/tests/uebernahme.test.mjs   (Exitcode != 0 bei Fehler)
 */
import * as Z from "../zielen.js";
import * as G from "../geometrie.js";
import * as A from "../raumaufnahme.js";
import { uebernehmen, nachmessen, waendeMitHerkunft, raumhoeheSetzen } from "../raumwerk/uebernahme.js";
import {
  bandRechnen, bandGueltig, bandErgebnis, rechteckErgebnis, startWaende, kamerahoeheLesen,
  kalibAuswerten, neuAusrichten, zielErgebnis
} from "../raumwerk/assistent.js";

let ok = 0, fail = 0;
const nah = (name, got, want, tol = 0.005) => {
  const p = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!p) { console.error(`FAIL ${name}: got=${got} want=${want} (±${tol})`); fail++; } else ok++;
};
const wahr = (name, b, info = "") => { if (!b) { console.error(`FAIL ${name} ${info}`); fail++; } else ok++; };
const gleich = (name, got, want) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  if (!p) { console.error(`FAIL ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); fail++; } else ok++;
};

// ------------------------------------------------------------ Szene
// L-Raum wie in raumaufnahme.test.mjs, 2,62 m hoch, Freihand mit 0,5° Neigungsfehler.
const L = [[0, 4], [5, 4], [5, 0], [2, 0], [2, 1.5], [0, 1.5]];
const H = 2.62, S = [2.9, 2.5];
const HAND = { hw: 1.30, r: 0.32, L: 0.08, biasGrad: 0.5 };
let uhr = 0;
function schuss(T, dtMs = 5000) {
  uhr += dtMs;
  const dx = T[0] - S[0], dy = T[1] - S[1], D = Math.hypot(dx, dy), zT = T[2] ?? 0;
  let th = 0.3;
  for (let k = 0; k < 60; k++) th = Math.atan2(HAND.hw + HAND.L * Math.cos(th) - zT, D - (HAND.r + HAND.L * Math.sin(th)));
  const psi = Math.atan2(dx, dy), thM = th + HAND.biasGrad * Z.GRAD;
  return { v: [Math.sin(psi) * Math.cos(thM), Math.cos(psi) * Math.cos(thM), -Math.sin(thM)], t: uhr };
}
/** Gezielte Aufnahme mit Tür t1, Fenster f1, Steckdose e1, Schalter e2; Maßstab wählbar. */
function aufnahme({ bandmasse = { 0: 5.0 }, tuerHoehe = null, praefix = "", epoche } = {}) {
  uhr = 0;
  const a = A.neueAufnahme(1.45, "fertig");
  a.ecken = L.map(p => { const s = schuss(p); return { v: s.v, t: s.t, ebene: "boden", epoche }; });
  const u = schuss(L[1]), o = schuss([...L[1], H], 3000);
  a.hoehe = { vUnten: u.v, tUnten: u.t, vOben: o.v, tOben: o.t, epoche };
  const t1 = schuss([3.4, 4, 0]), t2 = schuss([4.285, 4, 1.97], 3000);
  a.oeffnungen.push({ id: praefix + "t1", art: "TUER", a: t1.v, ta: t1.t, b: t2.v, tb: t2.t, epoche, ...(tuerHoehe ? { hoeheBekanntM: tuerHoehe } : {}) });
  const f1 = schuss([5, 3.0, 0.9]), f2 = schuss([5, 1.8, 2.2], 3000);
  a.oeffnungen.push({ id: praefix + "f1", art: "FENSTER", a: f1.v, ta: f1.t, b: f2.v, tb: f2.t, epoche });
  const s1 = schuss([0, 2.5, 0.3]);
  a.einbauten.push({ id: praefix + "e1", art: "STECKDOSE", befestigung: "WAND", v: s1.v, t: s1.t, epoche });
  const s2 = schuss([3.2, 4, 1.05]);
  a.einbauten.push({ id: praefix + "e2", art: "SCHALTER", befestigung: "WAND", v: s2.v, t: s2.t, epoche });
  a.bandmasse = { ...bandmasse };
  return a;
}
let idn = 0;
const neueId = p => `${p}-n${idn++}`;
const neuesProjekt = () => ({ raeume: [{ id: "r1", name: "Wohnen", aufbauM: 0, hoeheM: 2.5 }], oeffnungen: [], einbauten: [] });
const ids = liste => liste.map(x => x.id).sort();

// ------------------------- Nachmessen: gelöscht bleibt gelöscht, Hand bleibt Hand
{
  const p = neuesProjekt();
  const e = zielErgebnis(aufnahme(), 0);
  uebernehmen(p, "r1", e, neueId);
  const raum = p.raeume[0];
  gleich("nach dem Zielen: Öffnungen", ids(p.oeffnungen), ["f1", "t1"]);
  gleich("nach dem Zielen: Einbauten", ids(p.einbauten), ["e1", "e2"]);
  wahr("alle aus der Aufnahme", [...p.oeffnungen, ...p.einbauten].every(x => x.ausAufnahme === true));

  // Nutzer: Tür entfernen, Fenster und Steckdose von Hand ändern (die App löst sie
  // dabei von der Aufnahme, C1), Schalter nur benennen, Laser-Raumhöhe 2,60.
  p.oeffnungen = p.oeffnungen.filter(o => o.id !== "t1");
  const f = p.oeffnungen.find(o => o.id === "f1");
  Object.assign(f, { art: "FENSTER", breiteM: 1.25, bruestungM: 0.85, ausAufnahme: false });
  const dose = p.einbauten.find(x => x.id === "e1");
  Object.assign(dose, { art: "SCHALTER", hoeheM: 0.45, ausAufnahme: false });
  p.einbauten.find(x => x.id === "e2").bezeichnung = "Licht Flur";
  raumhoeheSetzen(raum, 2.60);

  const h = nachmessen(p, "r1", 1, 4.0, neueId);
  wahr("Nachmessen liefert Hinweise", Array.isArray(h));
  wahr("gelöschte Tür kommt nicht zurück", !p.oeffnungen.some(o => o.id === "t1"), JSON.stringify(ids(p.oeffnungen)));
  wahr("gelöschte Tür auch aus der Aufnahme", !raum.aufnahme.oeffnungen.some(o => o.id === "t1"));
  gleich("keine doppelten Öffnungs-IDs", ids(p.oeffnungen), ["f1"]);
  gleich("keine doppelten Einbau-IDs", ids(p.einbauten), ["e1", "e2"]);
  const f2 = p.oeffnungen.find(o => o.id === "f1");
  nah("Fenster: Handbreite bleibt", f2.breiteM, 1.25, 1e-9);
  nah("Fenster: Handbrüstung bleibt", f2.bruestungM, 0.85, 1e-9);
  wahr("Fenster bleibt Handeintrag", f2.ausAufnahme === false);
  wahr("Strahl des Fensters bleibt in der Aufnahme", raum.aufnahme.oeffnungen.some(o => o.id === "f1"));
  const d2 = p.einbauten.find(x => x.id === "e1");
  wahr("Steckdose → Schalter bleibt", d2.art === "SCHALTER" && d2.ausAufnahme === false);
  nah("Handhöhe 0,45 bleibt", d2.hoeheM, 0.45, 1e-9);
  const s2 = p.einbauten.find(x => x.id === "e2");
  wahr("gezielter Schalter neu gerechnet, Bezeichnung bleibt", s2.ausAufnahme === true && s2.bezeichnung === "Licht Flur");
  nah("gezielter Schalter auf 1,05", s2.hoeheM, 1.05, 0.03);
  nah("Raumhöhe von Hand bleibt (C2)", raum.hoeheM, 2.60, 1e-9);
  nah("Bandmaß Wand 2 gilt", G.wandLaengen(raum)[1], 4.0, 0.011);

  // Ein zweites Nachmessen ändert daran nichts.
  nachmessen(p, "r1", 1, 4.0, neueId);
  gleich("zweites Nachmessen: Öffnungen", ids(p.oeffnungen), ["f1"]);
  gleich("zweites Nachmessen: Einbauten", ids(p.einbauten), ["e1", "e2"]);
}

// ------------------------- Gelöschte Tür ist kein Maßstab mehr
{
  const p = neuesProjekt();
  uebernehmen(p, "r1", zielErgebnis(aufnahme({ bandmasse: {}, tuerHoehe: 1.97 }), 0), neueId);
  const raum = p.raeume[0];
  wahr("Türhöhe setzt den Maßstab", raum.aufmass.kalibriert === true);
  p.oeffnungen = p.oeffnungen.filter(o => o.id !== "t1");
  nachmessen(p, "r1", 0, 0, neueId);       // kein Bandmaß, nur neu rechnen
  wahr("ohne Tür kein Maßstab mehr", raum.aufmass.kalibriert === false, JSON.stringify(raum.aufmass));
}

// ------------------------- Neu aufmessen: nichts still verwerfen
{
  const p = neuesProjekt();
  uebernehmen(p, "r1", zielErgebnis(aufnahme(), 0), neueId);
  const raum = p.raeume[0];
  p.oeffnungen.push({ id: "hand", raumId: "r1", art: "FENSTER", wandIndex: 2, abstandM: 1, breiteM: 1.2, hoeheM: 1.3, bruestungM: 0.9 });
  // Maßband über denselben Umriss (vorbefüllt, Wand 1 nachgemessen).
  const b = { waende: startWaende(raum), hoeheM: 2.6, ausgleich: false };
  b.waende[0].laenge = 5.0; b.waende[0].gemessen = true;
  const e = bandErgebnis(b);
  wahr("Maßband über vorbefüllten Umriss gilt", !!e);
  const h = uebernehmen(p, "r1", e, neueId);
  gleich("gezielte bleiben als Handeintrag", ids(p.oeffnungen), ["f1", "hand", "t1"]);
  gleich("gezielte Einbauten bleiben", ids(p.einbauten), ["e1", "e2"]);
  wahr("… und gehören jetzt dem Nutzer", [...p.oeffnungen, ...p.einbauten].every(x => !x.ausAufnahme));
  wahr("Hinweis nennt die Anzahl", h.some(t => t.startsWith("2 Öffnung(en) und 2 Einbau(ten) aus der Zielaufnahme bleiben")), JSON.stringify(h));

  // Rechteck mit weniger Wänden: Objekte an Wand 5/6 fallen weg – gezählt, auch Einbauten.
  p.einbauten.push({ id: "e5", raumId: "r1", art: "STECKDOSE", befestigung: "WAND", wandIndex: 5, abstandM: 0.5, hoeheM: 0.3 });
  p.oeffnungen.push({ id: "o4", raumId: "r1", art: "TUER", wandIndex: 4, abstandM: 0.2, breiteM: 0.9, hoeheM: 2 });
  const wegO = p.oeffnungen.filter(o => o.wandIndex >= 4).length, wegE = p.einbauten.filter(x => x.wandIndex >= 4).length;
  const alle = p.oeffnungen.length + p.einbauten.length;
  const h2 = uebernehmen(p, "r1", rechteckErgebnis(5, 4, 2.6, { b: true, t: true }), neueId);
  wahr("Wand fehlt: Öffnungen und Einbauten gezählt", wegO >= 1 && wegE >= 1
    && h2.some(t => t.startsWith(`${wegO} Öffnung(en) und ${wegE} Einbau(ten) entfernt`)), JSON.stringify(h2));
  wahr("übrige bleiben", p.oeffnungen.length + p.einbauten.length === alle - wegO - wegE);
  wahr("o4/e5 weg", !p.oeffnungen.some(o => o.id === "o4") && !p.einbauten.some(x => x.id === "e5"));

  // Eine neue Zielaufnahme ersetzt die gezielten Objekte – und sagt es.
  const p2 = neuesProjekt();
  uebernehmen(p2, "r1", zielErgebnis(aufnahme(), 0), neueId);
  const h3 = uebernehmen(p2, "r1", zielErgebnis(aufnahme({ praefix: "neu-" }), 0), neueId);
  gleich("neue Aufnahme: neue Objekte", ids(p2.oeffnungen), ["neu-f1", "neu-t1"]);
  wahr("Hinweis: alte ersetzt", h3.some(t => t.startsWith("2 Öffnung(en) und 2 Einbau(ten) der früheren Zielaufnahme entfernt")), JSON.stringify(h3));
}

// ------------------------- Nachmessen hält rechte Winkel
const rechtwinklig = raum => G.waende(G.ecken(raum)).every(w => Math.abs(Math.abs(w.drehung) - 90) < 0.2);
{
  const p = { raeume: [{ id: "r", hoeheM: 2.5 }], oeffnungen: [], einbauten: [] };
  uebernehmen(p, "r", rechteckErgebnis(4, 3, 2.5, { b: true, t: true }), neueId);
  const r = p.raeume[0];
  gleich("Rechteck: Wand 3/4 ergeben sich", waendeMitHerkunft(r).map(w => w.quelle), ["band", "band", "getippt", "getippt"]);
  const h = nachmessen(p, "r", 0, 4.12, neueId);
  gleich("Rechteck nachgemessen: Längen", waendeMitHerkunft(r).map(w => Math.round(w.laenge * 100) / 100), [4.12, 3, 4.12, 3]);
  wahr("Rechteck bleibt rechtwinklig", rechtwinklig(r), r.umriss);
  nah("Fläche 12,36", G.flaeche(r), 12.36, 0.01);
  wahr("kein Widerspruch gemeldet", !h.some(t => t.includes("passen nicht")), JSON.stringify(h));

  // Alte Rechtecke: alle vier Wände als „band“ gespeichert.
  const p2 = { raeume: [{ id: "r", hoeheM: 2.5 }], oeffnungen: [], einbauten: [] };
  uebernehmen(p2, "r", { methode: "rechteck", umriss: "", breiteM: 4, tiefeM: 3, hoeheM: 2.5, oeffnungen: [], einbauten: [], aufnahme: null,
    waende: [4, 3, 4, 3].map(laenge => ({ laenge, quelle: "band", sigmaM: 0.005 })) }, neueId);
  const r2 = p2.raeume[0];
  const h2 = nachmessen(p2, "r", 0, 4.12, neueId);
  wahr("altes Rechteck bleibt rechtwinklig", rechtwinklig(r2), r2.umriss);
  nah("altes Rechteck: Gegenwand folgt", G.wandLaengen(r2)[2], 4.12, 0.011);
  gleich("altes Rechteck: Gegenwand kein Bandmaß mehr", waendeMitHerkunft(r2).map(w => w.quelle), ["band", "band", "getippt", "band"]);
  wahr("Hinweis nennt Wand 3", h2.length && h2[0].startsWith("Wand 3: früheres Bandmaß 4,00 m"), JSON.stringify(h2));

  // Schräge Wand (kein rechter Winkel) bleibt schräg.
  const p3 = { raeume: [{ id: "r", umriss: "[[0,0],[4,0],[4,3],[1,3]]" }], oeffnungen: [], einbauten: [] };
  const vorher = G.waende(G.ecken(p3.raeume[0])).map(w => w.drehung);
  nachmessen(p3, "r", 0, 4.2, neueId);
  gleich("Winkel bleiben erhalten", G.waende(G.ecken(p3.raeume[0])).map(w => w.drehung), vorher);
  nah("gemessene Wand stimmt", G.wandLaengen(p3.raeume[0])[0], 4.2, 0.011);
}

// ------------------------- Raumhöhe von Hand (C2)
{
  const raum = { id: "r", aufbauM: 0.06, aufnahme: { methode: "zielen", boden: "roh" } };
  raumhoeheSetzen(raum, 2.5);
  nah("Raumhöhe ab FFB", raum.hoeheM, 2.5, 1e-9);
  nah("in der Aufnahme ab Rohboden", raum.aufnahme.raumhoeheM, 2.56, 1e-9);
  raumhoeheSetzen(raum, "abc");
  nah("Unsinn ändert nichts", raum.hoeheM, 2.5, 1e-9);
}

// ------------------------- Maßband: nur Getipptes ist Bandmaß
{
  const p = neuesProjekt();
  uebernehmen(p, "r1", zielErgebnis(aufnahme({ bandmasse: {} }), 0), neueId);
  const raum = p.raeume[0];
  const vorher = waendeMitHerkunft(raum);
  const b = { waende: startWaende(raum), hoeheM: 2.6, ausgleich: false };
  wahr("Vorbefüllung ist nicht gemessen", b.waende.every(w => w.gemessen === false));
  gleich("Vorbefüllung trägt die alte Herkunft", b.waende.map(w => w.quelle), vorher.map(w => w.quelle));
  const e0 = bandErgebnis(b);
  gleich("unberührt: Herkunft bleibt gezielt", e0.waende.map(w => w.quelle), vorher.map(() => "gezielt"));
  nah("unberührt: Unsicherheit bleibt", e0.waende[1].sigmaM, vorher[1].sigmaM, 1e-9);
  // Nur Wand 1 mit dem Bandmaß: das ist die einzige „band“-Wand.
  b.waende[0].laenge = 5.0; b.waende[0].gemessen = true;
  b.waende[4].laenge = null; b.waende[4].gemessen = false;     // Wand 5 ergibt sich
  const e = bandErgebnis(b);
  wahr("Zug mit berechneter Wand gilt", !!e);
  gleich("Herkunft je Wand", e.waende.map(w => w.quelle), ["band", "gezielt", "gezielt", "gezielt", "getippt", "gezielt"]);
  nah("Bandmaß ± 5 mm", e.waende[0].sigmaM, 0.005, 1e-12);
  wahr("berechnete Wand ohne Unsicherheit", e.waende[4].sigmaM === null);

  // Neuer Raum ohne Umriss: nichts vorbefüllt.
  wahr("ohne Umriss leer", startWaende({}).every(w => w.laenge == null && w.gemessen === false));
}

// ------------------------- Maßband: offener Zug sperrt
{
  const zug = (ws, ausgleich = false) => ({ waende: ws.map(([laenge, drehung]) => ({ laenge, drehung, gemessen: laenge != null })), ausgleich, hoeheM: 2.5 });
  const fall = (name, ws, soll, ausgleich) => {
    const b = zug(ws, ausgleich);
    wahr(`${name}: ${soll ? "gilt" : "gesperrt"}`, bandGueltig(bandRechnen(b)) === soll && !!bandErgebnis(b) === soll);
  };
  fall("Tippfehler 3,5 statt 3 (50 cm offen)", [[4, 90], [3.5, 90], [4, 90], [3, 90]], false);
  fall("3 cm Lücke", [[4, 90], [3, 90], [4.03, 90], [3, 90]], false);
  fall("3 cm Lücke verteilt", [[4, 90], [3, 90], [4.03, 90], [3, 90]], true, true);
  fall("falsche Abbiegung", [[4, 90], [3, -90], [4, 90], [null, 90]], false);
  fall("letzte Wand ergibt sich", [[4, 90], [3, 90], [4, 90], [null, 90]], true);
  fall("Fläche unter 0,5 m²", [[1, 90], [0.4, 90], [1, 90], [0.4, 90]], false);
  fall("Zug kreuzt sich", [[3, 90], [2, 90], [2, 90], [3, -90], [1, -90], [1, -90]], false);
  const e = bandErgebnis(zug([[4, 90], [3, 90], [4.03, 90], [3, 90]], true));
  wahr("verteilt: alles getippt", e.waende.every(w => w.quelle === "getippt" && w.sigmaM === null));
  const e2 = bandErgebnis(zug([[4, 90], [3, 90], [4, 90], [null, 90]]));
  gleich("getippt + berechnet", e2.waende.map(w => w.quelle), ["band", "band", "band", "getippt"]);
}

// ------------------------- Rechteck: Platzhalter ist kein Bandmaß
{
  gleich("nichts getippt", rechteckErgebnis(3, 3, 2.5).waende.map(w => w.quelle), ["getippt", "getippt", "getippt", "getippt"]);
  gleich("nur Breite getippt", rechteckErgebnis(4, 3, 2.5, { b: true }).waende.map(w => w.quelle), ["band", "getippt", "getippt", "getippt"]);
  wahr("ohne Breite nichts", rechteckErgebnis(0, 3, 2.5) === null);
}

// ------------------------- Kamerahöhe: nie still ersetzen
{
  nah("1,62 m", kamerahoeheLesen("1,62"), 1.62, 1e-12);
  nah("162 (Zentimeter)", kamerahoeheLesen("162"), 1.62, 1e-12);
  nah("162,5 cm", kamerahoeheLesen("162,5"), 1.625, 1e-12);
  for (const t of ["", "abc", "0,2", "2,5", "300", "16200"]) wahr(`„${t}“ abgelehnt`, kamerahoeheLesen(t) === null);
}

// ------------------------- Wende-Kalibrierung: zwei Paare, plausibel
{
  wahr("über 1,5° unplausibel", kalibAuswerten([], 1.8).status === "unplausibel");
  wahr("2,9° (Ziel in 2 m, Linse gewandert) unplausibel", kalibAuswerten([0.4], 2.9).status === "unplausibel");
  let k = kalibAuswerten([], 0.42);
  wahr("erstes Paar: weiter", k.status === "weiter" && k.paare.length === 1);
  k = kalibAuswerten(k.paare, 0.38);
  wahr("zwei passende Paare: fertig", k.status === "fertig");
  nah("Mittel der Paare", k.deltaGrad, 0.40, 1e-12);
  k = kalibAuswerten([0.4], 0.75);
  wahr("Paare 0,35° auseinander: noch eins", k.status === "abweichung" && k.paare.length === 1);
  k = kalibAuswerten(k.paare, 0.7);
  wahr("drittes Paar passt zum zweiten", k.status === "fertig");
  nah("… deren Mittel", k.deltaGrad, 0.725, 1e-12);
}

// ------------------------- Neustart des Lagesensors (Epoche)
{
  const phi = 37 * Z.GRAD;   // neuer Gier-Bezug nach dem Neustart
  const dreh = v => [v[0] * Math.cos(phi) + v[1] * Math.sin(phi), v[1] * Math.cos(phi) - v[0] * Math.sin(phi), v[2]];
  const a = aufnahme({ epoche: 1 });
  const vorher = A.rekonstruiere(a, {});
  const kopie = JSON.parse(JSON.stringify(a));
  // Woanders hingestellt (andere Neigung zu Ecke 1): nichts ändern.
  const weit = dreh(schuss([0.4, 3.6]).v);
  const r0 = neuAusrichten(a, weit, 2);
  wahr("andere Stelle: abgelehnt", !r0.ok && Math.abs(r0.abweichungGrad) > 1.5, JSON.stringify(r0));
  gleich("abgelehnt: Aufnahme unverändert", a, kopie);
  // Dieselbe Stelle: Ecke 1 im neuen Bezug.
  const r = neuAusrichten(a, dreh(kopie.ecken[0].v), 2);
  wahr("ausgerichtet", r.ok);
  nah("Versatz 37°", r.versatzGrad, 37, 1e-6);
  wahr("alle Schüsse in der neuen Epoche", [...a.ecken, a.hoehe, ...a.oeffnungen, ...a.einbauten].every(x => x.epoche === 2));
  const soll = dreh(kopie.oeffnungen[0].b);
  wahr("Schuss gedreht", a.oeffnungen[0].b.every((x, i) => Math.abs(x - soll[i]) < 2e-6));
  // Ein neuer Schuss im neuen Bezug passt jetzt zu den alten Ecken.
  a.einbauten.push({ id: "e3", art: "STECKDOSE", befestigung: "WAND", v: dreh(schuss([5, 2.0, 0.3]).v), t: uhr, epoche: 2 });
  const nach = A.rekonstruiere(a, {});
  nah("Fläche unverändert", nach.flaecheM2, vorher.flaecheM2, 0.01);
  const e3 = nach.einbauten.find(x => x.id === "e3");
  const ost = nach.oeffnungen.find(o => o.id === "f1").wandIndex;     // Fenster sitzt in der Ostwand
  wahr("neuer Schuss trifft die richtige Wand", e3 && e3.wandIndex === ost, JSON.stringify(e3));
}

// --------- Neu aufmessen: nachgebesserte gezielte Tür steht nicht doppelt da (Prüfer v3)
// Regel statt Abstandsraten: Eine neue Zielaufnahme ersetzt alles, was aus
// einer früheren stammt (auch Nachgebessertes), reine Handeinträge bleiben –
// unabhängig von Startecke, Wandnummern und Nähe zu anderen Bauteilen.
{
  const p = neuesProjekt();
  uebernehmen(p, "r1", zielErgebnis(aufnahme(), 0), neueId);
  const tuer = p.oeffnungen.find(o => o.id === "t1");
  tuer.ausAufnahme = false; tuer.gezieltFrueher = true;   // wie Store.vonHand
  tuer.breiteM = 0.885;
  const handDose = { id: "hand-1", raumId: "r1", art: "SCHALTER", befestigung: "WAND", wandIndex: 0, abstandM: 3.2, hoeheM: 1.10 };
  p.einbauten.push(handDose);              // reiner Handeintrag direkt neben dem gezielten Schalter
  const h = uebernehmen(p, "r1", zielErgebnis(aufnahme({ praefix: "neu-" }), 0), neueId);
  gleich("Neu aufmessen: eine Tür statt zwei", p.oeffnungen.filter(o => o.art === "TUER").map(o => o.id), ["neu-t1"]);
  wahr("Neu aufmessen: Hinweis nennt die nachgebesserte", h.some(x => /auch 1 von Hand nachgebesserte/.test(x)), h.join(" | "));
  wahr("Neu aufmessen: reiner Handeintrag neben gezieltem bleibt", p.einbauten.some(x => x.id === "hand-1"));
  gleich("Neu aufmessen: keine doppelten IDs", new Set(p.oeffnungen.map(o => o.id)).size, p.oeffnungen.length);
  // Nachmessen rechnet nur neu: Handeinträge und Nachgebessertes bleiben unberührt.
  const sch = p.einbauten.find(x => x.id === "neu-e2");
  sch.ausAufnahme = false; sch.gezieltFrueher = true; sch.hoeheM = 1.20; sch.bezeichnung = "TV";
  const h2 = nachmessen(p, "r1", 1, 4.0, neueId);
  wahr("Nachmessen: Handeintrag bleibt", p.einbauten.some(x => x.id === "hand-1"));
  const sch2 = p.einbauten.find(x => x.id === "neu-e2");
  wahr("Nachmessen: nachgebesserter Schalter bleibt, wie er ist", sch2 && sch2.hoeheM === 1.20 && sch2.bezeichnung === "TV", JSON.stringify(sch2));
  wahr("Nachmessen: Hinweise der Übernahme kommen mit", Array.isArray(h2));
}

console.log(`uebernahme.test: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
