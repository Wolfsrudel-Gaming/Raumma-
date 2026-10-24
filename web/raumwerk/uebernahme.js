/*
 * Aufmaß übernehmen und nachmessen – die Brücke zwischen Assistent und Projekt.
 *
 * Der Aufmaß-Assistent liefert ein Ergebnis (Umriss, Höhe, Öffnungen,
 * Einbauten, Maß-Herkunft, Rohdaten der Aufnahme). Dieses Modul schreibt es in
 * einen Raum des Projekts – für Handy und PC gleich, ohne DOM, in Node testbar.
 *
 * Zweite Aufgabe: **Wand nachmessen**. Wer nachträglich eine Wand mit dem
 * Bandmaß nimmt, trägt die Länge ein; ist der Raum gezielt aufgenommen, wird er
 * aus den gespeicherten Strahlen neu gerechnet (Maßstab inklusive), sonst wird
 * der Umriss so ausgeglichen, dass alle gemessenen Wände exakt stimmen.
 */

import * as G from "../geometrie.js";
import * as A from "../raumaufnahme.js";

/** Herkunft eines Maßes: verlässlich (Bandmaß) oder mit Unsicherheit. */
export const Quelle = { BAND: "band", GEZIELT: "gezielt", GETIPPT: "getippt" };

/**
 * Ergebnis des Assistenten in den Raum `raumId` übernehmen.
 *
 * Eine neue Zielaufnahme ersetzt die Öffnungen und Einbauten der früheren.
 * Maßband und Rechteck liefern keine – dann bleiben die gezielten als
 * Handeinträge stehen. Von Hand gesetzte bleiben, solange ihre Wand noch
 * existiert. Was wegfällt, wird gezählt. Gibt Hinweise (Sätze) zurück.
 */
export function uebernehmen(projekt, raumId, e, neueId) {
  const raum = projekt.raeume.find(r => r.id === raumId);
  if (!raum || !e) return [];
  const hinweise = [];
  const punkte = G.umrissLesen(e.umriss);
  if (punkte) {
    raum.umriss = G.umrissSchreiben(punkte);
    raum.breiteM = runde(Math.max(...punkte.map(p => p[0])));
    raum.tiefeM = runde(Math.max(...punkte.map(p => p[1])));
    raum.breiteVorneM = null; raum.schraege = "KEINE";
  } else {
    raum.umriss = "";
    if (e.breiteM > 0) raum.breiteM = runde(e.breiteM);
    if (e.tiefeM > 0) raum.tiefeM = runde(e.tiefeM);
    raum.breiteVorneM = null; raum.schraege = "KEINE";
  }
  if (e.hoeheM > 0) raum.hoeheM = runde(e.hoeheM);
  raum.aufmass = {
    methode: e.methode, datum: e.datum || new Date().toISOString(),
    waende: (e.waende || []).map(w => ({ quelle: w.quelle || Quelle.GETIPPT, sigmaM: w.sigmaM ?? null })),
    kamerahoeheM: e.kamerahoeheM ?? null, kalibriert: e.kalibriert ?? null, klasse: e.klasse ?? null
  };
  raum.aufnahme = e.aufnahme || null;

  const n = G.wandLaengen(raum).length;
  const ersetzen = e.methode === "zielen";
  const neuO = (e.oeffnungen || []).map(o => ({ ...o, id: o.id || neueId("oef"), raumId, ausAufnahme: true }));
  const neuE = (e.einbauten || []).map(x => ({ ...x, id: x.id || neueId("ein"), raumId, ausAufnahme: true }));
  const oe = sortieren(projekt.oeffnungen.filter(o => o.raumId === raumId), neuO, ersetzen, o => (o.wandIndex ?? 0) < n);
  const ei = sortieren(projekt.einbauten.filter(x => x.raumId === raumId), neuE, ersetzen,
    x => x.befestigung !== "WAND" || (x.wandIndex ?? 0) < n);
  if (oe.ersetzt + ei.ersetzt) hinweise.push(`${anzahl(oe.ersetzt, ei.ersetzt)} der früheren Zielaufnahme entfernt – die neue Aufnahme ersetzt sie.`);
  if (oe.weg + ei.weg) hinweise.push(`${anzahl(oe.weg, ei.weg)} entfernt – ihre Wand gibt es im neuen Umriss nicht mehr.`);
  if (oe.geloest + ei.geloest) hinweise.push(`${anzahl(oe.geloest, ei.geloest)} aus der Zielaufnahme bleiben als Handeintrag – Lage im neuen Umriss prüfen.`);
  projekt.oeffnungen = projekt.oeffnungen.filter(o => o.raumId !== raumId).concat(oe.behalte, neuO);
  projekt.einbauten = projekt.einbauten.filter(x => x.raumId !== raumId).concat(ei.behalte, neuE);
  return hinweise;
}

/**
 * Alte Objekte eines Raums sortieren: von einer neuen Zielaufnahme ersetzt,
 * wegen fehlender Wand entfernt oder behalten. Gezielte, die bleiben, gehören
 * ab jetzt dem Nutzer (`ausAufnahme = false`) – es gibt keine Aufnahme mehr,
 * aus der sie neu gerechnet würden.
 */
function sortieren(alte, neu, ersetzen, wandDa) {
  const erg = { behalte: [], ersetzt: 0, weg: 0, geloest: 0 };
  for (const y of alte) {
    if (ersetzen && y.ausAufnahme) { if (!neu.some(z => z.id === y.id)) erg.ersetzt++; continue; }
    if (!wandDa(y)) { erg.weg++; continue; }
    if (y.ausAufnahme) { y.ausAufnahme = false; erg.geloest++; }
    erg.behalte.push(y);
  }
  return erg;
}

const anzahl = (o, e) => [o ? `${o} Öffnung(en)` : "", e ? `${e} Einbau(ten)` : ""].filter(Boolean).join(" und ");

/**
 * Wände eines Raums mit Länge und Maß-Herkunft – für Listen und Report.
 * [{ laenge, quelle, sigmaM }]
 */
export function waendeMitHerkunft(raum) {
  const laengen = G.wandLaengen(raum);
  const her = raum.aufmass?.waende || [];
  return laengen.map((laenge, i) => ({
    laenge,
    quelle: her.length === laengen.length ? (her[i]?.quelle || Quelle.GETIPPT) : Quelle.GETIPPT,
    sigmaM: her.length === laengen.length ? (her[i]?.sigmaM ?? null) : null
  }));
}

/**
 * Eine Wand nachmessen. Gezielte Räume werden aus ihren Strahlen neu gerechnet;
 * neu gesetzt werden dabei nur Öffnungen/Einbauten, die im Projekt noch als
 * gezielt gelten (`ausAufnahme`) – von Hand geänderte bleiben, wie sie sind,
 * gelöschte verschwinden auch aus der Aufnahme. Alle anderen Räume über den
 * Zugausgleich: die gemessene Wand und alle schon per Bandmaß gesicherten
 * bleiben fest, der Rest schließt die Lücke; widerspricht das neue Maß einem
 * älteren, gilt das neue, und rechte Winkel bleiben rechte Winkel. `laengeM`
 * leer/0 nimmt ein Bandmaß zurück. Gibt Hinweise zurück.
 */
export function nachmessen(projekt, raumId, wandIndex, laengeM, neueId) {
  const raum = projekt.raeume.find(r => r.id === raumId);
  if (!raum) return [];
  const m = Number(laengeM);
  if (raum.aufnahme && raum.aufnahme.methode === "zielen") {
    const a = raum.aufnahme;
    // Gelöschte Objekte auch aus der Aufnahme nehmen – sonst kämen sie beim
    // Neurechnen zurück, und eine gelöschte Tür bliebe Maßstab. Von Hand
    // geänderte (ausAufnahme = false) bleiben als Strahl stehen, werden aber
    // nicht mehr neu gerechnet.
    a.oeffnungen = (a.oeffnungen || []).filter(o => projekt.oeffnungen.some(x => x.id === o.id));
    a.einbauten = (a.einbauten || []).filter(e => projekt.einbauten.some(x => x.id === e.id));
    a.bandmasse = { ...(a.bandmasse || {}) };
    if (m > 0) a.bandmasse[wandIndex] = m; else delete a.bandmasse[wandIndex];
    const r = A.rekonstruiere(a, { aufbauM: raum.aufbauM });
    if (!r) return ["Aufnahme unvollständig – nicht neu gerechnet."];
    // Noch gezielte Öffnungen/Einbauten per ID aktualisieren, damit
    // Bezeichnungen und Zuordnungen erhalten bleiben.
    const n = r.waende.length;
    uebernehmen(projekt, raumId, {
      methode: "zielen", umriss: r.umriss, hoeheM: r.hoeheM, waende: r.waende,
      kamerahoeheM: r.kamerahoeheM, kalibriert: r.kalibriert, klasse: r.klasse, aufnahme: a,
      oeffnungen: gezielteNeu(projekt.oeffnungen, r.oeffnungen, raumId, n, (alt, o) => ({ ...alt, ...o })),
      einbauten: gezielteNeu(projekt.einbauten, r.einbauten, raumId, n, (alt, x) => ({ ...alt, ...x, hoeheM: x.hoeheM ?? alt.hoeheM ?? null }))
    }, neueId);
    return r.hinweise;
  }

  // Ohne Strahlen: Polygonzug ausgleichen.
  const punkte = G.ecken(raum);
  const waende = punkte.map((a, i) => {
    const b = punkte[(i + 1) % punkte.length], c = punkte[(i + 2) % punkte.length];
    let d = (Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return { laenge: Math.hypot(b[0] - a[0], b[1] - a[1]), drehung: d };
  });
  if (wandIndex < 0 || wandIndex >= waende.length) return [];
  const her = waendeMitHerkunft(raum);
  if (m > 0) { waende[wandIndex].laenge = m; her[wandIndex] = { ...her[wandIndex], quelle: Quelle.BAND, sigmaM: 0.005 }; }
  else her[wandIndex] = { ...her[wandIndex], quelle: Quelle.GETIPPT };
  const fest = her.map((w, i) => (w.quelle === Quelle.BAND ? i : -1)).filter(i => i >= 0);
  // Nur Ecken, die schon rechtwinklig sind, bleiben es; andere Winkel bleiben, wie sie sind.
  const glatt = G.rechtwinklig(waende, 0.5);
  let aus = G.ausgleichen(glatt, fest);
  const hinweise = [];
  if (m > 0 && aus.restlueckeNachher > 0.02) {
    // Das neue Bandmaß widerspricht älteren (z. B. Gegenwand im Rechteck).
    // Statt eine Wand schräg zu ziehen, gilt das neue Maß; ältere, die dafür
    // nachgeben müssen, verlieren ihr „Bandmaß“ und werden genannt.
    const neu = G.ausgleichen(glatt, [wandIndex]);
    if (neu.restlueckeNachher <= 0.02) {
      aus = neu;
      fest.forEach(i => {
        if (i === wandIndex || Math.abs(neu.korrektur[i]) < 0.005) return;
        hinweise.push(`Wand ${i + 1}: früheres Bandmaß ${komma(glatt[i].laenge)} m passt nicht dazu – auf ${komma(neu.waende[i].laenge)} m angepasst, bitte nachmessen.`);
        her[i] = { ...her[i], quelle: Quelle.GETIPPT, sigmaM: null };
      });
    }
  }
  let x = 0, y = 0, r = 0;
  const neu = [[0, 0]];
  for (const w of aus.waende.slice(0, -1)) {
    x += w.laenge * Math.cos(r * Math.PI / 180); y += w.laenge * Math.sin(r * Math.PI / 180);
    neu.push([x, y]); r += w.drehung;
  }
  // Lage im Raumsystem erhalten: erste Ecke bleibt, wo sie war (Drehung der ersten Wand übernehmen).
  const phi = Math.atan2(punkte[1][1] - punkte[0][1], punkte[1][0] - punkte[0][0]);
  const gedreht = neu.map(([px, py]) => [px * Math.cos(phi) - py * Math.sin(phi), px * Math.sin(phi) + py * Math.cos(phi)]);
  const norm = G.normieren(gedreht);
  raum.umriss = G.umrissSchreiben(norm);
  raum.breiteM = runde(Math.max(...norm.map(p => p[0])));
  raum.tiefeM = runde(Math.max(...norm.map(p => p[1])));
  raum.breiteVorneM = null; raum.schraege = "KEINE";
  raum.aufmass = { ...(raum.aufmass || { methode: "getippt" }), waende: her.map(w => ({ quelle: w.quelle, sigmaM: w.sigmaM })) };
  if (aus.restlueckeNachher > 0.02)
    hinweise.push(`Restlücke ${Math.round(aus.restlueckeNachher * 100)} cm – die gemessenen Wände passen nicht zusammen.`);
  else if (aus.restlueckeVorher > 0.02 && !hinweise.length)
    hinweise.push(`${Math.round(aus.restlueckeVorher * 100)} cm Unterschied auf die nicht gemessenen Wände verteilt.`);
  return hinweise;
}

/**
 * Raumhöhe (ab Fertigfußboden) von Hand setzen. Bei gezielt aufgenommenen
 * Räumen geht sie auch in die Aufnahme ein – als bekannte Höhe über dem
 * gezielten Boden –, damit ein späteres Nachmessen sie nicht überschreibt.
 */
export function raumhoeheSetzen(raum, hoeheM) {
  const h = Number(hoeheM);
  if (!raum || !(h > 0)) return;
  raum.hoeheM = runde(h);
  const a = raum.aufnahme;
  if (a && a.methode === "zielen") a.raumhoeheM = h + (a.boden === "roh" ? (Number(raum.aufbauM) || 0) : 0);
}

/**
 * Objekte des Raums, die noch als gezielt gelten, mit ihrer Neurechnung
 * zusammenführen. Wer jetzt keine Wand mehr trifft, behält seinen alten Stand,
 * statt still zu verschwinden.
 */
function gezielteNeu(liste, neu, raumId, n, mischen) {
  return liste.filter(x => x.raumId === raumId && x.ausAufnahme)
    .map(alt => { const x = neu.find(y => y.id === alt.id); return x ? mischen(alt, x) : alt; })
    .filter(x => x.befestigung === "DECKE" || (x.wandIndex ?? 0) < n);
}

const runde = v => Math.round(v * 100) / 100;
const komma = v => Number(v).toFixed(2).replace(".", ",");
