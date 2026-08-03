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
    this.modell = { raeume: [], geschoss: 0, aktivId: null };
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
      const pts = this.ecken(r).map(p => this.nachSchirm(p[0], p[1]));
      const poly = pts.map(p => p.join(",")).join(" ");
      const mitte = this.nachSchirm(Number(r.xM) + G.breite(r) / 2, Number(r.yM) + G.tiefe(r) / 2);
      const flaeche = G.flaeche(r).toFixed(1);
      teile.push(`<g class="graum ${aktiv ? "aktiv" : ""}" data-raum="${r.id}">
        <polygon points="${poly}" fill="${r.farbe || "#cfe8e9"}"/>
        <text class="graum-name" x="${mitte[0]}" y="${mitte[1] - 4}" text-anchor="middle">${esc(r.name)}${r.nummer ? ` · ${esc(r.nummer)}` : ""}</text>
        <text class="graum-mass" x="${mitte[0]}" y="${mitte[1] + 12}" text-anchor="middle">${flaeche} m²</text>
      </g>`);
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

const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
