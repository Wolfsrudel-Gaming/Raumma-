/*
 * Genauigkeit des würfelfreien Zielens – Monte-Carlo-Simulation.
 *
 * Erzeugt für zufällige Standpunkte und Haltungen (Handy 20–45 cm vor der
 * Körperachse, Linse 8 cm über dem Drehpunkt, Neigungsfehler ~0,5°, Zittern
 * 0,2°, Gier-Drift ~2°/min) die Lage-Messungen, die ein Handy beim Anzielen
 * der Ecken liefern würde, und rechnet sie mit web/raumaufnahme.js zurück.
 * Ausgabe je Fall: RMS / 95-%-Wert des Wandfehlers, wie oft die angezeigte
 * 2σ-Unsicherheit den wahren Fehler deckt, und die vergebenen Klassen.
 * Die Tabelle in docs/AUFMASS.md stammt von hier.
 *
 * Aufruf: node tools/genauigkeit.mjs
 */
import * as Z from "../web/zielen.js";
import * as A from "../web/raumaufnahme.js";
let seed = 777;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const RAEUME = {
  "Rechteck 4,80×3,60": [[0, 3.6], [4.8, 3.6], [4.8, 0], [0, 0]],
  "L 5×4": [[0, 4], [5, 4], [5, 0], [2, 0], [2, 1.5], [0, 1.5]],
};
function innen(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; }
function lauf(R, szen, N = 300) {
  const n = R.length;
  const wahr = R.map((a, i) => Math.hypot(R[(i + 1) % n][0] - a[0], R[(i + 1) % n][1] - a[1]));
  const fehler = [], deck = [], klassen = {};
  for (let k = 0; k < N; k++) {
    let S; do { S = [0.8 + rnd() * (Math.max(...R.map(p => p[0])) - 1.6), 0.8 + rnd() * (Math.max(...R.map(p => p[1])) - 1.6)]; } while (!innen(R, S[0], S[1]));
    const g = { hw: 1.20 + rnd() * 0.2, r: 0.2 + rnd() * 0.25, L: 0.08, bias: 0.5 * gauss() * Z.GRAD, sig: 0.2 * Z.GRAD, drift: 2 * gauss() * Z.GRAD / 60000 };
    let t = 0;
    const schuss = (T) => { t += 5000; const dx = T[0] - S[0], dy = T[1] - S[1], D = Math.hypot(dx, dy); let th = .3;
      for (let i = 0; i < 60; i++) th = Math.atan2(g.hw + g.L * Math.cos(th) - (T[2] || 0), D - (g.r + g.L * Math.sin(th)));
      const thm = th + g.bias + g.sig * gauss(), psm = Math.atan2(dx, dy) + g.drift * t + g.sig * gauss();
      return { v: [Math.sin(psm) * Math.cos(thm), Math.cos(psm) * Math.cos(thm), -Math.sin(thm)], t }; };
    const a = A.neueAufnahme(1.40, "fertig");
    a.ecken = R.map(p => ({ ...schuss(p), ebene: "boden" }));
    // Die App lehnt zu flache/steile Schüsse ab – dann stellt man sich anders hin.
    if (a.ecken.some(e => Z.zielBereich(e.v) !== "ok")) { k--; continue; }
    if (szen.schluss) a.schluss = schuss(R[0]);
    if (szen.tuer) { const u = schuss([...R[0].map((v, i) => (v + R[1][i]) / 2), 0]), o = schuss([...R[0].map((v, i) => (v + R[1][i]) / 2), 1.97]);
      a.senkrechte = [{ vUnten: u.v, tUnten: u.t, vOben: o.v, tOben: o.t, hoeheM: 1.97 + 0.01 * gauss() }]; }
    const raum0 = Z.raumAusEcken(R);
    const idx = i => raum0.umgekehrt ? (n - 1 - i + n) % n : i;  // Tipp-Wand → Raum-Wand
    const lang = wahr.indexOf(Math.max(...wahr));
    if (szen.band >= 1) a.bandmasse[idx(lang)] = wahr[lang] + 0.003 * gauss();
    if (szen.band >= 2) { const q = (lang + 1) % n; a.bandmasse[idx(q)] = wahr[q] + 0.003 * gauss(); }
    const r = A.rekonstruiere(a);
    klassen[r.klasse] = (klassen[r.klasse] || 0) + 1;
    r.waende.forEach((w, i) => { const tw = wahr[raum0.umgekehrt ? (n - 1 - i + n) % n : i]; const e = Math.abs(w.laenge - tw); fehler.push(e); deck.push(e <= 2 * w.sigmaM + 0.005); });
  }
  fehler.sort((x, y) => x - y);
  const rms = Math.sqrt(fehler.reduce((s, x) => s + x * x, 0) / fehler.length);
  return `RMS ${(rms * 100).toFixed(1)} cm · p95 ${(fehler[Math.floor(fehler.length * .95)] * 100).toFixed(1)} cm · 2σ deckt ${(100 * deck.filter(Boolean).length / deck.length).toFixed(0)} % · Klassen ${JSON.stringify(klassen)}`;
}
for (const [name, R] of Object.entries(RAEUME)) {
  console.log(name);
  for (const [sn, sz] of [["ohne Maßstab", { band: 0 }], ["Türzarge 1,97", { band: 0, tuer: true }], ["1 Bandmaß", { band: 1 }], ["1 Bandmaß + Schluss", { band: 1, schluss: true }], ["2 Bandmaße + Schluss", { band: 2, schluss: true }]])
    console.log("  " + sn.padEnd(22) + lauf(R, sz));
}
