/*
 * Grundriss-Ansicht mit Planung – die sichtbare Hälfte von Schicht ③.
 *
 * Zeichnet den gemessenen Raum (Wände mit Nummern und Maßketten, Öffnungen,
 * Einbauten) und darauf die Planung: die maßstabsgetreuen Klötzchen mit ihren
 * Freiraumzonen. Die Zone ist grün, solange der geforderte Bedienbereich frei
 * ist, und rot, sobald ein Klötzchen ihn unterschreitet – das ist die sichtbare
 * Normprüfung.
 *
 * Bedienung:
 *  · Klötzchen ziehen; nahe einer Wand rasten sie mit dem Rücken an die Wand.
 *  · Werkzeug „Messen" misst Punkt-zu-Punkt und Fläche, konservativ gerundet.
 *    Die Fläche schließt ein Tipp auf den ersten Punkt, ein Doppeltipp bzw.
 *    Doppelklick oder `messungAbschliessen()` (Knopf der App).
 *  · Rad oder zwei Finger zoomen, Ziehen des Hintergrunds verschiebt.
 *
 * Alles Gezeichnete stammt aus gespeicherten oder importierten Projekten:
 * Texte und Kennungen werden maskiert, Farben geprüft, und ein Objekt mit
 * unbrauchbaren Werten (etwa an einer Wand, die es nicht mehr gibt) wird
 * ausgelassen, statt den ganzen Plan anzuhalten. Linien und Schrift tragen
 * eigene Darstellungsattribute; die Stylesheets der Apps überschreiben sie,
 * ohne Stylesheet bleibt der Plan trotzdem lesbar.
 *
 * Reine Darstellung und Zeigergeometrie; jede Zustandsänderung meldet die
 * Ansicht über Rückrufe an die App, die das Modell führt und neu prüft.
 */

import * as G from "../geometrie.js";
import { fixtureSymbol, openingSymbol } from "../symbole.js";
import { grundriss } from "../pruefung.js";
import { finde } from "../komponenten.js";
import { fuer, Richtung } from "../regelwerk.js";
import * as Normmasse from "../normmasse.js";

const MASS_MIN_PX = 40;         // kürzere Wände bekommen keine Maßkette
const FANG_MAUS = 14;           // Fangradius „erster Punkt schließt die Fläche"
const FANG_FINGER = 24;         // … mit dem Finger, der ungenauer trifft
const DOPPELTIPP_MS = 600;
const ZOOM_MIN = 10, ZOOM_MAX = 600;
const STANDARD_FARBE = "#cfe8e9";

export class Plan {
  constructor(svg, rueckrufe = {}) {
    this.svg = svg;
    this.cb = rueckrufe;
    this.modell = { raum: null, oeffnungen: [], einbauten: [], platzhalter: [], fotos: [], befunde: [], auswahl: null, masse: true };
    this.modus = "auswahl";
    this.scale = 120;           // Bildpunkte je Meter
    this.ox = 40; this.oy = 40; // Ursprung des Raums auf dem Schirm
    this.messpunkte = [];       // laufende Messung (Meter) – die App liest die Anzahl
    this.vorschau = null;       // Mauszeiger beim Messen (Gummiband)
    this.zieh = null;           // aktiver Zieh-/Schiebe-Vorgang
    this.zeiger = new Map();    // aufgesetzte Zeiger: pointerId → [clientX, clientY]
    this.geste = null;          // laufende Zwei-Finger-Geste
    this._fang = FANG_MAUS;
    this._letzterTipp = 0;
    this._bild = 0;             // angefordertes Neuzeichnen
    this._einpassenOffen = false;
    // Gesten gehören dem Plan – sonst zoomt oder scrollt der Browser die Seite.
    if (svg.style) svg.style.touchAction = "none";
    this._zeiger();
  }

  setModell(m) {
    // Ein anderer Raum wird beim nächsten Zeichnen eingepasst – auch wenn die
    // App erst einpasst und danach das Modell setzt.
    if (m && m.raum && m.raum !== this.modell.raum && m.raum.id !== this.modell.raum?.id) this._einpassenOffen = true;
    Object.assign(this.modell, m);
    return this;
  }

  setModus(modus) {
    this.modus = modus;
    this.messpunkte = [];
    this.vorschau = null;
    this.zeichne();
    this.cb.onMesspunkte?.(0);
  }

  /** Laufende Messung abschließen (z. B. Knopf „Fläche schließen"). true = Ergebnis gemeldet. */
  messungAbschliessen() {
    if (this.messpunkte.length < (this.modus === "messen-strecke" ? 2 : 3)) return false;
    this._messungAbschluss();
    return true;
  }

  // ------------------------------------------------ Koordinaten

  nachSchirm(mx, my) { return [this.ox + mx * this.scale, this.oy + my * this.scale]; }
  nachWelt(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }

  _zeigerWelt(ev) {
    const r = this._groesse();
    return this.nachWelt(ev.clientX - r.left, ev.clientY - r.top);
  }

  /** Größe der Zeichenfläche; ein nicht eingehängtes SVG liefert seine Attribute. */
  _groesse() {
    const r = this.svg.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    if (r.width > 0 && r.height > 0) return r;
    const w = Number(this.svg.getAttribute?.("width")) || 0, h = Number(this.svg.getAttribute?.("height")) || 0;
    return { left: r.left || 0, top: r.top || 0, width: w, height: h };
  }

  _sichtbar() { const r = this._groesse(); return r.width >= 40 && r.height >= 40; }

  /** Ansicht auf den Raum einpassen. */
  einpassen() {
    const raum = this.modell.raum;
    if (!raum || !this._sichtbar()) {
      // Noch kein Raum oder die Fläche ist verborgen: beim nächsten Zeichnen nachholen.
      this._einpassenOffen = true;
      if (raum) this.zeichne();
      return;
    }
    this._einpassenOffen = false;
    const e = eckenSicher(raum);
    if (e) {
      const r = this._groesse();
      const xs = e.map(p => p[0]), ys = e.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      // Rand für Maßketten und Wandnummern.
      const mitOeff = (this.modell.oeffnungen || []).some(o => wandNr(o, e.length) >= 0);
      const rand = this.modell.masse === false ? 56 : (mitOeff ? 82 : 70);
      const s = Math.min((r.width - 2 * rand) / Math.max(maxX - minX, 0.5),
        (r.height - 2 * rand) / Math.max(maxY - minY, 0.5));
      this.scale = Number.isFinite(s) ? Math.max(ZOOM_MIN, Math.min(400, s)) : 120;
      this.ox = (r.width - (minX + maxX) * this.scale) / 2;
      this.oy = (r.height - (minY + maxY) * this.scale) / 2;
    }
    this.zeichne();
  }

  // ------------------------------------------------ Zeichnen

  zeichne() {
    if (this._bild) { cancelAnimationFrame(this._bild); this._bild = 0; }
    const { raum } = this.modell;
    if (!raum) { this.svg.innerHTML = ""; return; }
    if (this._einpassenOffen && this._sichtbar()) { this.einpassen(); return; }

    const teile = [];
    this._ziele = [];           // Mittelpunkte kleiner Objekte für überlappende Trefferkreise
    // Eine kaputte Ebene darf den Plan – und damit die App – nicht anhalten.
    const ebene = fn => { try { teile.push(fn()); } catch (_) { /* Ebene auslassen */ } };
    ebene(() => this._raster());
    const e = eckenSicher(raum);
    let lage = null;
    try { lage = e && this._lage(raum, e); } catch (_) { lage = null; }
    if (lage) {
      const kloetze = this._kloetze();
      ebene(() => this._boden(raum, e));
      ebene(() => this._zonen(kloetze));
      ebene(() => this._waende(lage));
      ebene(() => this._oeffnungen(lage));
      ebene(() => this._masse(raum, lage));
      ebene(() => kloetze.map(k => this._klotz(k)).join(""));
      ebene(() => this._wandnummern(lage));
      ebene(() => this._einbauten(raum, lage));
      ebene(() => this._fotos(raum));
    } else {
      teile.push(`<text x="20" y="40" font-size="13" fill="#c0392b">Raumgeometrie unbrauchbar – Maße im Raum prüfen.</text>`);
    }
    let messung = "";
    try { messung = this._messungInhalt(); } catch (_) { messung = ""; }
    teile.push(`<g class="messung" pointer-events="none">${messung}</g>`);
    this.svg.innerHTML = teile.join("");
  }

  /** Neuzeichnen beim nächsten Bild – Zoomen und Schieben erzeugen viele Ereignisse. */
  _bald() {
    if (typeof requestAnimationFrame !== "function") { this.zeichne(); return; }
    if (!this._bild) this._bild = requestAnimationFrame(() => { this._bild = 0; this.zeichne(); });
  }

  /** Wandgeometrie für einen Durchgang: Ecken, Längen, Außenrichtung, gültige Öffnungen. */
  _lage(raum, e) {
    const n = e.length;
    let summe = 0;
    for (let i = 0; i < n; i++) { const a = e[i], b = e[(i + 1) % n]; summe += a[0] * b[1] - b[0] * a[1]; }
    const orient = summe >= 0 ? 1 : -1;    // > 0: im Uhrzeigersinn (y nach unten)
    const laengen = [], richtung = [], aussen = [];
    for (let i = 0; i < n; i++) {
      const a = e[i], b = e[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = l ? (b[0] - a[0]) / l : 1, uy = l ? (b[1] - a[1]) / l : 0;
      laengen.push(l); richtung.push([ux, uy]); aussen.push([uy * orient, -ux * orient]);
    }
    const oeff = [];
    for (const o of this.modell.oeffnungen || []) {
      const i = wandNr(o, n);
      if (i < 0) continue;              // Wand gibt es nicht (mehr) – nicht zeichnen
      const breite = Number(o.breiteM ?? o.widthM), abstand = Number(o.abstandM ?? o.offsetM);
      if (!(breite > 0) || !Number.isFinite(abstand)) continue;
      const von = klemm(abstand, 0, laengen[i]), bis = klemm(abstand + breite, 0, laengen[i]);
      if (bis - von < 0.005) continue;
      oeff.push({ o, i, von, bis });
    }
    const masse = this.modell.masse !== false;
    return { e, n, laengen, richtung, aussen, oeff, aussenAbst: masse && oeff.length ? 36 : 24 };
  }

  /** Punkt auf Wand i, `t` Meter vom Wandanfang, plus `d` Bildpunkte nach außen. */
  _wandSchirm(lage, i, t, d = 0) {
    const a = this.nachSchirm(lage.e[i][0], lage.e[i][1]);
    const [ux, uy] = lage.richtung[i], [nx, ny] = lage.aussen[i];
    return [a[0] + ux * t * this.scale + nx * d, a[1] + uy * t * this.scale + ny * d];
  }

  _raster() {
    const r = this._groesse();
    const schritt = 0.5 * this.scale;
    if (!(schritt >= 8) || !(r.width > 0) || !(r.height > 0)) return "";
    const linien = [];
    for (let x = this.ox % schritt; x < r.width; x += schritt)
      linien.push(`<line x1="${z(x)}" y1="0" x2="${z(x)}" y2="${z(r.height)}"/>`);
    for (let y = this.oy % schritt; y < r.height; y += schritt)
      linien.push(`<line x1="0" y1="${z(y)}" x2="${z(r.width)}" y2="${z(y)}"/>`);
    return `<g class="raster" stroke="#dbe4e4" stroke-width="1">${linien.join("")}</g>`;
  }

  _boden(raum, e) {
    const pts = e.map(p => this._pkt(p[0], p[1])).join(" ");
    return `<polygon class="boden" points="${pts}" fill="${farbe(raum.farbe, STANDARD_FARBE)}"/>`;
  }

  _waende(lage) {
    const linien = [];
    for (let i = 0; i < lage.n; i++) {
      // Wandstücke zwischen den Öffnungen – jede Öffnung ist eine Lücke.
      const loecher = lage.oeff.filter(x => x.i === i).sort((a, b) => a.von - b.von);
      let t = 0;
      const stuecke = [];
      for (const l of loecher) { if (l.von > t) stuecke.push([t, l.von]); t = Math.max(t, l.bis); }
      if (t < lage.laengen[i]) stuecke.push([t, lage.laengen[i]]);
      for (const [von, bis] of stuecke) {
        const a = this._wandSchirm(lage, i, von), b = this._wandSchirm(lage, i, bis);
        linien.push(`<line x1="${z(a[0])}" y1="${z(a[1])}" x2="${z(b[0])}" y2="${z(b[1])}"/>`);
      }
    }
    return `<g class="wand" stroke="#16302f" stroke-width="4" stroke-linecap="round">${linien.join("")}</g>`;
  }

  _oeffnungen(lage) {
    const g = [];
    for (const x of lage.oeff) {
      const [px, py] = this._wandSchirm(lage, x.i, (x.von + x.bis) / 2);
      const [ux, uy] = lage.richtung[x.i], [nx, ny] = lage.aussen[x.i];
      // Das Zeichen öffnet nach lokal −y; Türen schlagen schematisch in den Raum.
      let winkel = Math.atan2(uy, ux) * 180 / Math.PI;
      const w = winkel * Math.PI / 180;
      if (Math.sin(w) * nx - Math.cos(w) * ny > 0) winkel += 180;
      g.push(`<g transform="translate(${z(px)} ${z(py)}) rotate(${z(winkel)})">${openingSymbol(x.o.art, (x.bis - x.von) * this.scale)}</g>`);
    }
    return `<g class="oeffnung">${g.join("")}</g>`;
  }

  /**
   * Maßketten außen an jeder Wand: Lichtmaß der Wand und – wo Öffnungen sind –
   * eine innere Kette mit Wandstücken und Öffnungsbreiten. Schrägstriche als
   * Maßbegrenzung, Zahl in Metern mit Komma, immer lesbar von unten/rechts.
   * Gezielte (nicht mit dem Band gemessene) Wände tragen ein „≈".
   */
  _masse(raum, lage) {
    if (this.modell.masse === false) return "";
    const her = Array.isArray(raum.aufmass?.waende) && raum.aufmass.waende.length === lage.n ? raum.aufmass.waende : null;
    const linien = [], hilfe = [], texte = [];
    const kette = (i, stellen, abst, groesse, vor) => {
      const [ux, uy] = lage.richtung[i], [nx, ny] = lage.aussen[i];
      const sx = (ux + nx) * 3.5, sy = (uy + ny) * 3.5;
      for (const t of stellen) {
        const h0 = this._wandSchirm(lage, i, t, 3), h1 = this._wandSchirm(lage, i, t, abst + 4);
        hilfe.push(`M${z(h0[0])} ${z(h0[1])}L${z(h1[0])} ${z(h1[1])}`);
        const q = this._wandSchirm(lage, i, t, abst);
        linien.push(`M${z(q[0] - sx)} ${z(q[1] - sy)}L${z(q[0] + sx)} ${z(q[1] + sy)}`);
      }
      const q0 = this._wandSchirm(lage, i, stellen[0], abst), q1 = this._wandSchirm(lage, i, stellen[stellen.length - 1], abst);
      linien.push(`M${z(q0[0])} ${z(q0[1])}L${z(q1[0])} ${z(q1[1])}`);
      let winkel = Math.atan2(uy, ux) * 180 / Math.PI;
      if (winkel >= 90) winkel -= 180; else if (winkel < -90) winkel += 180;
      for (let k = 1; k < stellen.length; k++) {
        const t0 = stellen[k - 1], t1 = stellen[k];
        if ((t1 - t0) * this.scale < 30) continue;          // Zahl passt nicht dazwischen
        const m = this._wandSchirm(lage, i, (t0 + t1) / 2, abst + groesse * 0.75 + 2);
        texte.push(`<text class="mass-text" transform="translate(${z(m[0])} ${z(m[1])}) rotate(${z(winkel)})" `
          + `text-anchor="middle" dominant-baseline="central" font-size="${groesse}" fill="currentColor">${esc(vor + massText(t1 - t0))}</text>`);
      }
    };
    for (let i = 0; i < lage.n; i++) {
      const L = lage.laengen[i];
      if (!(L * this.scale >= MASS_MIN_PX)) continue;
      const eigene = lage.oeff.filter(x => x.i === i);
      if (eigene.length) {
        const stellen = [0, L, ...eigene.flatMap(x => [x.von, x.bis])].sort((a, b) => a - b)
          .filter((t, k, l) => k === 0 || t - l[k - 1] > 0.004);
        kette(i, stellen, 16, 10, "");
      }
      kette(i, [0, L], lage.aussenAbst, 11, her?.[i]?.quelle === "gezielt" ? "≈" : "");
    }
    if (!linien.length) return "";
    return `<g class="masse" pointer-events="none">`
      + `<path class="mass-linie mass-hilfe" d="${hilfe.join("")}" fill="none" stroke="currentColor" stroke-width="0.7" opacity="0.45"/>`
      + `<path class="mass-linie" d="${linien.join("")}" fill="none" stroke="currentColor" stroke-width="1" opacity="0.8"/>`
      + texte.join("") + `</g>`;
  }

  /** Klötzchen mit Katalogeintrag und brauchbarer Lage; Unbrauchbares fällt heraus. */
  _kloetze() {
    const liste = [];
    const auswahl = this.modell.auswahl, befunde = this.modell.befunde || [];
    for (const ph of this.modell.platzhalter || []) {
      try {
        const komp = finde(ph.komponente);
        if (!komp || !Number.isFinite(Number(ph.xM)) || !Number.isFinite(Number(ph.yM))) continue;
        const eck = grundriss(ph, komp);
        if (!eck.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
        liste.push({
          ph, komp, eck,
          aktiv: auswahl?.typ === "platzhalter" && auswahl.id === ph.id,
          warnung: befunde.some(b => b.platzhalterId === ph.id && b.schwere === "WARNUNG")
        });
      } catch (_) { /* Klötzchen auslassen */ }
    }
    return liste;
  }

  /**
   * Freiraumzonen vor der Bedienseite (nur wenn eine VORNE-Regel gilt). Eigene
   * Ebene unter den Klötzchen und ohne Zeigerereignisse: die Zone ist Anzeige,
   * kein Griff – sonst schnappt sie Klicks auf Einbauten davor weg.
   */
  _zonen(kloetze) {
    const g = [];
    for (const { komp, eck, warnung } of kloetze) {
      const regel = fuer(komp.kategorie).find(r => r.richtung === Richtung.VORNE);
      if (!regel || !komp.bedienseiteVorn) continue;
      const fl = eck[3], fr = eck[2], bl = eck[0];      // Vorderkante
      const nx = fl[0] - bl[0], ny = fl[1] - bl[1];
      const len = Math.hypot(nx, ny) || 1;
      const d = Number(regel.abstandM) || 0;
      const zp = [fr, fl, [fl[0] + nx / len * d, fl[1] + ny / len * d], [fr[0] + nx / len * d, fr[1] + ny / len * d]]
        .map(p => this._pkt(p[0], p[1])).join(" ");
      g.push(`<polygon class="zone ${warnung ? "zone-warn warn" : "zone-ok"}" points="${zp}" `
        + `fill="${warnung ? "#c0392b" : "#2e8b57"}" opacity="${warnung ? 0.34 : 0.28}" pointer-events="none"/>`);
    }
    return `<g class="zonen" pointer-events="none">${g.join("")}</g>`;
  }

  _klotz({ ph, komp, eck, aktiv, warnung }) {
    const s = eck.map(p => this.nachSchirm(p[0], p[1]));
    const pts = s.map(p => `${z(p[0])},${z(p[1])}`).join(" ");
    const [fuellung, rand] = warnung ? ["#f6d5d2", "#c0392b"] : aktiv ? ["#b7e0df", "#2b7a78"] : ["#cdd9de", "#4a5a5a"];
    const vorne = `<line class="klotz-front" x1="${z(s[3][0])}" y1="${z(s[3][1])}" x2="${z(s[2][0])}" y2="${z(s[2][1])}" `
      + `stroke="${warnung ? "#c0392b" : "#17494d"}" stroke-width="3" stroke-linecap="round"/>`;
    const mitte = this.nachSchirm(Number(ph.xM), Number(ph.yM));
    // Beschriftung nur, soweit sie in den Kasten passt (≈ 6 px je Zeichen).
    const xs = s.map(p => p[0]);
    const zeichen = Math.min(14, Math.floor((Math.max(...xs) - Math.min(...xs) - 4) / 6));
    const beschriftung = this.scale > 55 && zeichen >= 5
      ? `<text class="klotz-text" x="${z(mitte[0])}" y="${z(mitte[1])}" text-anchor="middle" dominant-baseline="central" `
        + `font-size="10" font-weight="600" fill="#24343a" pointer-events="none">${esc(kurz(String(komp.name), zeichen))}</text>` : "";
    return `<g class="klotz${aktiv ? " aktiv" : ""}${warnung ? " warn" : ""}" data-ph="${esc(ph.id)}">`
      + `<polygon class="klotz-box" points="${pts}" fill="${fuellung}" stroke="${rand}" stroke-width="${aktiv ? 2.4 : 1.5}"/>`
      + vorne + beschriftung + `</g>`;
  }

  _wandnummern(lage) {
    const g = [];
    const masse = this.modell.masse !== false;
    for (let i = 0; i < lage.n; i++) {
      const L = lage.laengen[i];
      // Hinter der Maßkette, sonst knapp vor der Wand.
      const abst = masse && L * this.scale >= MASS_MIN_PX ? lage.aussenAbst + 30 : 24;
      const [x, y] = this._wandSchirm(lage, i, L / 2, abst);
      g.push(`<circle class="wandnr-kreis" cx="${z(x)}" cy="${z(y)}" r="10" fill="#fff" stroke="#2b7a78" stroke-width="1.4"/>`
        + `<text class="wandnr" x="${z(x)}" y="${z(y)}" text-anchor="middle" dominant-baseline="central" `
        + `font-size="11" font-weight="700" fill="#17494d">${i + 1}</text>`);
    }
    return `<g class="wandnummern" pointer-events="none">${g.join("")}</g>`;
  }

  /**
   * Einbauten über den Klötzchen – ein Schalter vor einem Schrank muss
   * anklickbar bleiben. Ein unsichtbarer Trefferkreis macht die kleinen
   * Zeichen auch mit dem Finger greifbar.
   */
  _einbauten(raum, lage) {
    const g = [];
    const auswahl = this.modell.auswahl;
    for (const e of this.modell.einbauten || []) {
      try {
        const wand = (e.befestigung ?? e.mount) === "WAND";
        const roh = e.wandIndex ?? e.wallIndex;
        let l, i = -1;
        if (wand && roh !== null && roh !== undefined) {
          i = wandNr(e, lage.n);
          if (i < 0) continue;            // Wand gibt es nicht (mehr) – nicht zeichnen
          l = G.lageImRaum(raum, { ...e, wandIndex: i });
        } else {
          l = G.lageImRaum(raum, e);
        }
        if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
        const [x, y] = this.nachSchirm(l.x, l.y);
        // Flache Seite an die Wand, Rest in den Raum – auch bei gegen den
        // Uhrzeigersinn erfasstem Umriss.
        let dreh = wand ? l.winkel + 180 : 0;
        if (wand && i >= 0) {
          const w = dreh * Math.PI / 180, [nx, ny] = lage.aussen[i];
          if (Math.sin(w) * nx - Math.cos(w) * ny > 0) dreh += 180;
        }
        const aktiv = auswahl?.typ === "einbau" && auswahl.id === e.id;
        const ring = aktiv ? `<circle class="ein-aktiv" cx="${z(x)}" cy="${z(y)}" r="15" fill="rgba(43,122,120,.18)" stroke="#2b7a78" stroke-width="2"/>` : "";
        this._ziele.push({ typ: "ein", id: String(e.id), x, y });
        g.push(`<g class="einbau-obj" data-ein="${esc(e.id)}">`
          + `<circle class="treffer" cx="${z(x)}" cy="${z(y)}" r="20" fill="transparent" stroke="none" pointer-events="all"/>`
          + ring
          + `<g transform="translate(${z(x)} ${z(y)}) rotate(${z(dreh)})">${fixtureSymbol(e.art)}</g></g>`);
      } catch (_) { /* Einbau auslassen */ }
    }
    return `<g class="einbau">${g.join("")}</g>`;
  }

  _fotos(raum) {
    const b = G.breite(raum) || 1, t = G.tiefe(raum) || 1;
    const g = [];
    (this.modell.fotos || []).forEach((f, i) => {
      const rx = Number(f.relX), ry = Number(f.relY);
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return;
      const [x, y] = this.nachSchirm(rx * b, ry * t);
      // Tropfen-Pin mit Kamera-Glyph; die Nummer verweist auf die Liste links.
      this._ziele.push({ typ: "foto", id: String(f.id), x, y: y - 8 });
      g.push(`<g class="foto-pin" data-foto="${esc(f.id)}" transform="translate(${z(x)} ${z(y)})" fill="#d98324" stroke="#8a4b0a">`
        + `<circle class="treffer" cx="0" cy="-8" r="20" fill="transparent" stroke="none" pointer-events="all"/>`
        + `<path class="pin-koerper" d="M0 4 C -10 -6 -9 -18 0 -18 C 9 -18 10 -6 0 4 Z" stroke-width="1.3"/>`
        + `<circle class="pin-loch" cx="0" cy="-12" r="6.5" fill="#fff" stroke-width="1.1"/>`
        + `<path class="pin-cam" d="M-4 -14 h1.4 l0.8 -1.2 h3.6 l0.8 1.2 H4 v5 H-4 Z" fill="#8a4b0a" stroke="none"/>`
        + `<circle class="pin-cam-l" cx="0" cy="-11.2" r="1.9" fill="#fff" stroke="none"/>`
        + `<text class="pin-nr" x="13" y="-9" font-size="11" font-weight="700" fill="#8a4b0a" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1}</text>`
        + `</g>`);
    });
    return `<g class="fotos">${g.join("")}</g>`;
  }

  /** Inhalt der Mess-Ebene: Punkte, Strecken mit Zwischenmaßen, laufende Fläche. */
  _messungInhalt() {
    const pkte = this.messpunkte;
    if (!pkte.length) return "";
    const flaeche = this.modus !== "messen-strecke";
    const s = pkte.map(p => this.nachSchirm(p[0], p[1]));
    const v = this.vorschau ? this.nachSchirm(this.vorschau[0], this.vorschau[1]) : null;
    const teile = [];
    const zug = v ? s.concat([v]) : s;
    if (zug.length >= 2) {
      const d = zug.map((p, i) => `${i ? "L" : "M"}${z(p[0])} ${z(p[1])}`).join("");
      teile.push(`<path class="mess-linie" d="${d}" fill="none" stroke="#17494d" stroke-width="1.6" stroke-dasharray="5 3"/>`);
    }
    if (flaeche && zug.length >= 3) {
      const l = zug[zug.length - 1];
      teile.push(`<line class="mess-linie mess-schluss" x1="${z(l[0])}" y1="${z(l[1])}" x2="${z(s[0][0])}" y2="${z(s[0][1])}" `
        + `stroke="#17494d" stroke-width="1.2" stroke-dasharray="2 4" opacity="0.5"/>`);
    }
    // Fangkreis um den ersten Punkt: dorthin tippen schließt die Fläche.
    if (flaeche && pkte.length >= 3)
      teile.push(`<circle class="mess-ziel" cx="${z(s[0][0])}" cy="${z(s[0][1])}" r="${this._fang}" `
        + `fill="#2b7a78" fill-opacity="0.12" stroke="#2b7a78" stroke-width="1.2" stroke-dasharray="3 2"/>`);
    for (const p of s)
      teile.push(`<circle class="mess-punkt" cx="${z(p[0])}" cy="${z(p[1])}" r="4" fill="#2b7a78" stroke="#fff" stroke-width="1.2"/>`);
    const text = (x, y, inhalt) => `<text class="mess-text" x="${z(x)}" y="${z(y)}" text-anchor="middle" font-size="12" font-weight="700" `
      + `fill="#17494d" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(inhalt)}</text>`;
    // Zwischenmaße an jeder Strecke (konservativ abgerundet).
    const welt = this.vorschau ? pkte.concat([this.vorschau]) : pkte;
    for (let i = 1; i < welt.length; i++) {
      const a = welt[i - 1], b = welt[i];
      const [tx, ty] = this.nachSchirm((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      teile.push(text(tx, ty - 6, `${massText(abrunden(Math.hypot(b[0] - a[0], b[1] - a[1])))} m`));
    }
    if (flaeche && welt.length >= 3) {
      const cx = welt.reduce((q, p) => q + p[0], 0) / welt.length, cy = welt.reduce((q, p) => q + p[1], 0) / welt.length;
      const [tx, ty] = this.nachSchirm(cx, cy);
      teile.push(text(tx, ty, `${massText(abrunden(G.flaechePunkte(welt)))} m²`));
    }
    return teile.join("");
  }

  /** Nur die Mess-Ebene erneuern – ein Neuaufbau des ganzen SVG verschluckt Klicks. */
  _messungGeaendert() {
    const g = this.svg.querySelector?.("g.messung");
    if (g) { try { g.innerHTML = this._messungInhalt(); } catch (_) { g.innerHTML = ""; } }
    else this.zeichne();
    this.cb.onMesspunkte?.(this.messpunkte.length);
  }

  _pkt(x, y) { const p = this.nachSchirm(x, y); return `${z(p[0])},${z(p[1])}`; }

  // ------------------------------------------------ Zeiger

  _zeiger() {
    const s = this.svg;
    if (!s.addEventListener) return;
    s.addEventListener("pointerdown", ev => this._runter(ev));
    s.addEventListener("pointermove", ev => this._bewegung(ev));
    s.addEventListener("pointerleave", () => { if (this.vorschau) { this.vorschau = null; this._messungGeaendert(); } });
    if (typeof window !== "undefined") {
      window.addEventListener("pointerup", ev => this._hoch(ev));
      window.addEventListener("pointercancel", ev => this._hoch(ev, true));
    }
    s.addEventListener("wheel", ev => this._rad(ev), { passive: false });
    s.addEventListener("dblclick", () => { if (String(this.modus).startsWith("messen")) this.messungAbschliessen(); });
  }

  _runter(ev) {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    // Der erste Zeiger einer Berührung: Reste einer verlorenen Geste vergessen.
    if (ev.isPrimary) { this.zeiger.clear(); this.geste = null; }
    this.zeiger.set(ev.pointerId, [ev.clientX, ev.clientY]);
    try { this.svg.setPointerCapture?.(ev.pointerId); } catch (_) { /* z. B. synthetische Ereignisse */ }
    if (this.zeiger.size >= 2) { this._gesteStart(); return; }

    // Finger: Auswählen, Platzieren und Messen erst beim Loslassen bzw. ab
    // einer Mindestbewegung – ein zweiter Finger macht daraus noch eine Geste.
    const finger = ev.pointerType === "touch" || ev.pointerType === "pen";
    this._fang = finger ? FANG_FINGER : FANG_MAUS;
    const welt = this._zeigerWelt(ev);
    const basis = { pid: ev.pointerId, start: [ev.clientX, ev.clientY], welt, finger, bewegt: false };
    const modus = String(this.modus || "");
    if (modus === "platzieren" || modus.startsWith("messen")) {
      // Antippen setzt bzw. misst; Ziehen verschiebt nur die Ansicht.
      this.zieh = { ...basis, typ: "schwenk", ox: this.ox, oy: this.oy, tipp: modus };
      return;
    }

    const ziel = ev.target && ev.target.closest ? ev.target : null;
    let zielFoto = ziel?.closest("[data-foto]");
    let zielEin = ziel?.closest("[data-ein]");
    const zielPh = ziel?.closest("[data-ph]");
    // Nur der unsichtbare Trefferkreis getroffen: Überlappen sich Kreise, gewinnt
    // das Objekt, dessen Mitte dem Zeiger am nächsten liegt – nicht das oberste.
    if ((zielFoto || zielEin) && ziel.getAttribute?.("class") === "treffer") {
      const n = this._naechstesZiel(ev);
      if (n) {
        const g = { getAttribute: () => n.id };
        zielFoto = n.typ === "foto" ? g : null;
        zielEin = n.typ === "ein" ? g : null;
      }
    }
    if (zielFoto) {
      const id = zielFoto.getAttribute("data-foto");
      const f = (this.modell.fotos || []).find(x => String(x.id) === id);
      if (f) { this.zieh = { ...basis, typ: "foto", f, vorher: nurGesetzte(f, ["relX", "relY"]) }; return; }
    }
    if (zielEin) {
      const id = zielEin.getAttribute("data-ein");
      const e = (this.modell.einbauten || []).find(x => String(x.id) === id);
      if (e) {
        this.zieh = { ...basis, typ: "einbau", e, aktiv: !finger,
          vorher: nurGesetzte(e, ["befestigung", "wandIndex", "abstandM", "relX", "relY"]) };
        if (!finger) this.cb.onEinbauSelect?.(e.id);
        return;
      }
    }
    if (zielPh) {
      const id = zielPh.getAttribute("data-ph");
      const ph = (this.modell.platzhalter || []).find(p => String(p.id) === id);
      if (ph) {
        this.zieh = { ...basis, typ: "klotz", ph, aktiv: !finger,
          greif: [welt[0] - Number(ph.xM), welt[1] - Number(ph.yM)],
          vorher: nurGesetzte(ph, ["xM", "yM", "drehungGrad"]) };
        if (!finger) this.cb.onSelect?.(ph.id);
        return;
      }
    }
    if (!finger) this.cb.onSelect?.(null);
    this.zieh = { ...basis, typ: "schwenk", ox: this.ox, oy: this.oy, abwaehlen: finger };
  }

  /** Nächstes kleines Objekt (Einbau, Foto) im Umkreis des Trefferkreises. */
  _naechstesZiel(ev) {
    const r = this._groesse();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    let beste = null, abstand = 22;
    for (const q of this._ziele || []) {
      const d = Math.hypot(q.x - px, q.y - py);
      if (d < abstand) { abstand = d; beste = q; }
    }
    return beste;
  }

  _bewegung(ev) {
    if (this.zeiger.has(ev.pointerId)) this.zeiger.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (this.geste) { this._gesteBewegung(); return; }
    const zg = this.zieh;
    if (!zg) { this._vorschauBewegung(ev); return; }
    if (zg.pid !== ev.pointerId) return;
    const dx = ev.clientX - zg.start[0], dy = ev.clientY - zg.start[1];
    if (!zg.bewegt && Math.hypot(dx, dy) >= (zg.finger ? 10 : 4)) zg.bewegt = true;

    if (zg.typ === "schwenk") {
      this.ox = zg.ox + dx;
      this.oy = zg.oy + dy;
      this._bald();
    } else if (zg.typ === "klotz") {
      if (!zg.aktiv) { if (!zg.bewegt) return; zg.aktiv = true; this.cb.onSelect?.(zg.ph.id); }
      const welt = this._zeigerWelt(ev);
      const ziel = this._einrasten(zg.ph, welt[0] - zg.greif[0], welt[1] - zg.greif[1]);
      zg.verschoben = true;
      this.cb.onPlatzhalterMove?.(zg.ph.id, ziel);
    } else if (zg.typ === "einbau") {
      if (!zg.aktiv) { if (!zg.bewegt) return; zg.aktiv = true; this.cb.onEinbauSelect?.(zg.e.id); }
      const welt = this._zeigerWelt(ev);
      zg.verschoben = true;
      this.cb.onEinbauMove?.(zg.e.id, this._einrastEinbau(zg.e, welt[0], welt[1]));
    } else if (zg.typ === "foto") {
      if (!zg.bewegt) return;
      const raum = this.modell.raum;
      const welt = this._zeigerWelt(ev);
      zg.verschoben = true;
      this.cb.onFotoMove?.(zg.f.id, {
        relX: klemm01(welt[0] / (G.breite(raum) || 1)),
        relY: klemm01(welt[1] / (G.tiefe(raum) || 1))
      });
    }
  }

  /** Gummiband: beim Messen mit der Maus folgt die nächste Strecke dem Zeiger. */
  _vorschauBewegung(ev) {
    if (ev.pointerType !== "mouse" || !this.messpunkte.length || !String(this.modus).startsWith("messen")) return;
    this.vorschau = this._fangEcke(this._zeigerWelt(ev));
    this._messungGeaendert();
  }

  _hoch(ev, abbruch = false) {
    if (!this.zeiger.has(ev.pointerId)) return;
    this.zeiger.delete(ev.pointerId);
    if (this.geste) {
      if (this.zeiger.size >= 2) this._gesteStart();
      else if (this.zeiger.size === 1) {
        // Ein Finger bleibt liegen: weiter verschieben, aber nichts antippen.
        const [pid, p] = this.zeiger.entries().next().value;
        this.geste = null;
        this.zieh = { typ: "schwenk", pid, start: p, ox: this.ox, oy: this.oy, bewegt: true, finger: true };
      } else this.geste = null;
      return;
    }
    const zg = this.zieh;
    if (!zg || zg.pid !== ev.pointerId) return;
    this.zieh = null;
    if (abbruch) return;

    if (zg.typ === "schwenk") {
      if (zg.bewegt) return;
      if (zg.tipp === "platzieren") this.cb.onPlace?.(zg.welt[0], zg.welt[1]);
      else if (zg.tipp) this._messTipp(zg.welt);
      else if (zg.abwaehlen) this.cb.onSelect?.(null);
    } else if (zg.typ === "klotz") {
      if (!zg.aktiv) this.cb.onSelect?.(zg.ph.id);
    } else if (zg.typ === "einbau") {
      if (!zg.aktiv) this.cb.onEinbauSelect?.(zg.e.id);
    } else if (zg.typ === "foto") {
      // Ein Foto-Pin ohne Bewegung war ein Klick: das echte Foto zeigen.
      if (!zg.bewegt) this.cb.onFotoOeffnen?.(zg.f.id);
    }
  }

  /** Zwei Finger: Zoom um die Mitte zwischen ihnen, gleichzeitig verschieben. */
  _gesteStart() {
    this._ziehAbbrechen();
    const [a, b] = [...this.zeiger.values()];
    const r = this._groesse();
    const mx = (a[0] + b[0]) / 2 - r.left, my = (a[1] + b[1]) / 2 - r.top;
    this.geste = {
      d0: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])),
      scale0: this.scale,
      welt: this.nachWelt(mx, my)
    };
  }

  _gesteBewegung() {
    const g = this.geste;
    const [a, b] = [...this.zeiger.values()];
    if (!a || !b) return;
    const r = this._groesse();
    const d = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const mx = (a[0] + b[0]) / 2 - r.left, my = (a[1] + b[1]) / 2 - r.top;
    this.scale = klemm(g.scale0 * d / g.d0, ZOOM_MIN, ZOOM_MAX);
    // Der Weltpunkt unter der Fingermitte bleibt unter der Fingermitte.
    this.ox = mx - g.welt[0] * this.scale;
    this.oy = my - g.welt[1] * this.scale;
    this._bald();
  }

  /** Ziehen des ersten Fingers abbrechen; was er schon verschoben hat, zurücknehmen. */
  _ziehAbbrechen() {
    const zg = this.zieh;
    this.zieh = null;
    if (!zg || !zg.verschoben) return;
    if (zg.typ === "klotz") this.cb.onPlatzhalterMove?.(zg.ph.id, zg.vorher);
    else if (zg.typ === "einbau") this.cb.onEinbauMove?.(zg.e.id, zg.vorher);
    else if (zg.typ === "foto") this.cb.onFotoMove?.(zg.f.id, zg.vorher);
  }

  _rad(ev) {
    ev.preventDefault();
    let dy = Number(ev.deltaY) || 0;
    if (ev.deltaMode === 1) dy *= 33; else if (ev.deltaMode === 2) dy *= 300;
    if (!dy) return;
    const r = this._groesse();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const welt = this.nachWelt(px, py);
    // Eine Mausrast (100) = Faktor 1,1; Touchpad-Gesten liefern feinere Schritte.
    const faktor = Math.pow(1.1, -klemm(dy / 100, -3, 3));
    this.scale = klemm(this.scale * faktor, ZOOM_MIN, ZOOM_MAX);
    // Zoom um den Zeiger: der Weltpunkt unter dem Zeiger bleibt stehen.
    this.ox = px - welt[0] * this.scale;
    this.oy = py - welt[1] * this.scale;
    this._bald();
  }

  /** Öffentlicher Einrast-Vorschlag – die App nutzt ihn beim Platzieren. */
  einrastVorschlag(ph, mx, my) { return this._einrasten(ph, mx, my); }
  einrastEinbauVorschlag(einbau, mx, my) { return this._einrastEinbau(einbau, mx, my); }

  /**
   * Ein Einbau folgt dem Zeiger: Wandgeräte rasten an die nächste Wand (Wand
   * und Abstand), Decken-/Bodengeräte werden über Anteile (0…1) des Rechtecks
   * gelegt – so bleibt ihre Lage erhalten, wenn der Raum neu vermessen wird.
   */
  _einrastEinbau(einbau, mx, my) {
    const raum = this.modell.raum;
    const bef = Normmasse.befestigung(einbau.art);
    if (bef === "WAND") {
      const w = G.naechsteWand(raum, mx, my);
      const laenge = G.wandLaengen(raum)[w.index] || 0;
      return {
        befestigung: "WAND", wandIndex: w.index,
        abstandM: r2(Math.max(0, Math.min(laenge, w.abstand)))
      };
    }
    const b = G.breite(raum) || 1, t = G.tiefe(raum) || 1;
    return { befestigung: bef, relX: klemm01(mx / b), relY: klemm01(my / t) };
  }

  /** Nahe einer Wand mit dem Rücken einrasten, sonst frei aufs Raster. */
  _einrasten(ph, mx, my) {
    const raum = this.modell.raum;
    const komp = finde(ph.komponente);
    // Die Breite liegt entlang der Wand (pruefung.grundriss), die Tiefe quer dazu.
    const hb = komp ? Number(komp.breiteM) / 2 : 0;
    const ht = komp ? Number(komp.tiefeM) / 2 : 0;
    const w = G.naechsteWand(raum, mx, my);
    // An die Wand einrasten, wenn nahe genug – oder wenn außerhalb des Raums
    // abgelegt: ein Wandgerät gehört an eine Wand, nicht ins Freie daneben.
    if (komp && (w.entfernung < 0.6 || !G.imRaum(raum, mx, my))) {
      const e = G.ecken(raum);
      const a = e[w.index], b = e[(w.index + 1) % e.length];
      const phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const laenge = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Entlang der Wand um die halbe Breite von den Ecken weg – sonst ragt das
      // Gerät durch die Nachbarwand. Ist die Wand zu kurz: mittig.
      const t = laenge >= 2 * hb ? Math.max(hb, Math.min(laenge - hb, w.abstand)) : laenge / 2;
      const wx = a[0] + Math.cos(phi) * t, wy = a[1] + Math.sin(phi) * t;
      let theta = phi;
      let nx = -Math.sin(theta), ny = Math.cos(theta);
      if (!G.imRaum(raum, wx + nx * 0.05, wy + ny * 0.05)) { theta += Math.PI; nx = -nx; ny = -ny; }
      let grad = theta * 180 / Math.PI;
      grad = ((Math.round(grad) % 360) + 360) % 360;
      return { xM: r2(wx + nx * ht), yM: r2(wy + ny * ht), drehungGrad: grad };
    }
    const raster = 0.05;
    return {
      xM: r2(Math.round(mx / raster) * raster),
      yM: r2(Math.round(my / raster) * raster),
      drehungGrad: Number(ph.drehungGrad || 0)
    };
  }

  // ------------------------------------------------ Messen

  /**
   * Ein Tipp im Messwerkzeug. Fläche: Tipp auf den ersten Punkt (ab drei
   * Punkten) oder Doppeltipp auf den letzten schließt sie. Ein zweiter Tipp
   * auf denselben Punkt setzt keinen doppelten Punkt. Raumecken fangen.
   */
  _messTipp(welt) {
    const flaeche = this.modus !== "messen-strecke";
    const s = this.nachSchirm(welt[0], welt[1]);
    const nahe = q => { const t = this.nachSchirm(q[0], q[1]); return Math.hypot(s[0] - t[0], s[1] - t[1]) <= this._fang; };
    const n = this.messpunkte.length;
    const jetzt = Date.now();
    if (flaeche && n >= 3 && nahe(this.messpunkte[0])) { this._messungAbschluss(); return; }
    if (n && nahe(this.messpunkte[n - 1])) {
      const doppel = jetzt - this._letzterTipp < DOPPELTIPP_MS;
      this._letzterTipp = jetzt;
      if (flaeche && n >= 3 && doppel) this._messungAbschluss();
      return;
    }
    this._letzterTipp = jetzt;
    this.messpunkte.push(this._fangEcke(welt));
    if (!flaeche && this.messpunkte.length >= 2) { this._messungAbschluss(); return; }
    this._messungGeaendert();
  }

  /** Nahe einer Raumecke genau auf die Ecke – so misst man den Raum selbst nach. */
  _fangEcke(welt) {
    const e = this.modell.raum ? eckenSicher(this.modell.raum) : null;
    if (!e) return welt;
    const s = this.nachSchirm(welt[0], welt[1]);
    let beste = null, abstand = this._fang * 0.75;
    for (const q of e) {
      const t = this.nachSchirm(q[0], q[1]);
      const d = Math.hypot(s[0] - t[0], s[1] - t[1]);
      if (d < abstand) { abstand = d; beste = q; }
    }
    return beste ? [beste[0], beste[1]] : welt;
  }

  _messungAbschluss() {
    const pkte = this.messpunkte;
    this.messpunkte = [];
    let ergebnis = null;
    if (pkte.length >= 2) {
      if (this.modus === "messen-flaeche" || pkte.length > 2) {
        let umfang = 0;
        for (let i = 0; i < pkte.length; i++) {
          const a = pkte[i], b = pkte[(i + 1) % pkte.length];
          umfang += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        ergebnis = { art: "flaeche", flaecheM2: abrunden(G.flaechePunkte(pkte)), umfangM: abrunden(umfang), punkte: pkte.length };
      } else {
        const a = pkte[0], b = pkte[1];
        ergebnis = { art: "strecke", laengeM: abrunden(Math.hypot(b[0] - a[0], b[1] - a[1])) };
      }
    }
    this._messungGeaendert();
    if (ergebnis) this.cb.onMessung?.(ergebnis);
  }
}

// -------------------------------------------------- kleine Helfer

/** Ecken des Raums, oder null, wenn sie sich nicht zeichnen lassen. */
function eckenSicher(raum) {
  try {
    const e = G.ecken(raum);
    return Array.isArray(e) && e.length >= 3 && e.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? e : null;
  } catch (_) {
    return null;
  }
}

/** Gültige Wandnummer (0 … n−1) einer Öffnung/eines Einbaus, sonst −1. */
function wandNr(o, n) {
  const roh = o?.wandIndex ?? o?.wallIndex;
  if (roh === null || roh === undefined || roh === "") return -1;
  const i = Number(roh);
  return Number.isInteger(i) && i >= 0 && i < n ? i : -1;
}

/** Nur die vorhandenen Felder kopieren – zum Zurücknehmen eines Ziehens. */
function nurGesetzte(o, felder) {
  const kopie = {};
  for (const f of felder) if (o[f] !== undefined) kopie[f] = o[f];
  return kopie;
}

/** Text für SVG-Inhalt und -Attribute maskieren. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Nur echte Hex-Farben durchlassen – alles andere wäre fremdes Markup im Attribut. */
function farbe(f, ersatz) { return typeof f === "string" && /^#[0-9a-fA-F]{3,8}$/.test(f) ? f : ersatz; }

/** Bildschirmzahl fürs SVG: auf 0,1 px gerundet, nie NaN. */
function z(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0; }

/** Meter mit Dezimalkomma: 4.125 → „4,13". */
function massText(m) { return (Math.round(m * 100) / 100).toFixed(2).replace(".", ","); }

const r2 = v => Math.round(v * 100) / 100;
const abrunden = v => Math.floor(v * 100) / 100;     // konservativ: lieber zu wenig
const klemm = (v, a, b) => Math.max(a, Math.min(b, v));
const klemm01 = v => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
const kurz = (name, max = 14) => name.length > max ? name.slice(0, max - 1) + "…" : name;
