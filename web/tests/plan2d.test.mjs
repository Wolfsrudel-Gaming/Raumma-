/*
 * Prüft die Grundriss-Ansicht ohne Browser: ein nachgebautes SVG-Element
 * nimmt das erzeugte Markup auf, Zeigerereignisse werden direkt an die
 * Handler gegeben. Abgedeckt sind die Fehler aus dem Audit – Absturz bei
 * ungültiger Wand, ungeschützte Werte im Markup, Zonen, die Klicks schlucken,
 * Flächenmessung ohne Abschluss, fehlender Zwei-Finger-Zoom, fehlende Maße.
 *
 * Aufruf: node web/tests/plan2d.test.mjs   (Exitcode != 0 bei Fehler)
 */
import { Plan } from "../raumwerk/plan2d.js";
import { grundriss } from "../pruefung.js";
import { finde } from "../komponenten.js";

let ok = 0, fail = 0;
const pruefe = (name, bedingung, info = "") => {
  if (bedingung) ok++; else { console.error(`FAIL ${name}${info ? ": " + info : ""}`); fail++; }
};

function attrappe(breite = 800, hoehe = 600) {
  return {
    innerHTML: "", style: {},
    addEventListener() {}, setPointerCapture() {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: breite, height: hoehe })
  };
}
const raum = (extra = {}) => ({ id: "r1", name: "T", breiteM: 4, tiefeM: 3, hoeheM: 2.5, umriss: "", farbe: "#cfe8e9", ...extra });
const ziel = () => ({ closest: () => null });
const runter = (plan, id, x, y, extra = {}) => plan._runter({ pointerId: id, isPrimary: id === 1, pointerType: "touch", button: 0, clientX: x, clientY: y, target: ziel(), ...extra });
const bewegen = (plan, id, x, y) => plan._bewegung({ pointerId: id, clientX: x, clientY: y, pointerType: "touch" });
const hoch = (plan, id) => plan._hoch({ pointerId: id });

// 1. Ungültige Wandnummern: nichts wirft, nichts davon wird gezeichnet.
{
  const svg = attrappe();
  const plan = new Plan(svg, {});
  plan.setModell({
    raum: raum(),
    oeffnungen: [
      { id: "o1", art: "TUER", wandIndex: 99, abstandM: 1, breiteM: 0.9, hoeheM: 2 },
      { id: "o2", art: "TUER", wandIndex: -1, abstandM: 1, breiteM: 0.9, hoeheM: 2 },
      { id: "o3", art: "FENSTER", wandIndex: "abc", abstandM: 1, breiteM: 0.9, hoeheM: 1 },
      { id: "o4", art: "TUER", wandIndex: 1.5, abstandM: 1, breiteM: 0.9, hoeheM: 2 }
    ],
    einbauten: [
      { id: "e1", art: "STECKDOSE", befestigung: "WAND", wandIndex: 7, abstandM: 1 },
      { id: "e2", art: "LAMPE", befestigung: "DECKE", relX: "x", relY: 0.5 }
    ],
    platzhalter: [{ id: "p1", komponente: "GIBTESNICHT", xM: 1, yM: 1 }, { id: "p2", komponente: "ZAEHLERSCHRANK", xM: NaN, yM: 1 }],
    fotos: [{ id: "f1", relX: null, relY: "?" }]
  });
  let fehler = null;
  try { plan.einpassen(); plan.zeichne(); } catch (e) { fehler = e; }
  pruefe("ungültige Wand wirft nicht", !fehler, fehler && fehler.message);
  pruefe("kein NaN im Markup", !svg.innerHTML.includes("NaN"));
  pruefe("ungültige Öffnungen nicht gezeichnet", !/class="oeffnung"><g/.test(svg.innerHTML));
  pruefe("Einbau an fehlender Wand nicht gezeichnet", !svg.innerHTML.includes('data-ein="e1"'));
  pruefe("unbrauchbare Klötzchen/Fotos nicht gezeichnet",
    !svg.innerHTML.includes("data-ph=") && !svg.innerHTML.includes("data-foto="));
  pruefe("Wände trotzdem gezeichnet", /class="wand"[^>]*><line/.test(svg.innerHTML));
  // Kaputte Geometrie: Hinweis statt Absturz.
  plan.setModell({ raum: raum({ id: "r2", breiteVorneM: "kaputt" }) });
  try { plan.zeichne(); fehler = null; } catch (e) { fehler = e; }
  pruefe("kaputte Geometrie wirft nicht", !fehler);
}

// 2. Werte aus dem Projekt landen maskiert im Markup.
{
  const svg = attrappe();
  const plan = new Plan(svg, {});
  const boese = `x"><img src=x onerror="alert(1)">`;
  plan.setModell({
    raum: raum({ farbe: boese }),
    einbauten: [{ id: boese, art: "LAMPE", befestigung: "DECKE", relX: 0.5, relY: 0.5 }],
    platzhalter: [{ id: boese, komponente: "ZAEHLERSCHRANK", xM: 2, yM: 2.9, drehungGrad: 180 }],
    fotos: [{ id: boese, relX: 0.3, relY: 0.3 }]
  });
  plan.einpassen();
  pruefe("kein eingeschleustes Element", !svg.innerHTML.includes("<img"));
  pruefe("Farbe ersetzt", svg.innerHTML.includes('fill="#cfe8e9"'));
  pruefe("Kennungen maskiert", (svg.innerHTML.match(/x&quot;&gt;&lt;img/g) || []).length === 3);
  plan.setModell({ raum: raum({ id: "r3", farbe: "#abc" }) }).zeichne();
  pruefe("gültige Farbe bleibt", svg.innerHTML.includes('fill="#abc"'));
}

// 3. Zonen ohne Zeigerereignisse; Einbauten und Fotos über den Klötzchen; Trefferkreise.
{
  const svg = attrappe();
  const plan = new Plan(svg, {});
  plan.setModell({
    raum: raum(),
    einbauten: [{ id: "e1", art: "SCHALTER", befestigung: "WAND", wandIndex: 2, abstandM: 2 }],
    platzhalter: [{ id: "p1", komponente: "ZAEHLERSCHRANK", xM: 2, yM: 2.9, drehungGrad: 180 }],
    fotos: [{ id: "f1", relX: 0.5, relY: 0.5 }]
  });
  plan.einpassen();
  const h = svg.innerHTML;
  pruefe("Zone vorhanden", h.includes('class="zone zone-ok"'));
  pruefe("Zone ohne Zeigerereignisse", /<polygon class="zone[^>]*pointer-events="none"/.test(h));
  pruefe("Zone nicht im Klötzchen", !/data-ph="p1">[^]*?class="zone/.test(h.slice(h.indexOf('data-ph="p1"'), h.indexOf('data-ph="p1"') + 400)));
  pruefe("Einbau über Klötzchen", h.indexOf('data-ein="e1"') > h.indexOf('data-ph="p1"'));
  pruefe("Foto über Klötzchen", h.indexOf('data-foto="f1"') > h.indexOf('data-ph="p1"'));
  pruefe("Trefferkreise", (h.match(/class="treffer"[^>]*r="20"/g) || []).length === 2);
  // Überlappende Trefferkreise: der nähere Einbau gewinnt, nicht der oberste.
  const gewaehlt = [];
  plan.cb.onEinbauSelect = id => gewaehlt.push(id);
  plan.setModell({ einbauten: [
    { id: "nah", art: "LAMPE", befestigung: "DECKE", relX: 0.5, relY: 0.5 },
    { id: "oben", art: "LAMPE", befestigung: "DECKE", relX: 0.5 + 0.1 / 4, relY: 0.5 }
  ] }).zeichne();
  const [nx, ny] = plan.nachSchirm(2, 1.5);
  const trefferOben = { getAttribute: a => a === "class" ? "treffer" : null,
    closest: sel => sel === "[data-ein]" ? { getAttribute: () => "oben" } : null };
  plan._runter({ pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, clientX: nx + 2, clientY: ny, target: trefferOben });
  plan._hoch({ pointerId: 1 });
  pruefe("näherer Einbau gewinnt", gewaehlt[0] === "nah", JSON.stringify(gewaehlt));
}

// 4. Maßketten: Lichtmaße mit Komma, abschaltbar; Öffnungskette.
{
  const svg = attrappe();
  const plan = new Plan(svg, {});
  plan.setModell({ raum: raum() });
  plan.einpassen();
  const texte = [...svg.innerHTML.matchAll(/class="mass-text"[^>]*>([^<]*)</g)].map(m => m[1]);
  pruefe("vier Wandmaße", texte.length === 4, texte.join(" "));
  pruefe("4,00 zweimal", texte.filter(t => t === "4,00").length === 2, texte.join(" "));
  pruefe("3,00 zweimal", texte.filter(t => t === "3,00").length === 2, texte.join(" "));
  pruefe("Maßlinien mit eigenem Strich", /class="mass-linie"[^>]*stroke="currentColor"/.test(svg.innerHTML));
  // Nie kopfüber: Drehwinkel der Schrift in [-90, 90).
  const winkel = [...svg.innerHTML.matchAll(/class="mass-text" transform="[^"]*rotate\(([-\d.]+)\)/g)].map(m => Number(m[1]));
  pruefe("Schrift lesbar", winkel.every(w => w >= -90 && w < 90), winkel.join(","));
  plan.setModell({ masse: false }).zeichne();
  pruefe("Maße abschaltbar", !svg.innerHTML.includes("mass-text"));
  plan.setModell({ masse: true, oeffnungen: [{ id: "o1", art: "TUER", wandIndex: 0, abstandM: 1, breiteM: 0.9, hoeheM: 2 }] }).zeichne();
  const mit = [...svg.innerHTML.matchAll(/class="mass-text"[^>]*>([^<]*)</g)].map(m => m[1]);
  pruefe("Öffnungskette", mit.includes("0,90") && mit.includes("1,00") && mit.includes("2,10"), mit.join(" "));
  // Gezielte Wand: „≈".
  plan.setModell({ oeffnungen: [], raum: { ...raum(), aufmass: { methode: "zielen", waende: [{ quelle: "gezielt", sigmaM: 0.03 }, { quelle: "band" }, { quelle: "band" }, { quelle: "band" }] } } }).zeichne();
  pruefe("gezielte Wand mit ≈", svg.innerHTML.includes(">≈4,00<"));
}

// 5. Flächenmessung: Tipp auf den ersten Punkt schließt; Knopf; Doppeltipp.
{
  const svg = attrappe();
  const ergebnisse = [];
  const plan = new Plan(svg, { onMessung: e => ergebnisse.push(e) });
  plan.setModell({ raum: raum() }).zeichne();     // passt ein – danach feste Ansicht
  plan.scale = 100; plan.ox = 0; plan.oy = 0;
  plan.setModus("messen-flaeche");
  const tipp = (x, y) => { runter(plan, 1, x, y); hoch(plan, 1); };
  tipp(50, 50); tipp(350, 50); tipp(350, 250); tipp(50, 250);
  pruefe("vier Messpunkte", plan.messpunkte.length === 4);
  tipp(55, 48);                                    // nahe dem ersten Punkt
  pruefe("Fläche geschlossen", ergebnisse.length === 1 && ergebnisse[0].art === "flaeche", JSON.stringify(ergebnisse));
  pruefe("Fläche 6 m²", ergebnisse[0]?.flaecheM2 === 6, JSON.stringify(ergebnisse[0]));
  pruefe("Punkte zurückgesetzt", plan.messpunkte.length === 0);
  // Knopf
  tipp(50, 50); tipp(350, 50); tipp(350, 250);
  pruefe("Knopf schließt", plan.messungAbschliessen() === true && ergebnisse.length === 2 && ergebnisse[1].flaecheM2 === 3);
  pruefe("Knopf ohne Punkte", plan.messungAbschliessen() === false);
  // Doppeltipp auf den letzten Punkt
  tipp(50, 50); tipp(350, 50); tipp(350, 250); tipp(352, 251);
  pruefe("Doppeltipp schließt", ergebnisse.length === 3 && ergebnisse[2].punkte === 3, JSON.stringify(ergebnisse[2]));
  // Ziehen im Messwerkzeug verschiebt nur die Ansicht.
  runter(plan, 1, 100, 100); bewegen(plan, 1, 160, 100); hoch(plan, 1);
  pruefe("Ziehen setzt keinen Punkt", plan.messpunkte.length === 0 && plan.ox === 60);
  // Strecke
  plan.setModus("messen-strecke"); plan.ox = 0;
  tipp(0, 0); tipp(300, 0);
  pruefe("Strecke", ergebnisse[3]?.art === "strecke" && ergebnisse[3].laengeM === 3, JSON.stringify(ergebnisse[3]));
}

// 6. Zwei Finger zoomen um ihre Mitte und unterdrücken Auswahl/Platzieren.
{
  const svg = attrappe();
  const auswahl = [], platziert = [];
  const plan = new Plan(svg, { onSelect: id => auswahl.push(id), onPlace: (x, y) => platziert.push([x, y]) });
  plan.setModell({ raum: raum() }).zeichne();
  plan.scale = 100; plan.ox = 0; plan.oy = 0;
  const vorher = plan.nachWelt(400, 300);
  runter(plan, 1, 350, 300); runter(plan, 2, 450, 300);
  bewegen(plan, 1, 300, 300); bewegen(plan, 2, 500, 300);
  pruefe("Zoom verdoppelt", Math.abs(plan.scale - 200) < 1e-9, plan.scale);
  const nachher = plan.nachWelt(400, 300);
  pruefe("Mitte bleibt stehen", Math.abs(vorher[0] - nachher[0]) < 1e-9 && Math.abs(vorher[1] - nachher[1]) < 1e-9);
  hoch(plan, 2); bewegen(plan, 1, 320, 300); hoch(plan, 1);
  pruefe("Geste wählt nichts ab", auswahl.length === 0, JSON.stringify(auswahl));
  // Platzieren: erst der Tipp platziert, eine Geste nicht.
  plan.setModus("platzieren");
  runter(plan, 1, 100, 100); runter(plan, 2, 200, 100); hoch(plan, 1); hoch(plan, 2);
  pruefe("Geste platziert nicht", platziert.length === 0);
  runter(plan, 1, 100, 100); hoch(plan, 1);
  pruefe("Tipp platziert", platziert.length === 1);
  // Ein mit dem ersten Finger begonnenes Ziehen wird zurückgenommen.
  plan.setModus("auswahl");
  const ph = { id: "p1", komponente: "ZAEHLERSCHRANK", xM: 2, yM: 1.5, drehungGrad: 0 };
  const zuege = [];
  plan.cb.onPlatzhalterMove = (id, patch) => { zuege.push(patch); Object.assign(ph, patch); };
  plan.setModell({ platzhalter: [ph] });
  const zielPh = { closest: sel => sel === "[data-ph]" ? { getAttribute: () => "p1" } : null };
  const [sx, sy] = plan.nachSchirm(2, 1.5);
  runter(plan, 1, sx, sy, { target: zielPh });
  bewegen(plan, 1, sx + 40, sy);
  runter(plan, 2, sx + 200, sy);
  pruefe("Ziehen zurückgenommen", ph.xM === 2 && ph.yM === 1.5 && zuege.length >= 2, JSON.stringify(ph));
  hoch(plan, 1); hoch(plan, 2);
}

// 7. Einrasten an die Wand: Die Breite liegt entlang der Wand – das Gerät
//    bleibt um die halbe Breite (nicht die halbe Tiefe) von der Ecke weg und
//    ragt nicht durch die Nachbarwand.
{
  const plan = new Plan(attrappe(), {});
  plan.setModell({ raum: raum() });                // 4 × 3 m
  const aussen = (z, k) => {
    const g = grundriss(z, finde(k));
    const xs = g.map(q => q[0]), ys = g.map(q => q[1]);
    return Math.max(-Math.min(...xs), -Math.min(...ys), Math.max(...xs) - 4, Math.max(...ys) - 3);
  };
  for (const k of ["ZAEHLERSCHRANK", "VERTEILERSCHRANK", "SERVERSCHRANK"]) {
    for (const [mx, my] of [[0.05, 0.05], [0.1, 0.3], [3.95, 2.95], [0.3, 0.05], [3.9, 0.1], [0.1, 2.9]]) {
      const z = plan.einrastVorschlag({ komponente: k }, mx, my);
      pruefe(`${k} bei (${mx}|${my}) bleibt im Raum`, aussen(z, k) < 0.005, JSON.stringify(z));
    }
  }
  // Zählerschrank (B 0,60 × T 0,20) in der Ecke oben links: Mitte 0,30 entlang
  // der Wand, 0,10 von ihr weg – früher 0,10/0,10 und 20 cm durch die Wand.
  const z = plan.einrastVorschlag({ komponente: "ZAEHLERSCHRANK" }, 0.05, 0.05);
  const gedreht = z.drehungGrad === 90 || z.drehungGrad === 270;
  pruefe("Ecke: halbe Breite entlang der Wand",
    gedreht ? z.yM === 0.3 && z.xM === 0.1 : z.xM === 0.3 && z.yM === 0.1, JSON.stringify(z));
  // Wand kürzer als das Gerät: mittig auf der Wand.
  plan.setModell({ raum: raum({ umriss: JSON.stringify([[0, 0], [4, 0], [4, 2.5], [3.5, 2.5], [3.5, 3], [0, 3]]) }) });
  const kurz = plan.einrastVorschlag({ komponente: "VERTEILERSCHRANK" }, 3.6, 2.45);
  pruefe("kurze Wand: mittig", kurz.xM === 3.75, JSON.stringify(kurz));
}

console.log(`plan2d: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
