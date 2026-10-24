/*
 * Gebäude-Übersicht – die Räume eines Geschosses zueinander angeordnet.
 *
 * Hier wird nicht der Rauminhalt geplant, sondern die Lage der Räume im
 * Gebäude: ziehen zum Verschieben (Kanten rasten an Nachbarräume ein),
 * anklicken macht einen Raum zum aktiven, den die Detailansicht bearbeitet.
 *
 * Reine Darstellung und Zeigergeometrie; Zustandsänderungen meldet die Ansicht
 * über Rückrufe an die App.
 */

import * as G from "../geometrie.js";
import { einrasten } from "../platzierung.js";

export class Gebaeude {
  constructor(svg, rueckrufe = {}) {
    this.svg = svg;
    this.cb = rueckrufe;
    this.modell = { raeume: [], geschoss: 0, aktivId: null, tueren: [] };
    this.scale = 40; this.ox = 40; this.oy = 40;
    this.zieh = null;
    this._zeiger();
  }

  setModell(m) { Object.assign(this.modell, m); return this; }

  nachSchirm(mx, my) { return [this.ox + mx * this.scale, this.oy + my * this.scale]; }
  nachWelt(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }
  _zeigerWelt(ev) {
    const r = this.svg.getBoundingClientRect();
    return this.nachWelt(ev.clientX - r.left, ev.clientY - r.top);
  }

  /** Eckpunkte eines Raums im Gebäudekoordinatensystem (mit Drehung um die Mitte). */
  ecken(r) {
    const b = G.breite(r), t = G.tiefe(r);
    const cx = b / 2, cy = t / 2;
    const th = (Number(r.drehungGrad) || 0) * Math.PI / 180;
    const co = Math.cos(th), si = Math.sin(th);
    return G.ecken(r).map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      return [Number(r.xM) + dx * co - dy * si + cx, Number(r.yM) + dx * si + dy * co + cy];
    });
  }

  _dieserEbene() { return this.modell.raeume.filter(r => r.geschoss === this.modell.geschoss); }

  einpassen() {
    const rr = this._dieserEbene();
    if (!rr.length) return;
    const pts = rr.flatMap(r => this.ecken(r));
    const minX = Math.min(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1]));
    const maxX = Math.max(...pts.map(p => p[0])), maxY = Math.max(...pts.map(p => p[1]));
    const rect = this.svg.getBoundingClientRect();
    const rand = 60;
    this.scale = Math.min((rect.width - 2 * rand) / ((maxX - minX) || 1), (rect.height - 2 * rand) / ((maxY - minY) || 1));
    this.scale = Math.max(15, Math.min(200, this.scale));
    this.ox = (rect.width - (maxX + minX) * this.scale) / 2;
    this.oy = (rect.height - (maxY + minY) * this.scale) / 2;
    this.zeichne();
  }

  zeichne() {
    const rr = this._dieserEbene();
    const teile = [this._raster()];
    for (const r of rr) {
      const aktiv = r.id === this.modell.aktivId;
      const welt = this.ecken(r);
      const pts = welt.map(p => this.nachSchirm(p[0], p[1]));
      const poly = pts.map(p => p.join(",")).join(" ");
      const m = beschriftungsPunkt(welt);
      const mitte = m ? this.nachSchirm(m[0], m[1]) : this.nachSchirm(Number(r.xM) + G.breite(r) / 2, Number(r.yM) + G.tiefe(r) / 2);
      const flaeche = G.flaeche(r).toFixed(1);
      teile.push(`<g class="graum ${aktiv ? "aktiv" : ""}" data-raum="${esc(r.id)}">
        <polygon points="${poly}" fill="${farbe(r.farbe)}"/>
        <text class="graum-name" x="${mitte[0]}" y="${mitte[1] - 4}" text-anchor="middle">${esc(r.name)}${r.nummer ? ` · ${esc(r.nummer)}` : ""}</text>
        <text class="graum-mass" x="${mitte[0]}" y="${mitte[1] + 12}" text-anchor="middle">${flaeche} m²</text>
      </g>`);
    }
    for (const t of this.modell.tueren) {
      const a = this.nachSchirm(t.cx, t.cy);
      const halb = (Number(t.breiteM) / 2) * this.scale;
      if (!isFinite(a[0]) || !isFinite(a[1]) || !isFinite(halb)) continue;
      // Ein helles Stück entlang der gemeinsamen Wand = die Öffnung (auch an
      // schrägen Wänden: Richtung kommt aus der Verbindung).
      const [ux, uy] = Array.isArray(t.richtung) ? t.richtung : (t.senkrecht ? [0, 1] : [1, 0]);
      const [x1, y1, x2, y2] = [a[0] - ux * halb, a[1] - uy * halb, a[0] + ux * halb, a[1] + uy * halb];
      teile.push(`<g class="gtuer">`
        + `<line class="gtuer-lueck" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
        + `<circle class="gtuer-punkt" cx="${a[0]}" cy="${a[1]}" r="3.5"/></g>`);
    }
    this.svg.innerHTML = teile.join("");
  }

  _raster() {
    const rect = this.svg.getBoundingClientRect();
    const schritt = this.scale;               // 1-m-Raster
    if (schritt < 10) return "";
    const l = [];
    for (let x = this.ox % schritt; x < rect.width; x += schritt) l.push(`<line x1="${x}" y1="0" x2="${x}" y2="${rect.height}"/>`);
    for (let y = this.oy % schritt; y < rect.height; y += schritt) l.push(`<line x1="0" y1="${y}" x2="${rect.width}" y2="${y}"/>`);
    return `<g class="raster">${l.join("")}</g>`;
  }

  _zeiger() {
    this.svg.addEventListener("pointerdown", ev => this._runter(ev));
    this.svg.addEventListener("pointermove", ev => this._bewegung(ev));
    window.addEventListener("pointerup", () => { this.zieh = null; });
    this.svg.addEventListener("wheel", ev => this._rad(ev), { passive: false });
  }

  _runter(ev) {
    const ziel = ev.target.closest?.("[data-raum]");
    if (ziel) {
      const id = ziel.getAttribute("data-raum");
      const r = this.modell.raeume.find(x => x.id === id);
      this.cb.onSelect?.(id);
      const welt = this._zeigerWelt(ev);
      this.zieh = { typ: "raum", r, greif: [welt[0] - Number(r.xM), welt[1] - Number(r.yM)] };
      this.svg.setPointerCapture?.(ev.pointerId);
    } else {
      this.zieh = { typ: "schwenk", start: [ev.clientX, ev.clientY], ox: this.ox, oy: this.oy };
    }
  }

  _bewegung(ev) {
    if (!this.zieh) return;
    if (this.zieh.typ === "schwenk") {
      this.ox = this.zieh.ox + (ev.clientX - this.zieh.start[0]);
      this.oy = this.zieh.oy + (ev.clientY - this.zieh.start[1]);
      this.zeichne();
    } else if (this.zieh.typ === "raum") {
      const welt = this._zeigerWelt(ev);
      const [x, y] = einrasten(this.zieh.r, welt[0] - this.zieh.greif[0], welt[1] - this.zieh.greif[1], this.modell.raeume);
      this.cb.onMove?.(this.zieh.r.id, { xM: x, yM: y });
    }
  }

  _rad(ev) {
    ev.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const welt = this.nachWelt(px, py);
    this.scale = Math.max(10, Math.min(300, this.scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
    this.ox = px - welt[0] * this.scale;
    this.oy = py - welt[1] * this.scale;
    this.zeichne();
  }
}

const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Wohin der Raumname gehört: Flächenschwerpunkt des Umrisses – bei L-Räumen
 * liegt die Mitte des Kastens sonst auf der Wand. Liegt der Schwerpunkt
 * außerhalb (stark verwinkelte Räume), null → Kastenmitte.
 */
function beschriftungsPunkt(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (!isFinite(a) || Math.abs(a) < 1e-9) return null;
  const s = [cx / (3 * a), cy / (3 * a)];
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > s[1]) !== (p[j][1] > s[1]) &&
      s[0] < (p[j][0] - p[i][0]) * (s[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) drin = !drin;
  }
  return drin ? s : null;
}

/** Nur echte Farbwerte ins SVG – alles andere (z. B. aus einem Import) wird Standard. */
const farbe = f => (typeof f === "string" && /^#[0-9a-fA-F]{3,8}$/.test(f) ? f : "#cfe8e9");
