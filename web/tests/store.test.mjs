/*
 * Prüft den Projektspeicher (store.js) ohne Browser: Ein importiertes oder
 * manipuliertes Projekt wird bereinigt (keine Markup-Bruchstücke in IDs,
 * Farben, Kürzeln, Zahlen oder Bild-URLs), ein ungültiger Import wirft einen
 * Fehler statt das Projekt still durch das Beispiel zu ersetzen, IDs werden
 * samt aller Verweise konsistent neu vergeben, alte Stände laden weiter.
 * Bei vollem Speicher wird nie still ersetzt (Sicherung oder Rückfrage), ein
 * Foto, das nicht mehr passt, bleibt draußen, und von Hand geänderte gezielte
 * Objekte werden zu Handeinträgen.
 *
 * Aufruf: node web/tests/store.test.mjs   (Exitcode != 0 bei Fehler)
 */

// ---- Kleiner localStorage-Ersatz (mit einstellbarer Kapazität) -------------
const speicher = new Map();
let kapazitaet = Infinity;   // Zeichen insgesamt (Schlüssel + Werte)
const belegt = () => [...speicher].reduce((s, [k, v]) => s + k.length + v.length, 0);
const ls = {
  getItem: k => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => {
    v = String(v);
    const alt = speicher.has(k) ? k.length + speicher.get(k).length : 0;
    if (belegt() - alt + k.length + v.length > kapazitaet) {
      const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e;
    }
    speicher.set(k, v);
  },
  removeItem: k => { speicher.delete(k); },
  clear: () => speicher.clear()
};
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });

const Store = await import("../raumwerk/store.js");
const { bereinigen, ausObjektStreng, ausObjekt, beispielProjekt, leeresProjekt, laden, speichern,
  vorherSichern, vorherLaden, speicherBelegung, SPEICHER_WARNGRENZE } = Store;

let ok = 0, fail = 0;
const pruef = (name, bed, info = "") => {
  if (!bed) { console.error(`FAIL ${name}${info ? ": " + info : ""}`); fail++; } else ok++;
};
const json = o => JSON.parse(JSON.stringify(o));
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wirft = fn => { try { fn(); return null; } catch (e) { return e; } };

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KUERZEL = /^[A-Z0-9_]{1,40}$/;
const FARBE = /^#[0-9a-fA-F]{3,8}$/;
const BILD = /^data:image\/(png|jpeg|jpg|webp|gif)[;,]/;

/** Alle Felder, die Plan/Listen/Bericht ungeschützt in Attribute schreiben. */
function attributSicher(name, p) {
  const ids = [
    ...p.raeume.map(r => r.id), p.aktiverRaum,
    ...p.oeffnungen.flatMap(o => [o.id, o.raumId]),
    ...p.einbauten.flatMap(e => [e.id, e.raumId]),
    ...p.fotos.flatMap(f => [f.id, f.raumId]),
    ...p.verbindungen.flatMap(v => [v.id, v.raumA, v.raumB]),
    ...p.varianten.flatMap(v => [v.id, ...v.platzhalter.flatMap(ph => [ph.id, ph.raumId])])
  ];
  pruef(`${name}: alle IDs gültig`, ids.every(i => typeof i === "string" && ID.test(i)), ids.filter(i => !ID.test(i)).join(" | "));
  pruef(`${name}: Farben gültig`, p.raeume.every(r => FARBE.test(r.farbe)));
  pruef(`${name}: Geschoss ist Zahl`, p.raeume.every(r => Number.isInteger(r.geschoss)));
  pruef(`${name}: Zahlen endlich`, p.raeume.every(r => ["breiteM", "tiefeM", "hoeheM", "aufbauM", "xM", "yM", "drehungGrad"]
    .every(k => Number.isFinite(r[k]))));
  pruef(`${name}: Kürzel gültig`,
    p.oeffnungen.every(o => KUERZEL.test(o.art)) && p.einbauten.every(e => KUERZEL.test(e.art))
    && p.einbauten.every(e => e.befestigung === undefined || KUERZEL.test(e.befestigung))
    && p.raeume.every(r => KUERZEL.test(r.schraege)) && p.verbindungen.every(v => KUERZEL.test(v.art))
    && p.varianten.every(v => v.platzhalter.every(ph => KUERZEL.test(ph.komponente))));
  pruef(`${name}: Bild-URLs nur Raster`, p.fotos.every(f => BILD.test(f.datenUrl) && !/["'<> ]/.test(f.datenUrl)));
  pruef(`${name}: Wandindex ganzzahlig`, p.oeffnungen.every(o => Number.isInteger(o.wandIndex) && o.wandIndex >= 0));
  // Jeder Verweis zeigt auf einen vorhandenen Raum.
  const raeume = new Set(p.raeume.map(r => r.id));
  pruef(`${name}: Verweise auf vorhandene Räume`,
    [...p.oeffnungen, ...p.einbauten, ...p.fotos, ...p.varianten.flatMap(v => v.platzhalter)].every(o => raeume.has(o.raumId))
    && p.verbindungen.every(v => raeume.has(v.raumA) && raeume.has(v.raumB)) && raeume.has(p.aktiverRaum));
}

// ------------------------------------------------ 1. Beispiel und leeres Projekt
{
  const bsp = beispielProjekt();
  const vorher = json(bsp);
  const nachher = bereinigen(json(bsp));
  pruef("Beispiel: bereinigen ändert nichts", gleich(nachher, vorher),
    JSON.stringify(nachher).slice(0, 300));
  attributSicher("Beispiel", nachher);
  pruef("Beispiel: Foto ist Rasterbild", BILD.test(bsp.fotos[0].datenUrl));
  pruef("Beispiel: ausObjektStreng nimmt es an", gleich(ausObjektStreng(json(bsp)), vorher));

  const leer = leeresProjekt();
  pruef("Leer: Name", leer.name === "Neues Projekt");
  pruef("Leer: ein Raum 4 × 3 × 2,5", leer.raeume.length === 1 && leer.raeume[0].name === "Raum 1"
    && leer.raeume[0].breiteM === 4 && leer.raeume[0].tiefeM === 3 && leer.raeume[0].hoeheM === 2.5);
  pruef("Leer: ohne Beispielinhalt", !leer.oeffnungen.length && !leer.einbauten.length && !leer.fotos.length
    && !leer.verbindungen.length);
  pruef("Leer: eine leere Variante", leer.varianten.length === 1 && leer.varianten[0].platzhalter.length === 0
    && leer.aktiveVariante === 0);
  pruef("Leer: aktiver Raum gesetzt", leer.aktiverRaum === leer.raeume[0].id);
  pruef("Leer: bereinigen ändert nichts", gleich(bereinigen(json(leer)), json(leer)));
  pruef("Leer: eigener Name", leeresProjekt("Kunde Müller").name === "Kunde Müller");
}

// ------------------------------------------------ 2. Bösartige Projekte (Audit t6_xss)
{
  const pl = tag => `<img src=x onerror="(window.__x=window.__x||[]).push('${tag}')">`;
  const brk = tag => `x"><img src=x onerror="(window.__x=window.__x||[]).push('${tag}')">`;
  const mk = (v) => {
    const raumA = v.raumId || "rA";
    return {
      name: "XSS-Test",
      raeume: [
        { id: raumA, name: "A", nummer: "A1", geschoss: v.geschoss ?? 0, breiteM: 4, breiteVorneM: null, tiefeM: 3,
          schraege: "KEINE", umriss: "", hoeheM: 2.5, aufbauM: 0, xM: 0, yM: 0, drehungGrad: 0,
          farbe: v.farbe ?? "#cfe8e9", notiz: "" },
        { id: "rB", name: "B", nummer: "", geschoss: v.geschossB ?? 0, breiteM: 3, breiteVorneM: null, tiefeM: 3,
          schraege: "KEINE", umriss: "", hoeheM: 2.5, aufbauM: 0, xM: 4, yM: 0, drehungGrad: 0, farbe: "#e6d8b5", notiz: "" }
      ],
      aktiverRaum: raumA,
      oeffnungen: v.oeffnungen ?? [],
      einbauten: v.einbauten ?? [],
      fotos: v.fotos ?? [],
      verbindungen: [],
      varianten: [{ id: "v1", name: "V", platzhalter: v.platzhalter ?? [] }],
      aktiveVariante: 0
    };
  };
  const faelle = {
    "raum.farbe": [mk({ farbe: brk("farbe") }), p => p.raeume[0].farbe === "#e6d8b5"],
    "raum.geschoss": [mk({ geschoss: brk("geschoss") }), p => p.raeume[0].geschoss === 0],
    "raum.geschoss B": [mk({ geschossB: brk("geschossChip") }), p => p.raeume[1].geschoss === 0],
    "raum.id": [mk({ raumId: brk("raumId") }), p => p.raeume[0].id !== brk("raumId") && p.aktiverRaum === p.raeume[0].id],
    "foto.datenUrl": [mk({ fotos: [{ id: "f1", raumId: "rA", relX: .5, relY: .5, titel: "t", datenUrl: brk("datenUrl"), notiz: "" }] }),
      p => p.fotos.length === 0],
    "foto.datenUrl mit gültigem Anfang": [mk({ fotos: [{ id: "f1", raumId: "rA", relX: .5, relY: .5, titel: "t",
      datenUrl: "data:image/png;base64,AAAA\" onerror=\"alert(1)", notiz: "" }] }), p => p.fotos.length === 0],
    "foto.datenUrl svg": [mk({ fotos: [{ id: "f1", raumId: "rA", titel: "t", datenUrl: "data:image/svg+xml,<svg onload=alert(1)>" }] }),
      p => p.fotos.length === 0],
    "foto.id": [mk({ fotos: [{ id: brk("fotoId"), raumId: "rA", relX: .5, relY: .5, titel: "t",
      datenUrl: "data:image/png;base64,iVBORw0KGgo=", notiz: "" }] }), p => p.fotos.length === 1 && p.fotos[0].id !== brk("fotoId")],
    "oeffnung.id": [mk({ oeffnungen: [{ id: brk("oefId"), raumId: "rA", art: "TUER", wandIndex: 0, abstandM: 1, breiteM: .9, hoeheM: 2, bruestungM: 0 }] }),
      p => p.oeffnungen.length === 1 && p.oeffnungen[0].id !== brk("oefId")],
    "oeffnung.art": [mk({ oeffnungen: [{ id: "o1", raumId: "rA", art: pl("oefArt"), wandIndex: 0, abstandM: 1, breiteM: .9, hoeheM: 2, bruestungM: 0 }] }),
      p => p.oeffnungen.length === 0],
    "einbau.id": [mk({ einbauten: [{ id: brk("einId"), raumId: "rA", art: "LAMPE", befestigung: "DECKE", relX: .5, relY: .5, hoeheM: 2.5 }] }),
      p => p.einbauten.length === 1 && p.einbauten[0].id !== brk("einId")],
    "einbau.befestigung": [mk({ einbauten: [{ id: "e1", raumId: "rA", art: "LAMPE", befestigung: pl("bef") }] }),
      p => p.einbauten.length === 1 && p.einbauten[0].befestigung === undefined],
    "platzhalter.id": [mk({ platzhalter: [{ id: brk("phId"), raumId: "rA", komponente: "ZAEHLERSCHRANK", xM: 1, yM: 2.9, drehungGrad: 180, bezeichnung: "" }] }),
      p => p.varianten[0].platzhalter.length === 1 && p.varianten[0].platzhalter[0].id !== brk("phId")],
    "platzhalter.bezeichnung": [mk({ platzhalter: [{ id: "p1", raumId: "rA", komponente: "ZAEHLERSCHRANK", xM: 1, yM: 2.9, drehungGrad: 180, bezeichnung: pl("phBez") }] }),
      p => typeof p.varianten[0].platzhalter[0].bezeichnung === "string"],   // Text – maskiert wird beim Ausgeben
    "platzhalter.komponente": [mk({ platzhalter: [{ id: "p1", raumId: "rA", komponente: pl("phKomp"), xM: 1, yM: 2.9, drehungGrad: 180, bezeichnung: "" }] }),
      p => p.varianten[0].platzhalter.length === 0],
    "raum.schraege": [(() => { const o = mk({}); o.raeume[0].schraege = pl("schraege"); return o; })(), p => p.raeume[0].schraege === "KEINE"],
    "raum.umriss": [(() => { const o = mk({}); o.raeume[0].umriss = `[[0,0],[4,0],[4,"${pl("u")}"]]`; return o; })(), p => p.raeume[0].umriss === ""],
    "raum.breiteM": [(() => { const o = mk({}); o.raeume[0].breiteM = pl("breite"); o.raeume[0].tiefeM = "3.5"; return o; })(),
      p => p.raeume[0].breiteM === 4 && p.raeume[0].tiefeM === 3.5],
    "oeffnung.wandIndex": [mk({ oeffnungen: [{ id: "o1", raumId: "rA", art: "FENSTER", wandIndex: brk("w"), abstandM: "1,5", breiteM: -1, hoeheM: 1.2, bruestungM: 0.9 }] }),
      p => p.oeffnungen[0].wandIndex === 0 && p.oeffnungen[0].abstandM === 0 && p.oeffnungen[0].breiteM === 0.9],
  };
  for (const [name, [obj, erwartung]] of Object.entries(faelle)) {
    let p;
    const fehler = wirft(() => { p = ausObjektStreng(obj); });
    pruef(`Bösartig ${name}: angenommen`, !fehler, fehler && fehler.message);
    if (!p) continue;
    attributSicher(`Bösartig ${name}`, p);
    pruef(`Bösartig ${name}: erwartete Bereinigung`, erwartung(p), JSON.stringify(p).slice(0, 400));
    // Nirgends in einem Nicht-Text-Feld darf ein Tag-Anfang stehen.
    const ohneTexte = JSON.stringify(p, (k, v) => (["name", "nummer", "notiz", "titel", "bezeichnung"].includes(k) ? "" : v));
    pruef(`Bösartig ${name}: kein Markup außerhalb von Texten`, !/[<>"]|onerror/.test(ohneTexte.replace(/\\"/g, "").replace(/"/g, "")),
      ohneTexte.slice(0, 300));
  }

  // Prototyp-Verschmutzung über __proto__ im JSON
  const roh = JSON.parse(`{"__proto__":{"verseucht":1},"raeume":[{"id":"r1","__proto__":{"verseucht":2}}],
    "oeffnungen":[{"id":"o1","raumId":"r1","art":"TUER","constructor":{"prototype":{"verseucht":3}}}]}`);
  const p = ausObjektStreng(roh);
  pruef("Prototyp: Objekt unverändert", ({}).verseucht === undefined && Object.getPrototypeOf(p) === Object.prototype);
  pruef("Prototyp: __proto__-Felder entfernt", !Object.prototype.hasOwnProperty.call(p, "__proto__")
    && !Object.prototype.hasOwnProperty.call(p.raeume[0], "__proto__")
    && !Object.prototype.hasOwnProperty.call(p.oeffnungen[0], "constructor"));
}

// ------------------------------------------------ 3. Ungültiger Import wirft und lässt den Speicher in Ruhe
{
  ls.clear();
  const eigen = leeresProjekt("Kunde Müller – Aufmaß");
  speichern(eigen);
  const stand = ls.getItem("raumwerk.projekt.v1");
  const ungueltig = {
    "leeres Objekt": { foo: 1 },
    "leere Raumliste": { raeume: [] },
    "Array": [],
    "Text": "hallo",
    "null": null,
    "Zahl": 42,
    "Raumliste kein Array": { raeume: "abc" },
    "Räume unlesbar": { raeume: [1, "x", null] },
  };
  for (const [name, o] of Object.entries(ungueltig)) {
    const e = wirft(() => ausObjektStreng(o));
    pruef(`Ungültig ${name}: wirft Error`, e instanceof Error && e.message.length > 10, e && e.message);
    pruef(`Ungültig ${name}: deutsche Begründung`, e && /Datei|Projekt|Raum|Räume/.test(e.message), e && e.message);
  }
  pruef("Ungültig: Speicher unberührt", ls.getItem("raumwerk.projekt.v1") === stand);
  pruef("Ungültig: laden() gibt eigenen Stand", laden().name === "Kunde Müller – Aufmaß");
  // Der nachsichtige Weg bleibt für ältere Aufrufer: Beispiel statt Fehler.
  pruef("ausObjekt nachsichtig: Beispiel", ausObjekt({ foo: 1 }).name === "Technikraum (Beispiel)");
  pruef("ausObjekt nachsichtig: Speicher unberührt", ls.getItem("raumwerk.projekt.v1") === stand);
}

// ------------------------------------------------ 4. IDs konsistent neu vergeben
{
  const schlecht = "r 1<b>";
  const oefSchlecht = "oef\"x";
  const o = {
    name: "IDs",
    raeume: [
      { id: schlecht, name: "A", breiteM: 4, tiefeM: 3, hoeheM: 2.5,
        aufnahme: { version: 2, methode: "zielen", haltung: "hand", kamerahoeheM: "1.4",
          ecken: [{ v: ["0.1", "x", 0.9], ebene: "boden", t: 1792804138372 }, { v: [1, 0, 0], ebene: "<b>", t: 13 }],
          bandmasse: { "0": "3.2", "<x>": 5 },
          oeffnungen: [{ id: oefSchlecht, art: "TUER", a: [0, 1, 0], b: [1, 0, 0] }],
          einbauten: [{ id: "e1", art: "<img>", befestigung: "WAND", v: [0, 0, 1] }] } },
      { id: "rB", name: "B", breiteM: 3, tiefeM: 3 },
      { id: "rB", name: "B doppelt", breiteM: 2, tiefeM: 2 }
    ],
    aktiverRaum: schlecht,
    oeffnungen: [
      { id: oefSchlecht, raumId: schlecht, art: "TUER", wandIndex: 1, abstandM: 0.5, breiteM: 0.9, hoeheM: 2, bruestungM: 0, ausAufnahme: true },
      { id: "o2", raumId: "gibt-es-nicht", art: "TUER" }
    ],
    einbauten: [{ id: "e1", raumId: schlecht, art: "STECKDOSE", befestigung: "WAND", wandIndex: "2", abstandM: 1, hoeheM: null }],
    fotos: [{ id: "f1", raumId: schlecht, datenUrl: "data:image/jpeg;base64,/9j/4AAQ", titel: 5 }],
    verbindungen: [
      { id: "v1", raumA: schlecht, raumB: "rB", art: "TUER", breiteM: 0.885 },
      { id: "v2", raumA: schlecht, raumB: "weg", art: "TUER" },
      { id: "v3", raumA: "rB", raumB: "rB" }
    ],
    varianten: [{ id: "va", name: "A", platzhalter: [
      { id: "p1", raumId: schlecht, komponente: "ZAEHLERSCHRANK", xM: "1", yM: 2, drehungGrad: 90 },
      { id: "p2", raumId: "weg", komponente: "ZAEHLERSCHRANK", xM: 1, yM: 2 }
    ] }],
    aktiveVariante: 7,
    scans: [{ werkzeug: "raumwerk-scan", anzahl: 3, wuerfelKanteM: null }]
  };
  const p = ausObjektStreng(o);
  attributSicher("IDs", p);
  const neu = p.raeume[0].id;
  pruef("IDs: Raum neu vergeben", neu !== schlecht && ID.test(neu));
  pruef("IDs: aktiver Raum zieht nach", p.aktiverRaum === neu);
  pruef("IDs: Öffnung zieht nach", p.oeffnungen.length === 1 && p.oeffnungen[0].raumId === neu);
  pruef("IDs: Einbau zieht nach", p.einbauten[0].raumId === neu && p.einbauten[0].wandIndex === 2 && p.einbauten[0].hoeheM === null);
  pruef("IDs: Einbau an der Wand ohne relX bleibt so", !("relX" in p.einbauten[0]));
  pruef("IDs: Foto zieht nach", p.fotos[0].raumId === neu && p.fotos[0].titel === "5");
  pruef("IDs: Platzhalter zieht nach", p.varianten[0].platzhalter.length === 1 && p.varianten[0].platzhalter[0].raumId === neu
    && p.varianten[0].platzhalter[0].xM === 1);
  pruef("IDs: Verbindung zieht nach", p.verbindungen.length === 1 && p.verbindungen[0].raumA === neu && p.verbindungen[0].raumB === "rB");
  pruef("IDs: doppelte Raum-ID neu vergeben", p.raeume.length === 3 && p.raeume[2].id !== "rB" && p.raeume[1].id === "rB");
  pruef("IDs: aktive Variante im Bereich", p.aktiveVariante === 0);
  const oefNeu = p.oeffnungen[0].id;
  pruef("IDs: Öffnungs-ID neu", oefNeu !== oefSchlecht && ID.test(oefNeu));
  const a = p.raeume[0].aufnahme;
  pruef("Aufnahme: Öffnungs-ID wie im Projekt", a.oeffnungen[0].id === oefNeu);
  pruef("Aufnahme: Vektoren als Zahlen", gleich(a.ecken[0].v, [0.1, null, 0.9]) && a.kamerahoeheM === 1.4);
  pruef("Aufnahme: Kennwörter geprüft", a.methode === "zielen" && a.haltung === "hand" && a.ecken[0].ebene === "boden" && a.ecken[1].ebene === null);
  pruef("Aufnahme: Kürzel geprüft", a.oeffnungen[0].art === "TUER" && a.einbauten[0].art === null && a.einbauten[0].befestigung === "WAND");
  pruef("Aufnahme: Bandmaße", a.bandmasse["0"] === 3.2 && !("<x>" in a.bandmasse));
  pruef("Aufnahme: Zeitstempel (ms) ungekappt", a.ecken[0].t === 1792804138372);
  pruef("Zusatzfelder bleiben (scans)", Array.isArray(p.scans) && p.scans[0].anzahl === 3 && p.scans[0].wuerfelKanteM === null);
  // Zweimal bereinigen ändert nichts mehr.
  pruef("Bereinigen ist idempotent", gleich(bereinigen(json(p)), json(p)));
}

// ------------------------------------------------ 5. Alter Einzelraum-Stand
{
  const alt = {
    name: "Alt",
    raum: { id: "raum-alt", name: "Technikraum", nummer: "T.01", geschoss: 0, breiteM: 4.2, breiteVorneM: null,
      tiefeM: 3, schraege: "KEINE", umriss: "", hoeheM: 2.5, xM: 0, yM: 0, drehungGrad: 0, farbe: "#cfe8e9", notiz: "" },
    oeffnungen: [{ id: "oef-1", raumId: "raum-alt", art: "TUER", bezeichnung: "Zugang", wandIndex: 0, abstandM: 1.6, breiteM: 0.885, hoeheM: 2.01, bruestungM: 0 }],
    einbauten: [{ id: "ein-1", art: "LAMPE", befestigung: "DECKE", relX: 0.5, relY: 0.5, hoeheM: 2.5 }],   // ohne raumId
    varianten: [{ id: "var-1", name: "Variante A", platzhalter: [
      { id: "ph-1", raumId: "raum-alt", komponente: "ZAEHLERSCHRANK", xM: 0.9, yM: 2.9, drehungGrad: 180, bezeichnung: "" }] }],
    aktiveVariante: 0
  };
  const p = ausObjektStreng(alt);
  pruef("Alt: Räume-Liste", Array.isArray(p.raeume) && p.raeume.length === 1 && p.raeume[0].id === "raum-alt" && !("raum" in p));
  pruef("Alt: aktiver Raum", p.aktiverRaum === "raum-alt");
  pruef("Alt: Aufbau ergänzt", p.raeume[0].aufbauM === 0);
  pruef("Alt: Öffnung erhalten", p.oeffnungen.length === 1 && p.oeffnungen[0].bezeichnung === "Zugang");
  pruef("Alt: Einbau ohne raumId gehört zum einzigen Raum", p.einbauten.length === 1 && p.einbauten[0].raumId === "raum-alt");
  pruef("Alt: fehlende Listen angelegt", Array.isArray(p.fotos) && Array.isArray(p.verbindungen));
  pruef("Alt: Platzhalter erhalten", p.varianten[0].platzhalter.length === 1);
  pruef("Alt: Umriss gültig bleibt", ausObjektStreng({ raeume: [{ id: "r", umriss: "[[0,0],[4,0],[4,3],[0,3]]" }] }).raeume[0].umriss === "[[0,0],[4,0],[4,3],[0,3]]");
  // Unplausibel, aber endlich: bleibt stehen (die Oberfläche prüft Eingaben selbst).
  pruef("Alt: Raumhöhe 250 bleibt", ausObjektStreng({ raeume: [{ id: "r", hoeheM: 250 }] }).raeume[0].hoeheM === 250);

  // Das frühere Beispielfoto war ein SVG – es wird durch das PNG ersetzt statt verworfen.
  const altesFoto = "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='380' height='240'><text>TYPENSCHILD (Beispiel)</text></svg>");
  const mitFoto = ausObjektStreng({ raeume: [{ id: "r" }], fotos: [{ id: "f", raumId: "r", datenUrl: altesFoto, titel: "Typenschild" }] });
  pruef("Alt: SVG-Beispielfoto → PNG", mitFoto.fotos.length === 1 && mitFoto.fotos[0].datenUrl === beispielProjekt().fotos[0].datenUrl);
}

// ------------------------------------------------ 6. laden, Sicherung, Speicherbelegung
{
  ls.clear();
  pruef("laden: leerer Speicher → Beispiel", laden().name === "Technikraum (Beispiel)");
  ls.setItem("raumwerk.projekt.v1", "{kaputt");
  pruef("laden: kaputter Stand → Beispiel", laden().name === "Technikraum (Beispiel)");
  pruef("laden: kaputter Stand beiseitegelegt", ls.getItem("raumwerk.projekt.v1.defekt") === "{kaputt");
  ls.setItem("raumwerk.projekt.v1", JSON.stringify({ name: "Gespeichert", raeume: [{ id: "r1", farbe: "red\" onclick=\"x" }] }));
  const p = laden();
  pruef("laden: gespeicherter Stand bereinigt", p.name === "Gespeichert" && p.raeume[0].farbe === "#e6d8b5");

  const eigen = leeresProjekt("Vorher");
  pruef("vorherSichern: true", vorherSichern(eigen) === true);
  pruef("vorherSichern: Schlüssel", JSON.parse(ls.getItem("raumwerk.projekt.v1.vorher")).name === "Vorher");
  pruef("vorherLaden: liest zurück", vorherLaden()?.name === "Vorher");
  pruef("vorherSichern: ohne Projekt false", vorherSichern(null) === false);

  ls.clear();
  const bsp = beispielProjekt();
  pruef("speicherBelegung: Projekt ≈ JSON-Länge", speicherBelegung(bsp) === JSON.stringify(bsp).length);
  pruef("speicherBelegung: leerer Speicher 0", speicherBelegung() === 0);
  speichern(bsp);
  pruef("speicherBelegung: gespeicherter Stand", speicherBelegung() === JSON.stringify(bsp).length);
  pruef("Warngrenze 3,5 MB", SPEICHER_WARNGRENZE === 3.5e6);

  // Voller Speicher: speichern → false, vorherSichern → false, kein Wurf.
  kapazitaet = belegt() + 100;
  const gross = leeresProjekt("Groß");
  gross.raeume[0].notiz = "x".repeat(50000);   // größer als der gespeicherte Stand
  pruef("Voll: speichern false", speichern(gross) === false);
  pruef("Voll: vorherSichern false, wirft nicht", wirft(() => pruef("Voll: vorherSichern false", vorherSichern(gross) === false)) === null);
  pruef("Voll: alter Stand bleibt", JSON.parse(ls.getItem("raumwerk.projekt.v1")).name === "Technikraum (Beispiel)");
  kapazitaet = Infinity;
}

// ------------------------------------- 7. Ersetzen nur mit Sicherung oder nach Rückfrage
{
  // Großes Projekt (viele Fotos): Hauptstand passt, eine zweite Kopie als Sicherung nicht.
  ls.clear();
  const gross = beispielProjekt(); gross.name = "Groß";
  for (let i = 0; i < 14; i++) gross.fotos.push({ id: `foto-g${i}`, raumId: gross.raeume[0].id, relX: 0.5, relY: 0.5, titel: `F${i}`, datenUrl: "data:image/jpeg;base64," + "A".repeat(19000), notiz: "" });
  pruef("Ersetzen: großes Projekt gespeichert", speichern(gross) === true);
  kapazitaet = belegt() * 1.9;
  const name = () => JSON.parse(ls.getItem("raumwerk.projekt.v1")).name;
  const fragen = (exp, ohne) => {
    const log = [];
    return { log, erstExportieren: () => (log.push("export"), exp), ohneSicherung: () => (log.push("ohne"), ohne) };
  };

  // Sicherung scheitert → nie still ersetzen.
  let f = fragen(true, true);
  let v = Store.vorErsetzen(gross, f);
  pruef("Voll: erst exportieren → nicht ersetzen", v.ersetzen === false && v.exportieren === true && v.gesichert === false, JSON.stringify(v));
  pruef("Voll: Export zuerst angeboten, nicht weiter gefragt", gleich(f.log, ["export"]), f.log.join());
  f = fragen(false, false);
  v = Store.vorErsetzen(gross, f);
  pruef("Voll: ohne Sicherung abgelehnt → nicht ersetzen", v.ersetzen === false && v.exportieren === false && gleich(f.log, ["export", "ohne"]), JSON.stringify(v));
  f = fragen(false, true);
  v = Store.vorErsetzen(gross, f);
  pruef("Voll: ohne Sicherung bestätigt → ersetzen, ungesichert", v.ersetzen === true && v.gesichert === false, JSON.stringify(v));
  pruef("Voll: ohne Rückfrage-Funktionen → nicht ersetzen", Store.vorErsetzen(gross).ersetzen === false);
  pruef("Voll: Hauptstand unangetastet", name() === "Groß");
  pruef("Voll: keine Sicherung vorgetäuscht", vorherLaden() === null);

  // Platz genug → sichern, ohne zu fragen.
  kapazitaet = Infinity;
  f = fragen(true, false);
  v = Store.vorErsetzen(gross, f);
  pruef("Platz: gesichert, keine Rückfrage", v.ersetzen === true && v.gesichert === true && f.log.length === 0, JSON.stringify(v));
  pruef("Platz: Sicherung lesbar", vorherLaden()?.name === "Groß");
}

// ------------------------------------- 8. Foto ablegen: voll → wieder heraus
{
  ls.clear();
  const p = leeresProjekt("Fotos");
  speichern(p);
  const foto = i => ({ id: `foto-${i}`, raumId: p.raeume[0].id, relX: 0.5, relY: 0.5, titel: `F${i}`, datenUrl: "data:image/jpeg;base64," + "B".repeat(5000), notiz: "" });
  kapazitaet = belegt() + 12000;   // Platz für zwei Fotos
  const fotos = p.fotos;
  pruef("Foto 1 abgelegt", Store.fotoAblegen(p, foto(1)) === true);
  pruef("Foto 2 abgelegt", Store.fotoAblegen(p, foto(2)) === true);
  pruef("Foto 3: voll → false", Store.fotoAblegen(p, foto(3)) === false);
  pruef("Foto 3 wieder heraus (RAM)", p.fotos.length === 2 && !p.fotos.some(x => x.id === "foto-3"));
  pruef("Fotoliste bleibt dieselbe", p.fotos === fotos);
  pruef("gespeichert: zwei Fotos", JSON.parse(ls.getItem("raumwerk.projekt.v1")).fotos.length === 2);
  // Danach bleibt das Projekt speicherbar – spätere Änderungen gehen nicht verloren.
  p.name = "Fotos (geändert)";
  pruef("spätere Änderung wird gespeichert", speichern(p) === true && JSON.parse(ls.getItem("raumwerk.projekt.v1")).name === "Fotos (geändert)");
  kapazitaet = Infinity;
  const ohneListe = { name: "x" };
  pruef("Foto ablegen ohne Liste", Store.fotoAblegen(ohneListe, foto(4)) === true && ohneListe.fotos.length === 1);
}

// ------------------------------------- 9. Gezielte Objekte von Hand geändert
{
  const o = { id: "oef-1", art: "TUER", ausAufnahme: true };
  pruef("vonHand: gezielt → Handeintrag", Store.vonHand(o) === o && o.ausAufnahme === false);
  const h = { id: "oef-2", art: "TUER" };
  Store.vonHand(h);
  pruef("vonHand: Handeintrag bleibt ohne Feld", !("ausAufnahme" in h));
  pruef("vonHand: null ok", wirft(() => Store.vonHand(null)) === null);

  // Plan-Zug eines gezielten Einbaus
  const zug = { gezielt: null };
  const e = { id: "ein-1", art: "STECKDOSE", befestigung: "WAND", wandIndex: 1, abstandM: 0.5, ausAufnahme: true };
  Store.einbauVerschieben(e, { wandIndex: 1, abstandM: 0.8 }, zug);
  pruef("Zug: verschoben → Handeintrag", e.ausAufnahme === false && e.abstandM === 0.8);
  Store.einbauVerschieben(e, { befestigung: "WAND", wandIndex: 1, abstandM: 0.5 }, zug);   // Plan nimmt den Zug zurück
  pruef("Zug abgebrochen → bleibt gezielt", e.ausAufnahme === true);
  Store.einbauVerschieben(e, { abstandM: 1.1 }, zug);
  zug.gezielt = null;                                                                    // losgelassen
  Store.einbauVerschieben(e, { abstandM: 0.5 }, zug);
  pruef("nach dem Loslassen: Zurückziehen macht nicht wieder gezielt", e.ausAufnahme === false);
  const m = { id: "ein-2", art: "SCHALTER", befestigung: "WAND", wandIndex: 0, abstandM: 0.2 };
  Store.einbauVerschieben(m, { abstandM: 0.4 }, { gezielt: null });
  pruef("Zug: Handeintrag bleibt ohne Feld", !("ausAufnahme" in m) && m.abstandM === 0.4);

  // Änderungen außerhalb der App (AR) nachträglich erkennen
  const a = { id: "ein-3", hoeheM: 0.3, ausAufnahme: true }, b = { id: "ein-4", hoeheM: 1.05, ausAufnahme: true }, c = { id: "ein-5", hoeheM: 1.1 };
  const staende = Store.gezielteMerken([a, b, c]);
  pruef("gezielteMerken: nur gezielte", staende.length === 2);
  a.hoeheM = 0.45;
  Store.gezielteNachpruefen(staende);
  pruef("AR geändert → Handeintrag", a.ausAufnahme === false);
  pruef("AR unverändert → bleibt gezielt", b.ausAufnahme === true);
  pruef("gezielteNachpruefen: leer ok", wirft(() => Store.gezielteNachpruefen(null)) === null);
}

console.log(`store.test: ${ok} ok, ${fail} Fehler`);
if (fail) process.exit(1);
