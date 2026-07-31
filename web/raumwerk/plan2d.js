/*
 * Grundriss-Ansicht mit Planung – die sichtbare Hälfte von Schicht ③.
 *
 * Zeichnet den gemessenen Raum (Wände mit Nummern, Öffnungen, Einbauten) und
 * darauf die Planung: die maßstabsgetreuen Klötzchen mit ihren Freiraumzonen.
 * Die Zone ist grün, solange der geforderte Bedienbereich frei ist, und rot,
 * sobald ein Klötzchen ihn unterschreitet – das ist die sichtbare Normprüfung.
 *
 * Bedienung:
 *  · Klötzchen ziehen; nahe einer Wand rasten sie mit dem Rücken an die Wand.
 *  · Werkzeug „Messen" misst Punkt-zu-Punkt und Fläche, konservativ gerundet.
 *  · Rad zoomt, Ziehen des Hintergrunds verschiebt.
 *
 * Reine Darstellung und Zeigergeometrie; jede Zustandsänderung meldet die
 * Ansicht über Rückrufe an die App, die das Modell führt und neu prüft.
 */

import * as G from "../geometrie.js";
import { fixtureSymbol, openingSymbol } from "../symbole.js";
import { grundriss } from "../pruefung.js";
import { finde } from "../komponenten.js";
import { fuer, Richtung } from "../regelwerk.js";

const NS = "http://www.w3.org/2000/svg";

export class Plan {
  constructor(svg, rueckrufe = {}) {
    this.svg = svg;
    this.cb = rueckrufe;
    this.modell = { raum: null, oeffnungen: [], einbauten: [], platzhalter: [], befunde: [], auswahlId: null };
    this.modus = "auswahl";
    this.scale = 120;           // Bildpunkte je Meter
    this.ox = 40; this.oy = 40; // Ursprung des Raums auf dem Schirm
    this.messpunkte = [];       // laufende Messung
    this.zieh = null;           // aktiver Zieh-/Schiebe-Vorgang
    this._zeiger();
  }

  setModell(m) { Object.assign(this.modell, m); return this; }
  setModus(modus) { this.modus = modus; this.messpunkte = []; this.zeichne(); }

  // ------------------------------------------------ Koordinaten

  nachSchirm(mx, my) { return [this.ox + mx * this.scale, this.oy + my * this.scale]; }
  nachWelt(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }

  _zeigerWelt(ev) {
    const r = this.svg.getBoundingClientRect();
    return this.nachWelt(ev.clientX - r.left, ev.clientY - r.top);
  }

  /** Ansicht auf den Raum einpassen. */
  einpassen() {
    const raum = this.modell.raum;
    if (!raum) return;
    const e = G.ecken(raum);
    const maxX = Math.max(...e.map(p => p[0])), maxY = Math.max(...e.map(p => p[1]));
    const r = this.svg.getBoundingClientRect();
    const rand = 60;
    this.scale = Math.min((r.width - 2 * rand) / (maxX || 1), (r.height - 2 * rand) / (maxY || 1));
    this.scale = Math.max(30, Math.min(400, this.scale));
    this.ox = (r.width - maxX * this.scale) / 2;
    this.oy = (r.height - maxY * this.scale) / 2;
    this.zeichne();
  }

  // ------------------------------------------------ Zeichnen

  zeichne() {
    const { raum } = this.modell;
    if (!raum) { this.svg.innerHTML = ""; return; }
    const teile = [];
    teile.push(this._raster());
    teile.push(this._boden(raum));
    teile.push(this._waende(raum));
    teile.push(this._oeffnungen(raum));
    teile.push(this._einbauten(raum));
    for (const ph of this.modell.platzhalter) teile.push(this._klotz(ph));
    teile.push(this._wandnummern(raum));
    teile.push(this._messung());
    this.svg.innerHTML = teile.join("");
  }

  _raster() {
    const r = this.svg.getBoundingClientRect();
    const linien = [];
    const schritt = 0.5 * this.scale;
    if (schritt < 8) return "";
    for (let x = this.ox % schritt; x < r.width; x += schritt)
      linien.push(`<line x1="${x}" y1="0" x2="${x}" y2="${r.height}"/>`);
    for (let y = this.oy % schritt; y < r.height; y += schritt)
      linien.push(`<line x1="0" y1="${y}" x2="${r.width}" y2="${y}"/>`);
    return `<g class="raster">${linien.join("")}</g>`;
  }

  _boden(raum) {
    const pts = G.ecken(raum).map(p => this.nachSchirm(p[0], p[1]).join(",")).join(" ");
    return `<polygon class="boden" points="${pts}" fill="${raum.farbe || "#cfe8e9"}"/>`;
  }

  _waende(raum) {
    const linien = [];
    const laengen = G.wandLaengen(raum);
    for (let i = 0; i < laengen.length; i++) {
      const eigene = this.modell.oeffnungen.filter(o => (o.wandIndex ?? o.wallIndex) === i);
      const stuecke = G.wandStuecke(raum, i, eigene)
        .filter(s => s.unten <= 0.001 && s.oben >= (Number(raum.hoeheM) - 0.001));
      const voll = stuecke.length ? stuecke : [{ von: 0, bis: laengen[i] }];
      for (const s of voll) {
        const a = this.nachSchirm(...pktAufWand(raum, i, s.von));
        const b = this.nachSchirm(...pktAufWand(raum, i, s.bis));
        linien.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
      }
    }
    return `<g class="wand">${linien.join("")}</g>`;
  }

  _oeffnungen(raum) {
    const g = [];
    for (const o of this.modell.oeffnungen) {
      const i = o.wandIndex ?? o.wallIndex;
      const breite = Number(o.breiteM ?? o.widthM);
      const mitte = pktAufWand(raum, i, Number(o.abstandM ?? o.offsetM) + breite / 2);
      const [x, y] = this.nachSchirm(...mitte);
      const winkel = wandWinkel(raum, i);
      g.push(`<g transform="translate(${x} ${y}) rotate(${winkel})">${openingSymbol(o.art, breite * this.scale)}</g>`);
    }
    return `<g class="oeffnung">${g.join("")}</g>`;
  }

  _einbauten(raum) {
    const g = [];
    for (const e of this.modell.einbauten) {
      const l = G.lageImRaum(raum, e);
      const [x, y] = this.nachSchirm(l.x, l.y);
      const dreh = (e.befestigung ?? e.mount) === "WAND" ? l.winkel + 180 : 0;
      g.push(`<g transform="translate(${x} ${y}) rotate(${dreh})">${fixtureSymbol(e.art)}</g>`);
    }
    return `<g class="einbau">${g.join("")}</g>`;
  }

  _klotz(ph) {
    const komp = finde(ph.komponente);
    if (!komp) return "";
    const eck = grundriss(ph, komp).map(p => this.nachSchirm(p[0], p[1]));
    const ausgewaehlt = ph.id === this.modell.auswahlId;
    const warnung = this.modell.befunde.some(
      b => b.platzhalterId === ph.id && b.schwere === "WARNUNG");

    // Freiraumzone vor der Bedienseite (nur wenn eine VORNE-Regel gilt).
    let zone = "";
    const regel = fuer(komp.kategorie).find(r => r.richtung === Richtung.VORNE);
    if (regel && komp.bedienseiteVorn) {
      const fl = grundriss(ph, komp)[3], fr = grundriss(ph, komp)[2];   // Vorderkante
      const bl = grundriss(ph, komp)[0];
      const nx = fl[0] - bl[0], ny = fl[1] - bl[1];
      const len = Math.hypot(nx, ny) || 1;
      const d = regel.abstandM;
      const zp = [fr, fl, [fl[0] + nx / len * d, fl[1] + ny / len * d], [fr[0] + nx / len * d, fr[1] + ny / len * d]]
        .map(p => this.nachSchirm(p[0], p[1]).join(",")).join(" ");
      zone = `<polygon class="zone ${warnung ? "zone-warn" : "zone-ok"}" points="${zp}"/>`;
    }

    const pts = eck.map(p => p.join(",")).join(" ");
    const vorne = `<line class="klotz-front" x1="${eck[3][0]}" y1="${eck[3][1]}" x2="${eck[2][0]}" y2="${eck[2][1]}"/>`;
    const mitte = this.nachSchirm(Number(ph.xM), Number(ph.yM));
    const name = kurz(komp.name);
    const beschriftung = this.scale > 55
      ? `<text class="klotz-text" x="${mitte[0]}" y="${mitte[1]}" text-anchor="middle" dominant-baseline="central">${name}</text>` : "";
    return `<g class="klotz ${ausgewaehlt ? "aktiv" : ""} ${warnung ? "warn" : ""}" data-ph="${ph.id}">`
      + zone
      + `<polygon class="klotz-box" points="${pts}"/>` + vorne + beschriftung + `</g>`;
  }

  _wandnummern(raum) {
    const g = [];
    const e = G.ecken(raum);
    const mx = e.reduce((s, p) => s + p[0], 0) / e.length;
    const my = e.reduce((s, p) => s + p[1], 0) / e.length;
    for (let i = 0; i < e.length; i++) {
      const a = e[i], b = e[(i + 1) % e.length];
      let cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      // Etwas aus dem Raum heraus, damit die Nummer nicht auf der Wand klebt.
      const dx = cx - mx, dy = cy - my, l = Math.hypot(dx, dy) || 1;
      cx += dx / l * 0.28; cy += dy / l * 0.28;
      const [x, y] = this.nachSchirm(cx, cy);
      g.push(`<circle class="wandnr-kreis" cx="${x}" cy="${y}" r="10"/>`
        + `<text class="wandnr" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`);
    }
    return `<g class="wandnummern">${g.join("")}</g>`;
  }

  _messung() {
    if (!this.messpunkte.length) return "";
    const s = this.messpunkte.map(p => this.nachSchirm(p[0], p[1]));
    const linien = [];
    for (let i = 1; i < s.length; i++)
      linien.push(`<line class="mess-linie" x1="${s[i - 1][0]}" y1="${s[i - 1][1]}" x2="${s[i][0]}" y2="${s[i][1]}"/>`);
    const punkte = s.map(p => `<circle class="mess-punkt" cx="${p[0]}" cy="${p[1]}" r="4"/>`).join("");
    // Zwischenmaße an jeder Strecke.
    const masse = [];
    for (let i = 1; i < this.messpunkte.length; i++) {
      const a = this.messpunkte[i - 1], b = this.messpunkte[i];
      const d = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100;
      const [tx, ty] = this.nachSchirm((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      masse.push(`<text class="mess-text" x="${tx}" y="${ty - 6}" text-anchor="middle">${d.toFixed(2)} m</text>`);
    }
    return `<g class="messung">${linien.join("")}${punkte}${masse.join("")}</g>`;
  }

  // ------------------------------------------------ Zeiger

  _zeiger() {
    this.svg.addEventListener("pointerdown", ev => this._runter(ev));
    this.svg.addEventListener("pointermove", ev => this._bewegung(ev));
    window.addEventListener("pointerup", ev => this._hoch(ev));
    this.svg.addEventListener("wheel", ev => this._rad(ev), { passive: false });
    this.svg.addEventListener("dblclick", () => { if (this.modus.startsWith("messen")) this._messungAbschluss(); });
  }

  _runter(ev) {
    const welt = this._zeigerWelt(ev);
    if (this.modus === "platzieren") { this.cb.onPlace?.(welt[0], welt[1]); return; }
    if (this.modus.startsWith("messen")) {
      this.messpunkte.push(welt);
      if (this.modus === "messen-strecke" && this.messpunkte.length >= 2) this._messungAbschluss();
      else this.zeichne();
      return;
    }

    const ziel = ev.target.closest?.("[data-ph]");
    if (ziel) {
      const id = ziel.getAttribute("data-ph");
      const ph = this.modell.platzhalter.find(p => p.id === id);
      this.cb.onSelect?.(id);
      this.zieh = { typ: "klotz", ph, greif: [welt[0] - Number(ph.xM), welt[1] - Number(ph.yM)] };
      this.svg.setPointerCapture?.(ev.pointerId);
    } else {
      this.cb.onSelect?.(null);
      this.zieh = { typ: "schwenk", start: [ev.clientX, ev.clientY], ox: this.ox, oy: this.oy, bewegt: false };
    }
  }

  _bewegung(ev) {
    if (!this.zieh) return;
    if (this.zieh.typ === "schwenk") {
      this.ox = this.zieh.ox + (ev.clientX - this.zieh.start[0]);
      this.oy = this.zieh.oy + (ev.clientY - this.zieh.start[1]);
      this.zieh.bewegt = true;
      this.zeichne();
    } else if (this.zieh.typ === "klotz") {
      const welt = this._zeigerWelt(ev);
      const ziel = this._einrasten(this.zieh.ph, welt[0] - this.zieh.greif[0], welt[1] - this.zieh.greif[1]);
      this.cb.onPlatzhalterMove?.(this.zieh.ph.id, ziel);
    }
  }

  _hoch() { this.zieh = null; }

  _rad(ev) {
    ev.preventDefault();
    const r = this.svg.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const welt = this.nachWelt(px, py);
    const faktor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.scale = Math.max(20, Math.min(500, this.scale * faktor));
    // Zoom um den Zeiger: der Weltpunkt unter dem Zeiger bleibt stehen.
    this.ox = px - welt[0] * this.scale;
    this.oy = py - welt[1] * this.scale;
    this.zeichne();
  }

  /** Öffentlicher Einrast-Vorschlag – die App nutzt ihn beim Platzieren. */
  einrastVorschlag(ph, mx, my) { return this._einrasten(ph, mx, my); }

  /** Nahe einer Wand mit dem Rücken einrasten, sonst frei aufs Raster. */
  _einrasten(ph, mx, my) {
    const raum = this.modell.raum;
    const komp = finde(ph.komponente);
    const ht = komp ? Number(komp.tiefeM) / 2 : 0;
    const w = G.naechsteWand(raum, mx, my);
    // An die Wand einrasten, wenn nahe genug – oder wenn außerhalb des Raums
    // abgelegt: ein Wandgerät gehört an eine Wand, nicht ins Freie daneben.
    if (komp && (w.entfernung < 0.6 || !G.imRaum(raum, mx, my))) {
      const e = G.ecken(raum);
      const a = e[w.index], b = e[(w.index + 1) % e.length];
      const phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const laenge = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.max(ht, Math.min(laenge - ht, w.abstand));
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

  _messungAbschluss() {
    if (this.messpunkte.length < 2) { this.messpunkte = []; return; }
    let ergebnis;
    if (this.modus === "messen-flaeche" || this.messpunkte.length > 2) {
      const flaeche = Math.floor(G.flaechePunkte(this.messpunkte) * 100) / 100;
      let umfang = 0;
      for (let i = 0; i < this.messpunkte.length; i++) {
        const a = this.messpunkte[i], b = this.messpunkte[(i + 1) % this.messpunkte.length];
        umfang += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      ergebnis = { art: "flaeche", flaecheM2: flaeche, umfangM: Math.floor(umfang * 100) / 100, punkte: this.messpunkte.length };
    } else {
      const a = this.messpunkte[0], b = this.messpunkte[1];
      ergebnis = { art: "strecke", laengeM: Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100 };
    }
    this.cb.onMessung?.(ergebnis);
    this.messpunkte = [];
    this.zeichne();
  }
}

// -------------------------------------------------- kleine Helfer

function pktAufWand(raum, i, abstand) {
  const e = G.ecken(raum);
  const a = e[i], b = e[(i + 1) % e.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = Math.max(0, Math.min(len, abstand)) / len;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function wandWinkel(raum, i) {
  const e = G.ecken(raum);
  const a = e[i], b = e[(i + 1) % e.length];
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}

const r2 = v => Math.round(v * 100) / 100;
const kurz = name => name.length > 14 ? name.slice(0, 13) + "…" : name;
