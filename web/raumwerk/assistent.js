/*
 * Aufmaß-Assistent – einen echten Raum aufnehmen, ohne Würfel.
 *
 * Drei Wege, je nachdem, was vor Ort zur Hand ist:
 *
 *  · **Zielen** (Handy): Kamera mit Fadenkreuz, das Handy auf Brusthöhe. Erst
 *    die Bodenecken im Kreis antippen, dann (optional) Raumhöhe, Türen,
 *    Fenster, Steckdosen & Co. anzielen. Ein einziges bekanntes Maß – eine
 *    Wand mit dem Bandmaß, die Raumhöhe vom Laser, eine Türhöhe – setzt den
 *    Maßstab für alles (web/raumaufnahme.js).
 *  · **Maßband / Laser**: Wand für Wand Länge und Abbiegung eintippen – der
 *    Polygonzug des Kerns mit laufender Restlücke. Geht immer, ist am genauesten.
 *  · **Rechteck**: Breite × Tiefe × Höhe, für den schnellen Normalfall.
 *
 * Lage kommt über `window.__native.beiLage` (App: Spiel-Rotationsvektor ohne
 * Kompass; Browser: deviceorientation). Ausgelöst wird per Knopf oder – in der
 * App – mit der Lautstärketaste, damit beim Antippen nichts verwackelt.
 *
 * Eigenständig gestylt (Präfix `as-`), damit derselbe Assistent im
 * Feld-Design und in der PC-Oberfläche läuft.
 */

import * as Z from "../zielen.js";
import * as A from "../raumaufnahme.js";
import * as G from "../geometrie.js";
import * as Normmasse from "../normmasse.js";

const NAT = () => window.__native || null;
const SCHLUESSEL_HOEHE = "raumwerk.kamerahoehe";

/** Einbauarten, die man vor Ort typischerweise anzielt. */
const ZIEL_EINBAUTEN = ["STECKDOSE", "STECKDOSE_2FACH", "SCHALTER", "NETZWERKDOSE",
  "LAMPE", "WANDLEUCHTE", "RAUCHMELDER", "SICHERUNGSKASTEN", "HEIZKOERPER", "THERMOSTAT"];
const OEFF_ARTEN = [["TUER", "Tür"], ["FENSTER", "Fenster"], ["DURCHGANG", "Durchgang"]];

/**
 * Startet den Assistenten als Vollbild-Ebene.
 * opts: { raum, neueId, onUebernehmen(ergebnis), onAbbruch(), start?: "zielen"|"band"|"rechteck" }
 * Ergebnis: { methode, umriss, breiteM, tiefeM, hoeheM, oeffnungen[], einbauten[], waende[], aufnahme, … }
 */
export function starteAssistent(opts) {
  stilEinhaengen();
  const raum = opts.raum || {};
  const neueId = opts.neueId || (p => `${p}-${Math.random().toString(36).slice(2, 9)}`);
  const wurzel = el("div", "as-wurzel");
  document.body.append(wurzel);
  const aufraeumen = [];      // Abmeldefunktionen (Sensor, Tasten, Kamera, Zurück)

  const st = {
    schritt: "start",
    a: null,
    phase: "ecken",
    ziel: "boden",
    oeffArt: "TUER", oeffTeil: null,
    einbauArt: "STECKDOSE",
    hoeheTeil: null,      // { v, t } – erster Schuss der Raumhöhe
    kalibTeil: null,      // { v } – erster Schuss der Wende-Kalibrierung
    puffer: [],
    letzteLage: 0,
    band: { waende: startWaende(raum), hoeheM: zahlOder(raum.hoeheM, 2.5), ausgleich: false },
    rechteck: { b: zahlOder(raum.breiteM, 4), t: zahlOder(raum.tiefeM, 3), h: zahlOder(raum.hoeheM, 2.5) },
    meldung: ""
  };

  const nat = NAT();
  if (nat && nat.beiZurueck) aufraeumen.push(nat.beiZurueck(() => { zurueck(); return true; }));

  function beenden(ergebnis) {
    kameraAus(); lageAus();
    while (aufraeumen.length) { try { aufraeumen.pop()(); } catch (_) {} }
    wurzel.remove();
    if (ergebnis) opts.onUebernehmen && opts.onUebernehmen(ergebnis);
    else opts.onAbbruch && opts.onAbbruch();
  }

  /** Zurück-Taste/Schließen: eine Stufe zurück, auf der Startseite beenden. */
  function zurueck() {
    if (st.schritt === "zielen") zeige("vorbereitung");      // Aufnahme bleibt erhalten
    else if (st.schritt === "pruefen") { zeige("zielen"); lageAn(); kameraAn(); }
    else if (st.schritt === "start") beenden(null);
    else zeige("start");
  }

  // ======================================================== Startseite

  function startSeite() {
    wurzel.className = "as-wurzel as-hell";
    wurzel.innerHTML = `
      <div class="as-blatt">
        <div class="as-kopfzeile"><button class="as-zu" aria-label="Schließen">✕</button>
          <div><span class="as-krume">AUFMASS · ${esc(raum.name || "Raum")}</span><h2>Wie wird gemessen?</h2></div></div>
        <p class="as-text">Kein Würfel, kein Spezialgerät nötig. Wähle, was du gerade zur Hand hast – jeder Weg ergibt einen maßstäblichen Grundriss.</p>
        <button class="as-karte-wahl" data-weg="zielen">
          <span class="as-sym">◎</span><span><b>Mit dem Handy zielen</b>
          <small>Kamera auf die Raumecken richten – Umriss, Höhe, Türen, Fenster und Steckdosen in ~2 Minuten. Ein Bandmaß-Wert macht es zentimetergenau.</small></span></button>
        <button class="as-karte-wahl" data-weg="band">
          <span class="as-sym">⟷</span><span><b>Maßband oder Laser</b>
          <small>Wand für Wand Länge und Abbiegung eintragen. Funktioniert immer, auch ohne Sensoren – mit Restlücke als Kontrolle.</small></span></button>
        <button class="as-karte-wahl" data-weg="rechteck">
          <span class="as-sym">▭</span><span><b>Rechteck</b>
          <small>Breite × Tiefe × Höhe – für den einfachen Raum.</small></span></button>
      </div>`;
    wurzel.querySelector(".as-zu").onclick = () => beenden(null);
    wurzel.querySelectorAll("[data-weg]").forEach(b => b.onclick = () => zeige(b.dataset.weg === "zielen" ? "vorbereitung" : b.dataset.weg));
  }

  // ===================================================== Vorbereitung

  function vorbereitung() {
    const h = gespeicherteHoehe();
    const roh = (Number(raum.aufbauM) || 0) > 0;
    const haltung = gespeicherteHaltung();
    const geraet = geraetKalibrierung();
    wurzel.className = "as-wurzel as-hell";
    wurzel.innerHTML = `
      <div class="as-blatt">
        <div class="as-kopfzeile"><button class="as-zu" aria-label="Zurück">‹</button>
          <div><span class="as-krume">ZIELEN · VORBEREITUNG</span><h2>So geht's</h2></div></div>
        <div class="as-bild">${skizzeHaltung()}</div>
        <ol class="as-liste">
          <li>Stell dich so in den Raum, dass du <b>alle Bodenecken</b> siehst – meist etwa in die Mitte.</li>
          <li>Halte das Handy hochkant vor die Brust, <b>bleib auf der Stelle stehen</b> und dreh dich nur.</li>
          <li>Fadenkreuz auf eine Bodenecke, ruhig halten, auslösen${nat && nat.app ? " (auch mit der <b>Lautstärketaste</b>)" : ""}. Reihum alle Ecken.</li>
        </ol>
        <div class="as-segment" id="asHaltung">
          <button data-haltung="hand" class="${haltung === "hand" ? "an" : ""}">Freihand</button>
          <button data-haltung="stativ" class="${haltung === "stativ" ? "an" : ""}">Stativ / Handy-Halter</button>
        </div>
        <div class="as-feld"><label for="asH" id="asHLabel">${haltung === "stativ" ? "Höhe der Kameralinse am Stativ (m) – gemessen" : "Kamerahöhe, Handy senkrecht vor der Brust (m)"}</label>
          <input id="asH" inputmode="decimal" value="${komma(h)}">
          <small id="asHHinweis">${haltung === "stativ" ? "Einmal mit dem Zollstock messen – dann braucht es oft gar kein Bandmaß mehr." : "Schätzung reicht: Ein Bandmaß, die Raumhöhe oder eine Türhöhe setzt den Maßstab. Dass das Handy vor dem Körper sitzt, rechnet die App heraus."}</small></div>
        <div class="as-kalib ${geraet ? "ok" : ""}">
          <span>${geraet ? `✓ Neigung kalibriert (${komma(geraet.neigungsfehlerGrad, 2)}°, ${new Date(geraet.datum).toLocaleDateString("de-DE")})` : "Neigung nicht kalibriert – kostet ~2–3 cm bei Höhen."}</span>
          <button class="as-link" id="asKalib">${geraet ? "neu kalibrieren" : "Jetzt kalibrieren (30 s)"}</button>
        </div>
        ${roh ? `<label class="as-schalter"><input type="checkbox" id="asRoh" checked> <span>Estrich fehlt noch – ich ziele auf den <b>Rohboden</b> (Aufbau ${Math.round(Number(raum.aufbauM) * 1000)} mm wird abgezogen)</span></label>` : ""}
        <label class="as-schalter"><input type="checkbox" id="asRecht" checked> <span>Raum ist rechtwinklig (Ecken auf 90° glätten)</span></label>
        <button class="as-haupt" id="asLos">Kamera starten</button>
        <p class="as-fein">Braucht Kamera und Lagesensor. Ohne Sensor: zurück und „Maßband“ wählen.</p>
      </div>`;
    wurzel.querySelector(".as-zu").onclick = () => zeige("start");
    wurzel.querySelectorAll("[data-haltung]").forEach(b => b.onclick = () => {
      try { localStorage.setItem(SCHLUESSEL_HALTUNG, b.dataset.haltung); } catch (_) {}
      const hm = zahl(wurzel.querySelector("#asH").value);
      if (hm > 0.3 && hm < 2.5) try { localStorage.setItem(SCHLUESSEL_HOEHE, String(hm)); } catch (_) {}
      vorbereitung();
    });
    const uebernehmenUndLos = phase => {
      const hm = zahl(wurzel.querySelector("#asH").value);
      const hh = hm > 0.3 && hm < 2.5 ? hm : 1.4;
      try { localStorage.setItem(SCHLUESSEL_HOEHE, String(hh)); } catch (_) {}
      const bodenRoh = !!wurzel.querySelector("#asRoh")?.checked;
      // Eine laufende Aufnahme (zurück aus „Prüfen“) nicht verwerfen.
      if (!st.a) st.a = A.neueAufnahme(hh, bodenRoh ? "roh" : "fertig");
      st.a.kamerahoeheM = hh;
      st.a.haltung = gespeicherteHaltung();
      st.a.neigungsfehlerGrad = geraetKalibrierung()?.neigungsfehlerGrad ?? null;
      st.a.boden = bodenRoh ? "roh" : "fertig";
      st.a.rechtwinklig = !!wurzel.querySelector("#asRecht")?.checked;
      if (phase) { st.vorKalib = st.phase; st.phase = phase; st.kalibTeil = null; }
      // In der Nutzergeste starten: iOS fragt sonst nicht nach dem Lagesensor.
      lageAn(); kameraAn();
      zeige("zielen");
    };
    wurzel.querySelector("#asLos").onclick = () => uebernehmenUndLos(null);
    wurzel.querySelector("#asKalib").onclick = () => uebernehmenUndLos("kalib");
  }

  // ============================================================ Zielen

  let video = null, strom = null, lageWeg = null, tasteWeg = null, schleife = 0;

  function kameraAn() {
    if (strom || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false })
      .then(s => { strom = s; if (video) { video.srcObject = s; video.play().catch(() => {}); } })
      .catch(() => { st.meldung = "Keine Kamera – Zielen nur über die Handy-Oberkante möglich."; });
  }
  function kameraAus() { if (strom) { strom.getTracks().forEach(t => t.stop()); strom = null; } }

  function lageAn() {
    if (lageWeg || !nat || !nat.beiLage) return;
    lageWeg = nat.beiLage(o => {
      let v = null;
      if (o && o.qs) v = Z.blickAusQuaternion(o.qs);
      else if (o && o.euler) v = Z.blickAusEuler(o.euler[0], o.euler[1], o.euler[2]);
      if (!v || !v.every(Number.isFinite)) return;
      const t = performance.now();
      st.puffer.push({ t, v });
      while (st.puffer.length && st.puffer[0].t < t - 1500) st.puffer.shift();
      st.letzteLage = t;
    });
    if (nat.beiTaste) tasteWeg = nat.beiTaste(() => { if (st.schritt === "zielen") ausloesen(); });
  }
  function lageAus() {
    if (lageWeg) { lageWeg(); lageWeg = null; }
    if (tasteWeg) { tasteWeg(); tasteWeg = null; }
    cancelAnimationFrame(schleife);
  }

  /** Gemittelte Blickrichtung kurz VOR dem Auslösen – der Druck selbst wackelt. */
  function blickJetzt(spaetMs = 60, fensterMs = 420) {
    const t = performance.now();
    let s = st.puffer.filter(p => p.t <= t - spaetMs && p.t >= t - spaetMs - fensterMs);
    if (s.length < 3) s = st.puffer.slice(-4);
    return Z.mitteln(s.map(p => p.v));
  }

  function zielen() {
    wurzel.className = "as-wurzel as-dunkel";
    wurzel.innerHTML = `
      <div class="as-kamera">
        <video class="as-video" playsinline muted autoplay></video>
        <div class="as-kreuz"><i></i><i></i><b></b></div>
        <div class="as-oben">
          <button class="as-zu" aria-label="Zurück">‹</button>
          <div class="as-titel"><span class="as-krume" id="asKrume"></span><b id="asTitel"></b></div>
          <svg class="as-mini" id="asMini" viewBox="0 0 100 100"></svg>
        </div>
        <div class="as-anleitung" id="asAnleitung"></div>
        <div class="as-wert" id="asWert"><b>–</b><small></small></div>
        <div class="as-unten">
          <div class="as-chips" id="asChips"></div>
          <div class="as-knoepfe">
            <button class="as-neben" id="asRueck">↶ Zurück</button>
            <button class="as-ausloeser" id="asAus" aria-label="Auslösen"><span></span></button>
            <button class="as-neben" id="asWeiter">Fertig ›</button>
          </div>
          <div class="as-meldung" id="asMeldung"></div>
        </div>
      </div>`;
    video = wurzel.querySelector(".as-video");
    if (strom) { video.srcObject = strom; video.play().catch(() => {}); }
    wurzel.querySelector(".as-zu").onclick = () => zeige("vorbereitung");
    wurzel.querySelector("#asRueck").onclick = () => { if (!rueckgaengig()) zeige("vorbereitung"); };
    wurzel.querySelector("#asWeiter").onclick = weiter;
    const aus = wurzel.querySelector("#asAus");
    aus.addEventListener("click", ausloesen);
    chipsMalen();
    cancelAnimationFrame(schleife);
    const tick = () => { hudMalen(); schleife = requestAnimationFrame(tick); };
    schleife = requestAnimationFrame(tick);
  }

  /** Text und Knöpfe je Phase. */
  function phaseInfo() {
    const a = st.a, n = a.ecken.length;
    switch (st.phase) {
      case "kalib": return {
        krume: "NEIGUNG KALIBRIEREN · EINMAL JE GERÄT",
        titel: st.kalibTeil ? "Handy auf den Kopf – dasselbe Ziel" : "Ein kleines Ziel in ~2 m anzielen",
        text: st.kalibTeil ? "Handy um 180° um die Kamera drehen (Oberkante nach unten) und genau dieselbe Stelle anzielen."
          : "Z. B. eine Steckdose oder Schraube etwa auf Bauchhöhe. Fadenkreuz drauf, ruhig halten, auslösen.",
        weiter: "Abbrechen ›"
      };
      case "schluss": return {
        krume: "SCHRITT 1b · KONTROLLE",
        titel: "Noch einmal auf Ecke 1",
        text: "Dieselbe erste Ecke erneut anzielen – daraus rechnet die App das Weglaufen der Richtung heraus.",
        weiter: "Überspringen ›"
      };
      case "ecken": return {
        krume: `SCHRITT 1 · ECKEN · ${n} GESETZT`,
        titel: st.ziel === "decke" ? "Deckenecke anzielen" : "Bodenecke anzielen",
        text: n === 0 ? "Fadenkreuz genau in eine Raumecke am Boden. Ruhig halten, auslösen."
          : n < 3 ? "Weiter zur nächsten Ecke – immer in derselben Drehrichtung."
            : "Alle Ecken? Dann „Fertig“. Verdeckte Ecke: oben an der Decke anzielen.",
        weiter: n >= 3 ? "Fertig ›" : null
      };
      case "hoehe": return {
        krume: "SCHRITT 2 · RAUMHÖHE",
        titel: st.hoeheTeil ? "Jetzt oben: dieselbe Kante an der Decke" : "Eine freie Raumecke – unten am Boden",
        text: st.hoeheTeil ? "Fadenkreuz senkrecht über dem ersten Punkt an die Deckenkante."
          : "Wähle eine senkrechte Raumkante, die frei ist. Erst unten anzielen.",
        weiter: "Überspringen ›"
      };
      case "oeffnung": return {
        krume: `SCHRITT 3 · ÖFFNUNGEN · ${a.oeffnungen.length} ERFASST`,
        titel: st.oeffTeil ? `${artWort(st.oeffArt)}: obere rechte Ecke` : `${artWort(st.oeffArt)}: untere linke Ecke`,
        text: st.oeffTeil ? (st.oeffArt === "FENSTER" ? "Oben rechts in die Fensterlaibung." : "Oben rechts an den Sturz der Öffnung.")
          : (st.oeffArt === "FENSTER" ? "Unten links an die Fensterbank (Brüstung)." : "Unten links am Boden an die Zarge / Laibung."),
        weiter: "Weiter ›"
      };
      default: return {
        krume: `SCHRITT 4 · INSTALLATION · ${a.einbauten.length} ERFASST`,
        titel: `${Normmasse.ARTEN.get(st.einbauArt) || st.einbauArt} anzielen`,
        text: Normmasse.befestigung(st.einbauArt) === "DECKE" ? "Fadenkreuz auf die Mitte an der Decke." : "Fadenkreuz auf die Mitte der Dose / des Geräts.",
        weiter: "Prüfen ›"
      };
    }
  }

  function chipsMalen() {
    const c = wurzel.querySelector("#asChips");
    if (!c) return;
    const info = phaseInfo();
    wurzel.querySelector("#asKrume").textContent = info.krume;
    wurzel.querySelector("#asTitel").textContent = info.titel;
    wurzel.querySelector("#asAnleitung").textContent = info.text;
    const w = wurzel.querySelector("#asWeiter");
    w.textContent = info.weiter || "Fertig ›";
    w.disabled = !info.weiter;
    let html = "";
    if (st.phase === "ecken") {
      const H = A.raumhoehe(st.a, A.parameterStart(st.a).p);
      html = `<button class="as-chip ${st.ziel === "boden" ? "an" : ""}" data-ziel="boden">Boden</button>
        <button class="as-chip ${st.ziel === "decke" ? "an" : ""}" data-ziel="decke" ${H ? "" : `title="Erst Raumhöhe messen"`}>Decke${H ? "" : " (Höhe?)"}</button>`;
    } else if (st.phase === "oeffnung") {
      html = OEFF_ARTEN.map(([k, t]) => `<button class="as-chip ${st.oeffArt === k ? "an" : ""}" data-oeff="${k}" ${st.oeffTeil ? "disabled" : ""}>${t}</button>`).join("");
    } else if (st.phase === "einbau") {
      html = ZIEL_EINBAUTEN.map(k => `<button class="as-chip ${st.einbauArt === k ? "an" : ""}" data-ein="${k}">${esc(kurzName(k))}</button>`).join("");
    }
    c.innerHTML = html;
    c.querySelectorAll("[data-ziel]").forEach(b => b.onclick = () => {
      if (b.dataset.ziel === "decke" && !A.raumhoehe(st.a, A.parameterStart(st.a).p)) {
        // Für Deckenecken braucht es die Raumhöhe – kurz einschieben.
        st.vorHoehe = "ecken"; st.phase = "hoehe"; st.hoeheTeil = null; chipsMalen(); return;
      }
      st.ziel = b.dataset.ziel; chipsMalen();
    });
    c.querySelectorAll("[data-oeff]").forEach(b => b.onclick = () => { st.oeffArt = b.dataset.oeff; chipsMalen(); });
    c.querySelectorAll("[data-ein]").forEach(b => b.onclick = () => { st.einbauArt = b.dataset.ein; chipsMalen(); });
  }

  /** Was der aktuelle Strahl treffen würde – für Anzeige und Auslösen. */
  function treffer(v) {
    const a = st.a;
    const { p } = A.parameterStart(a);
    const H = A.raumhoehe(a, p);
    if (st.phase === "kalib" || st.phase === "schluss") {
      return { ok: true, wert: `${komma(Z.neigungGrad(v), 1)}°`, info: st.phase === "kalib" ? "Neigung" : "Kontrollschuss auf Ecke 1" };
    }
    if (st.phase === "ecken" || (st.phase === "hoehe" && !st.hoeheTeil)) {
      if (st.phase === "ecken" && st.ziel === "decke") {
        const q = H ? Z.deckenpunktM(v, p, H) : null;
        return q ? { ok: true, wert: meter(q.d), info: `Decke · ${Math.round(-Z.neigungGrad(v))}° nach oben` }
          : { ok: false, wert: "–", info: "nach oben an die Deckenecke zielen" };
      }
      const bereich = Z.zielBereich(v, p);
      if (bereich === "flach") return { ok: false, wert: "–", info: "zu flach – näher heran oder die Deckenecke nehmen" };
      if (bereich === "steil") return { ok: false, wert: "–", info: "zu steil – einen Schritt zurück" };
      const q = Z.bodenpunktM(v, p);
      if (!q) return { ok: false, wert: "–", info: "tiefer auf den Boden zielen" };
      const sig = A.unsicherheitLive(v, a);
      return { ok: true, wert: meter(q.d), info: `± ${Math.round(sig * 100)} cm bis zum Maßstab · ${Math.round(Z.neigungGrad(v))}° nach unten`, p: q };
    }
    if (st.phase === "hoehe") {
      const Hm = Z.kantenhoeheM(st.hoeheTeil.v, v, p, st.hoeheTeil.t, Date.now());
      return Hm && Hm > p.h ? { ok: true, wert: meter(Hm), info: "Raumhöhe (vor dem Maßstab)" } : { ok: false, wert: "–", info: "höher zielen – an die Deckenkante" };
    }
    const welt = A.vorschau(a).punkte;
    if (st.phase === "einbau" && Normmasse.befestigung(st.einbauArt) === "DECKE") {
      const q = H ? Z.deckenpunktM(v, p, H) : null;
      return q ? { ok: true, wert: "Decke", info: `${meter(q.d)} entfernt` } : { ok: false, wert: "–", info: H ? "an die Decke zielen" : "Raumhöhe fehlt – Schritt 2" };
    }
    const w = welt.length >= 3 ? Z.ersteWandM(v, p, welt) : null;
    if (!w) return { ok: false, wert: "–", info: "keine Wand im Fadenkreuz" };
    return { ok: true, wert: `${Math.round(w.hoehe * 100)} cm`, info: `über Boden · ${meter(w.abstand)} entlang der Wand` };
  }

  function hudMalen() {
    const wert = wurzel.querySelector("#asWert");
    if (!wert) return;
    const frisch = performance.now() - st.letzteLage < 800;
    const m = frisch ? blickJetzt(0, 300) : null;
    const aus = wurzel.querySelector("#asAus");
    const meld = wurzel.querySelector("#asMeldung");
    if (!m) {
      wert.firstChild.textContent = "–";
      wert.lastChild.textContent = "Kein Lagesensor – Handy bewegen oder „Maßband“ wählen";
      aus.disabled = true;
      wurzel.querySelector(".as-kreuz").className = "as-kreuz";
      meld.textContent = st.meldung;
      return;
    }
    const t = treffer(m.v);
    const ruhig = m.streuungGrad < 0.35;
    wert.firstChild.textContent = t.wert;
    wert.lastChild.textContent = t.info;
    aus.disabled = !t.ok;
    wurzel.querySelector(".as-kreuz").className = "as-kreuz " + (t.ok ? (ruhig ? "ruhig" : "wackelt") : "aus");
    meld.textContent = st.meldung || (t.ok && !ruhig ? "Ruhig halten …" : "");
    miniMalen(t.p);
  }

  function miniMalen(aktuell) {
    const svg = wurzel.querySelector("#asMini");
    if (!svg) return;
    const v = A.vorschau(st.a);
    const pts = v.punkte.map(p => [p[0], -p[1]]);
    const alle = pts.concat([[0, 0]], aktuell ? [[aktuell.x, -aktuell.y]] : []);
    const minX = Math.min(...alle.map(p => p[0])), maxX = Math.max(...alle.map(p => p[0]));
    const minY = Math.min(...alle.map(p => p[1])), maxY = Math.max(...alle.map(p => p[1]));
    const s = 80 / Math.max(maxX - minX, maxY - minY, 2);
    const q = p => [10 + (p[0] - minX) * s + (80 - (maxX - minX) * s) / 2, 10 + (p[1] - minY) * s + (80 - (maxY - minY) * s) / 2];
    const poly = pts.map(q).map(p => p.join(",")).join(" ");
    const zu = st.phase !== "ecken" && pts.length >= 3;
    let html = pts.length >= 2 ? `<${zu ? "polygon" : "polyline"} points="${poly}" class="as-mini-zug"/>` : "";
    html += pts.map(q).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" class="as-mini-ecke"/>`).join("");
    const o = q([0, 0]);
    html += `<circle cx="${o[0]}" cy="${o[1]}" r="3.2" class="as-mini-ich"/>`;
    if (aktuell && st.phase === "ecken") {
      const c = q([aktuell.x, -aktuell.y]);
      html += `<line x1="${o[0]}" y1="${o[1]}" x2="${c[0]}" y2="${c[1]}" class="as-mini-strahl"/><circle cx="${c[0]}" cy="${c[1]}" r="2.2" class="as-mini-ziel"/>`;
    }
    svg.innerHTML = html;
  }

  function ausloesen() {
    const m = blickJetzt();
    if (!m) { melde("Kein Lagesensor – Auslösen nicht möglich."); return; }
    const tr = treffer(m.v);
    if (!tr.ok) { melde(tr.info); return; }
    if (m.streuungGrad > 1.2) { melde("Zu unruhig – nochmal, ruhig halten."); return; }
    const v = m.v.map(x => Math.round(x * 1e6) / 1e6);
    const t = Date.now();
    const a = st.a;
    if (st.phase === "kalib") {
      if (!st.kalibTeil) { st.kalibTeil = { v }; brumm(); }
      else {
        const d = Z.neigungsfehlerGrad(st.kalibTeil.v, v);
        st.kalibTeil = null; brumm();
        if (Math.abs(d) > 3) melde("Unplausibel (> 3°) – bitte genauer dasselbe Ziel treffen.");
        else {
          geraetSpeichern({ neigungsfehlerGrad: Math.round(d * 100) / 100, datum: new Date().toISOString() });
          a.neigungsfehlerGrad = Math.round(d * 100) / 100;
          melde(`Neigung kalibriert: ${komma(d, 2)}°`);
          st.phase = st.vorKalib || "ecken"; st.vorKalib = null;
        }
      }
    } else if (st.phase === "ecken") {
      a.ecken.push({ v, t, ebene: st.ziel });
      brumm(); melde(`Ecke ${a.ecken.length} gesetzt`);
    } else if (st.phase === "schluss") {
      a.schluss = { v, t }; brumm(); melde("Kontrollschuss gespeichert");
      st.phase = a.hoehe || a.raumhoeheM ? "oeffnung" : "hoehe";
    } else if (st.phase === "hoehe") {
      if (!st.hoeheTeil) { st.hoeheTeil = { v, t }; brumm(); }
      else {
        a.hoehe = { vUnten: st.hoeheTeil.v, tUnten: st.hoeheTeil.t, vOben: v, tOben: t }; st.hoeheTeil = null; brumm();
        const Hm = A.raumhoeheAusKante(a, A.parameterStart(a).p);
        melde(Hm ? `Raumhöhe ≈ ${meter(Hm)}` : "Raumhöhe gespeichert");
        st.phase = st.vorHoehe || "oeffnung"; st.vorHoehe = null;
        if (st.phase === "ecken") st.ziel = "decke";
      }
    } else if (st.phase === "oeffnung") {
      if (!st.oeffTeil) { st.oeffTeil = { v, t }; brumm(); }
      else {
        a.oeffnungen.push({ id: neueId("oef"), art: st.oeffArt, a: st.oeffTeil.v, ta: st.oeffTeil.t, b: v, tb: t });
        st.oeffTeil = null; brumm(); melde(`${artWort(st.oeffArt)} erfasst`);
      }
    } else {
      const bef = Normmasse.befestigung(st.einbauArt) === "DECKE" ? "DECKE" : "WAND";
      a.einbauten.push({ id: neueId("ein"), art: st.einbauArt, befestigung: bef, v, t });
      brumm(); melde(`${Normmasse.ARTEN.get(st.einbauArt) || st.einbauArt} erfasst`);
    }
    chipsMalen();
  }

  /** Letzten Schritt zurücknehmen; false, wenn nichts mehr da ist. */
  function rueckgaengig() {
    const a = st.a;
    if (!a) return false;
    if (st.phase === "kalib") {
      if (st.kalibTeil) st.kalibTeil = null;
      else { st.phase = st.vorKalib || "ecken"; st.vorKalib = null; }
    } else if (st.phase === "ecken") {
      if (!a.ecken.length) return false;
      a.ecken.pop(); melde("Letzte Ecke entfernt");
    } else if (st.phase === "schluss") {
      st.phase = "ecken";
    } else if (st.phase === "hoehe") {
      if (st.hoeheTeil) st.hoeheTeil = null;
      else { st.phase = st.vorHoehe || (a.schluss ? "schluss" : "ecken"); st.vorHoehe = null; if (st.phase === "schluss") a.schluss = null; }
    } else if (st.phase === "oeffnung") {
      if (st.oeffTeil) st.oeffTeil = null;
      else if (a.oeffnungen.length) { a.oeffnungen.pop(); melde("Letzte Öffnung entfernt"); }
      else { st.phase = "hoehe"; st.hoeheTeil = null; }
    } else {
      if (a.einbauten.length) { a.einbauten.pop(); melde("Letzter Einbau entfernt"); }
      else st.phase = "oeffnung";
    }
    chipsMalen();
    return true;
  }

  function weiter() {
    if (st.phase === "kalib") { st.kalibTeil = null; st.phase = st.vorKalib || "ecken"; st.vorKalib = null; }
    else if (st.phase === "ecken") {
      if (st.a.ecken.length < 3) return;
      st.phase = st.a.ecken.length >= 4 && !st.a.schluss ? "schluss" : (st.a.hoehe || st.a.raumhoeheM ? "oeffnung" : "hoehe");
      st.hoeheTeil = null;
    } else if (st.phase === "schluss") { st.phase = st.a.hoehe || st.a.raumhoeheM ? "oeffnung" : "hoehe"; }
    else if (st.phase === "hoehe") { st.hoeheTeil = null; st.phase = st.vorHoehe || "oeffnung"; st.vorHoehe = null; }
    else if (st.phase === "oeffnung") { st.oeffTeil = null; st.phase = "einbau"; }
    else { zeige("pruefen"); return; }
    chipsMalen();
  }

  let meldT = 0;
  function melde(t) {
    st.meldung = t;
    clearTimeout(meldT);
    meldT = setTimeout(() => { st.meldung = ""; }, 1800);
  }

  // ============================================================ Prüfen

  function pruefen() {
    lageAus(); kameraAus();
    const a = st.a;
    const r = A.rekonstruiere(a, { aufbauM: raum.aufbauM });
    wurzel.className = "as-wurzel as-hell";
    if (!r) {
      wurzel.innerHTML = `<div class="as-blatt"><div class="as-kopfzeile"><button class="as-zu">‹</button><div><h2>Zu wenige Ecken</h2></div></div>
        <p class="as-text">Mindestens drei Ecken müssen getroffen sein.</p><button class="as-haupt" id="asNochmal">Weiter zielen</button></div>`;
      wurzel.querySelector(".as-zu").onclick = wurzel.querySelector("#asNochmal").onclick = () => { st.phase = "ecken"; zeige("zielen"); lageAn(); kameraAn(); };
      return;
    }
    const umfang = r.waende.reduce((s, w) => s + w.laenge, 0);
    wurzel.innerHTML = `
      <div class="as-blatt">
        <div class="as-kopfzeile"><button class="as-zu" aria-label="Zurück">‹</button>
          <div><span class="as-krume">PRÜFEN · MASSSTAB</span><h2>${esc(raum.name || "Raum")}</h2></div></div>
        <div class="as-plan">${planSvg(r.punkte, r.oeffnungen, r.einbauten)}</div>
        <div class="as-zahlen">
          <div><b>${komma(r.flaecheM2, 1)} m²</b><span>Fläche</span></div>
          <div><b>${komma(umfang, 2)} m</b><span>Umfang</span></div>
          <div><b>${r.hoeheM ? komma(r.hoeheM, 2) + " m" : "–"}</b><span>Raumhöhe</span></div>
        </div>
        <div class="as-massstab ${r.klasse === "AUFMASS" ? "ok" : "offen"}">
          <span class="as-klasse ${r.klasse.toLowerCase()}">${r.klasse === "AUFMASS" ? "AUFMASS" : r.klasse === "PLAN" ? "PLAN" : "SKIZZE"}</span>
          ${r.klasse === "AUFMASS" ? `<b>Zentimetergenau.</b> Jede Wand ± ${Math.max(1, Math.round(Math.max(...r.waende.map(w => w.sigmaM)) * 100))} cm oder besser.`
            : r.kalibriert ? `<b>Maßstab gesetzt</b>, aber noch nicht überall zentimetergenau.`
              : `<b>Form stimmt, Maßstab fehlt.</b> Ein bekanntes Maß genügt: eine Wand mit dem Bandmaß, die Raumhöhe (Laser nach oben) oder die Höhe einer Tür (Norm-Innentür lichte Höhe ≈ 1,97 m).`}
          ${r.naechstesMass ? `<br><span class="as-tipp">→ ${esc(r.naechstesMass.text)}</span>` : ""}
          <br><small>Ausgeglichen: Kamerahöhe ${komma(r.kamerahoeheM, 2)} m · Handy ${Math.round(r.armM * 100)} cm vor der Drehachse · Höhen ± ${Math.max(1, Math.round(r.sigmaHoeheM * 100))} cm${a.neigungsfehlerGrad != null ? ` · Neigung kalibriert` : ""}</small>
        </div>
        <h3 class="as-h3">Wände <small>Bandmaß eintragen, wo du nachmisst</small></h3>
        <div class="as-zeilen">${r.waende.map((w, i) => `
          <div class="as-zeile">
            <span class="as-nr">${i + 1}</span>
            <span class="as-mass"><b>${komma(w.laenge, 2)} m</b>
              <small class="${w.quelle}">${w.quelle === "band" ? "Bandmaß" : `gezielt ± ${Math.max(1, Math.round(w.sigmaM * 100))} cm`}</small></span>
            <input class="as-eingabe" data-band="${i}" inputmode="decimal" placeholder="Bandmaß" value="${a.bandmasse[i] != null ? komma(a.bandmasse[i], 2) : ""}">
          </div>`).join("")}
          <div class="as-zeile">
            <span class="as-nr">H</span>
            <span class="as-mass"><b>${r.hoeheM ? komma(r.hoeheM, 2) + " m" : "–"}</b><small>Raumhöhe${a.hoehe ? " · gezielt" : ""}</small></span>
            <input class="as-eingabe" id="asRaumH" inputmode="decimal" placeholder="Laser" value="${a.raumhoeheM ? komma(a.raumhoeheM, 2) : ""}">
          </div>
        </div>
        ${r.oeffnungen.length ? `<h3 class="as-h3">Öffnungen <small>Höhe bekannt? Dann eintragen – sie dient als Maßstab</small></h3>
        <div class="as-zeilen">${r.oeffnungen.map(o => {
          const roh = a.oeffnungen.find(x => x.id === o.id) || {};
          return `<div class="as-zeile">
            <span class="as-nr">${artWort(o.art).slice(0, 1)}</span>
            <span class="as-mass"><b>${artWort(o.art)} · Wand ${o.wandIndex + 1}</b>
              <small>${cm(o.breiteM)} × ${cm(o.hoeheM)}${o.bruestungM > 0 ? ` · Brüstung ${cm(o.bruestungM)}` : ""} · ab ${komma(o.abstandM, 2)} m</small></span>
            <input class="as-eingabe" data-oeffh="${esc(o.id)}" inputmode="decimal" placeholder="${o.art === "TUER" ? "z. B. 1,97" : "Höhe"}" value="${roh.hoeheBekanntM ? komma(roh.hoeheBekanntM, 2) : ""}">
            <button class="as-weg" data-oeffweg="${esc(o.id)}" aria-label="Entfernen">✕</button>
          </div>`; }).join("")}</div>` : ""}
        ${r.einbauten.length ? `<h3 class="as-h3">Installation</h3>
        <div class="as-zeilen">${r.einbauten.map(e => `<div class="as-zeile">
            <span class="as-nr">•</span>
            <span class="as-mass"><b>${esc(Normmasse.ARTEN.get(e.art) || e.art)}</b>
              <small>${e.befestigung === "DECKE" ? "Decke" : `Wand ${e.wandIndex + 1} · ${e.hoeheM != null ? cm(e.hoeheM) + " hoch" : "Höhe nach Norm"}`}</small></span>
            <button class="as-weg" data-einweg="${esc(e.id)}" aria-label="Entfernen">✕</button>
          </div>`).join("")}</div>` : ""}
        <label class="as-schalter"><input type="checkbox" id="asRecht2" ${a.rechtwinklig ? "checked" : ""}> <span>Rechtwinklig glätten</span></label>
        ${r.hinweise.length ? `<ul class="as-hinweise">${r.hinweise.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        <div class="as-knopfreihe">
          <button class="as-zweit" id="asMehr">‹ Weiter zielen</button>
          <button class="as-haupt" id="asOk">Übernehmen ✓</button>
        </div>
      </div>`;
    wurzel.querySelector(".as-zu").onclick = () => { zeige("zielen"); lageAn(); kameraAn(); };
    wurzel.querySelector("#asMehr").onclick = () => { zeige("zielen"); lageAn(); kameraAn(); };
    wurzel.querySelectorAll("[data-band]").forEach(inp => inp.onchange = () => {
      const m = zahl(inp.value), i = Number(inp.dataset.band);
      if (m > 0) a.bandmasse[i] = m; else delete a.bandmasse[i];
      pruefen();
    });
    wurzel.querySelector("#asRaumH").onchange = e => { const m = zahl(e.target.value); a.raumhoeheM = m > 0 ? m : null; pruefen(); };
    wurzel.querySelectorAll("[data-oeffh]").forEach(inp => inp.onchange = () => {
      const o = a.oeffnungen.find(x => x.id === inp.dataset.oeffh);
      if (o) { const m = zahl(inp.value); o.hoeheBekanntM = m > 0 ? m : null; }
      pruefen();
    });
    wurzel.querySelectorAll("[data-oeffweg]").forEach(b => b.onclick = () => { a.oeffnungen = a.oeffnungen.filter(x => x.id !== b.dataset.oeffweg); pruefen(); });
    wurzel.querySelectorAll("[data-einweg]").forEach(b => b.onclick = () => { a.einbauten = a.einbauten.filter(x => x.id !== b.dataset.einweg); pruefen(); });
    wurzel.querySelector("#asRecht2").onchange = e => { a.rechtwinklig = e.target.checked; pruefen(); };
    wurzel.querySelector("#asOk").onclick = () => {
      const r2 = A.rekonstruiere(a, { aufbauM: raum.aufbauM });
      beenden({
        methode: "zielen", umriss: r2.umriss, hoeheM: r2.hoeheM,
        oeffnungen: r2.oeffnungen,
        einbauten: r2.einbauten.map(e => ({ ...e, hoeheM: e.hoeheM ?? (e.befestigung === "DECKE" ? r2.hoeheM : Normmasse.hoehe(e.art)) })),
        waende: r2.waende, kamerahoeheM: r2.kamerahoeheM, kalibriert: r2.kalibriert, klasse: r2.klasse,
        aufnahme: JSON.parse(JSON.stringify(a)), hinweise: r2.hinweise
      });
    };
  }

  // ============================================================ Maßband

  function bandSeite() {
    wurzel.className = "as-wurzel as-hell";
    const b = st.band;
    const erg = bandRechnen(b);
    wurzel.innerHTML = `
      <div class="as-blatt">
        <div class="as-kopfzeile"><button class="as-zu" aria-label="Zurück">‹</button>
          <div><span class="as-krume">MASSBAND · WAND FÜR WAND</span><h2>${esc(raum.name || "Raum")}</h2></div></div>
        <p class="as-text">An einer Ecke beginnen, im Uhrzeigersinn: Länge der Wand messen, dann angeben, wohin es an der nächsten Ecke weitergeht. Die letzte Länge darf leer bleiben – sie ergibt sich.</p>
        <div class="as-plan">${erg ? planSvg(erg.punkte, [], []) : `<div class="as-leer">Skizze erscheint mit den ersten Maßen.</div>`}</div>
        <div class="as-zeilen" id="asBand">${b.waende.map((w, i) => `
          <div class="as-zeile">
            <span class="as-nr">${i + 1}</span>
            <input class="as-eingabe breit" data-l="${i}" inputmode="decimal" placeholder="${erg && erg.berechnet === i ? komma(erg.waende[i].laenge, 2) + " (berechnet)" : "Länge m"}" value="${w.laenge > 0 ? komma(w.laenge, 2) : ""}">
            <span class="as-dreh">
              <button class="${w.drehung === 90 ? "an" : ""}" data-d="${i}" data-w="90" title="rechts abbiegen">↱</button>
              <button class="${w.drehung === -90 ? "an" : ""}" data-d="${i}" data-w="-90" title="links abbiegen">↰</button>
              ${Math.abs(w.drehung) !== 90
                ? `<input class="as-eingabe winkel" data-winkel="${i}" inputmode="decimal" value="${komma(w.drehung, 0)}" aria-label="Winkel in Grad, + rechts, − links">`
                : `<button data-d="${i}" data-w="frei" title="anderer Winkel (z. B. Erker)">∠</button>`}
            </span>
            <button class="as-weg" data-weg="${i}" ${b.waende.length <= 3 ? "disabled" : ""} aria-label="Wand entfernen">✕</button>
          </div>`).join("")}</div>
        <button class="as-zweit klein" id="asPlus">+ Wand</button>
        <div class="as-massstab ${erg && erg.restluecke < 0.02 ? "ok" : "offen"}">${bandText(erg)}</div>
        <div class="as-feld"><label for="asBandH">Raumhöhe (m)</label><input id="asBandH" inputmode="decimal" value="${komma(b.hoeheM, 2)}"></div>
        <button class="as-haupt" id="asOk" ${erg && erg.punkte.length >= 3 ? "" : "disabled"}>Übernehmen ✓</button>
      </div>`;
    wurzel.querySelector(".as-zu").onclick = () => zeige("start");
    wurzel.querySelectorAll("[data-l]").forEach(inp => inp.onchange = () => { b.waende[Number(inp.dataset.l)].laenge = zahl(inp.value) || null; b.ausgleich = false; bandSeite(); });
    wurzel.querySelectorAll("[data-d]").forEach(btn => btn.onclick = () => {
      const i = Number(btn.dataset.d);
      b.waende[i].drehung = btn.dataset.w === "frei" ? 45 : Number(btn.dataset.w);   // 45° = typischer Erker
      bandSeite();
      if (btn.dataset.w === "frei") wurzel.querySelector(`[data-winkel="${i}"]`)?.select();
    });
    wurzel.querySelectorAll("[data-winkel]").forEach(inp => inp.onchange = () => {
      const d = zahl(inp.value);
      if (Number.isFinite(d) && Math.abs(d) < 180) b.waende[Number(inp.dataset.winkel)].drehung = d;
      bandSeite();
    });
    wurzel.querySelectorAll("[data-weg]").forEach(btn => btn.onclick = () => { b.waende.splice(Number(btn.dataset.weg), 1); bandSeite(); });
    wurzel.querySelector("#asPlus").onclick = () => { b.waende.push({ laenge: null, drehung: 90 }); bandSeite(); };
    const ag = wurzel.querySelector("#asAusgl");
    if (ag) ag.onclick = () => { b.ausgleich = true; bandSeite(); };
    wurzel.querySelector("#asBandH").onchange = e => { const m = zahl(e.target.value); if (m > 0) b.hoeheM = m; };
    wurzel.querySelector("#asOk").onclick = () => {
      const e = bandRechnen(b);
      if (!e) return;
      beenden({
        methode: "band", umriss: G.umrissSchreiben(e.punkte), hoeheM: b.hoeheM,
        oeffnungen: [], einbauten: [],
        waende: e.waende.map((w, i) => ({ laenge: w.laenge, quelle: i === e.berechnet || b.ausgleich ? "getippt" : "band", sigmaM: i === e.berechnet ? null : 0.005 })),
        aufnahme: null
      });
    };
  }

  function bandText(erg) {
    if (!erg) return "Mindestens drei Wände mit Länge eintragen.";
    if (erg.berechnet != null)
      return erg.restluecke < 0.02 ? `<b>✓ Schließt.</b> Wand ${erg.berechnet + 1} ergibt sich zu ${komma(erg.waende[erg.berechnet].laenge, 2)} m.`
        : `<b>Passt nicht ganz:</b> ${Math.round(erg.restluecke * 100)} cm Lücke bleiben – stimmen die Abbiegungen?`;
    if (erg.restluecke < 0.02) return `<b>✓ Schließt</b> (Restlücke ${Math.round(erg.restluecke * 1000)} mm). Fläche ${komma(G.flaechePunkte(erg.punkte), 2)} m².`;
    return `<b>Restlücke ${Math.round(erg.restluecke * 100)} cm</b> – irgendwo steckt ein Messfehler. Nachmessen oder <button class="as-link" id="asAusgl">auf alle Wände verteilen</button>.`;
  }

  // =========================================================== Rechteck

  function rechteckSeite() {
    wurzel.className = "as-wurzel as-hell";
    const q = st.rechteck;
    wurzel.innerHTML = `
      <div class="as-blatt">
        <div class="as-kopfzeile"><button class="as-zu" aria-label="Zurück">‹</button>
          <div><span class="as-krume">RECHTECK</span><h2>${esc(raum.name || "Raum")}</h2></div></div>
        <div class="as-feld"><label for="asRB">Breite (m)</label><input id="asRB" inputmode="decimal" value="${komma(q.b, 2)}"></div>
        <div class="as-feld"><label for="asRT">Tiefe (m)</label><input id="asRT" inputmode="decimal" value="${komma(q.t, 2)}"></div>
        <div class="as-feld"><label for="asRH">Raumhöhe (m)</label><input id="asRH" inputmode="decimal" value="${komma(q.h, 2)}"></div>
        <button class="as-haupt" id="asOk">Übernehmen ✓</button>
      </div>`;
    wurzel.querySelector(".as-zu").onclick = () => zeige("start");
    wurzel.querySelector("#asOk").onclick = () => {
      const bb = zahl(wurzel.querySelector("#asRB").value), tt = zahl(wurzel.querySelector("#asRT").value), hh = zahl(wurzel.querySelector("#asRH").value);
      if (!(bb > 0) || !(tt > 0)) { alert("Breite und Tiefe angeben."); return; }
      beenden({
        methode: "rechteck", umriss: "", breiteM: bb, tiefeM: tt, hoeheM: hh > 0 ? hh : null,
        oeffnungen: [], einbauten: [], aufnahme: null,
        waende: [bb, tt, bb, tt].map(laenge => ({ laenge, quelle: "band", sigmaM: 0.005 }))
      });
    };
  }

  // ========================================================= Steuerung

  function zeige(schritt) {
    if (schritt !== "zielen") { cancelAnimationFrame(schleife); }
    if (schritt === "start" || schritt === "band" || schritt === "rechteck") { lageAus(); kameraAus(); }
    st.schritt = schritt;
    if (schritt === "start") startSeite();
    else if (schritt === "vorbereitung") vorbereitung();
    else if (schritt === "zielen") { if (!st.a) { zeige("vorbereitung"); return; } zielen(); }
    else if (schritt === "pruefen") pruefen();
    else if (schritt === "band") bandSeite();
    else if (schritt === "rechteck") rechteckSeite();
  }

  zeige(opts.start === "band" ? "band" : opts.start === "rechteck" ? "rechteck" : opts.start === "zielen" ? "vorbereitung" : "start");
  return { beenden: () => beenden(null), zustand: st };
}

// ======================================================= Maßband-Rechnung

/**
 * Wandliste mit Lücken → Umriss. Fehlt genau eine Länge, ergibt sie sich aus
 * dem Schluss (Ausgleich mit allen anderen fest). Sonst Polygonzug mit
 * Restlücke; `ausgleich` verteilt sie auf alle Wände.
 */
export function bandRechnen(b) {
  const w = b.waende.map(x => ({ laenge: Number(x.laenge) > 0 ? Number(x.laenge) : null, drehung: Number(x.drehung) || 0 }));
  if (w.length < 3) return null;
  const leer = w.map((x, i) => (x.laenge == null ? i : -1)).filter(i => i >= 0);
  if (leer.length > 1) return null;
  let waende, berechnet = null, restluecke;
  if (leer.length === 1) {
    berechnet = leer[0];
    const start = w.map(x => ({ ...x, laenge: x.laenge ?? 1 }));
    const fest = start.map((_, i) => i).filter(i => i !== berechnet);
    const aus = G.ausgleichen(start, fest);
    waende = aus.waende; restluecke = aus.restlueckeNachher;
  } else if (b.ausgleich) {
    const aus = G.ausgleichen(w, []);
    waende = aus.waende; restluecke = aus.restlueckeNachher;
  } else {
    waende = w;
    restluecke = G.zug(w).restluecke;
  }
  let x = 0, y = 0, r = 0;
  const p = [[0, 0]];
  for (const q of waende.slice(0, -1)) {
    x += q.laenge * Math.cos(r * Math.PI / 180); y += q.laenge * Math.sin(r * Math.PI / 180);
    p.push([x, y]); r += q.drehung;
  }
  return { punkte: G.normieren(p), waende, restluecke, berechnet };
}

function startWaende(raum) {
  const pts = G.umrissLesen(raum && raum.umriss);
  if (pts) return G.waende(pts).map(w => ({ laenge: w.laenge, drehung: w.drehung }));
  return [{ laenge: null, drehung: 90 }, { laenge: null, drehung: 90 }, { laenge: null, drehung: 90 }, { laenge: null, drehung: 90 }];
}

// ============================================================ Darstellung

function planSvg(punkte, oeffnungen, einbauten) {
  const maxX = Math.max(...punkte.map(p => p[0]), 0.5), maxY = Math.max(...punkte.map(p => p[1]), 0.5);
  const s = Math.min(300 / maxX, 200 / maxY);
  const P = p => [24 + p[0] * s, 24 + p[1] * s];
  const poly = punkte.map(P).map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
  const n = punkte.length;
  const mx = punkte.reduce((a, p) => a + p[0], 0) / n, my = punkte.reduce((a, p) => a + p[1], 0) / n;
  const nummern = punkte.map((a, i) => {
    const b = punkte[(i + 1) % n];
    let cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const dx = cx - mx, dy = cy - my, l = Math.hypot(dx, dy) || 1;
    const q = P([cx + dx / l * (12 / s), cy + dy / l * (12 / s)]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Nummer außen, Länge innen – sonst überdecken sie sich an kurzen Wänden.
    const innen = P([cx - dx / l * (13 / s), cy - dy / l * (13 / s)]);
    return `<g><circle cx="${q[0]}" cy="${q[1]}" r="8.5" class="as-p-kreis"/><text x="${q[0]}" y="${q[1]}" class="as-p-nr">${i + 1}</text>`
      + `<text x="${innen[0]}" y="${innen[1]}" class="as-p-mass">${komma(len, 2)}</text></g>`;
  }).join("");
  const oe = (oeffnungen || []).map(o => {
    const a = punkte[o.wandIndex], b = punkte[(o.wandIndex + 1) % n];
    if (!a || !b) return "";
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t0 = o.abstandM / len, t1 = (o.abstandM + o.breiteM) / len;
    const p0 = P([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]), p1 = P([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    return `<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" class="as-p-oeff ${o.art === "FENSTER" ? "fenster" : ""}"/>`;
  }).join("");
  const ei = (einbauten || []).map(e => {
    let q;
    if (e.befestigung === "DECKE") q = P([e.relX * maxX, e.relY * maxY]);
    else {
      const a = punkte[e.wandIndex], b = punkte[(e.wandIndex + 1) % n];
      if (!a || !b) return "";
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = e.abstandM / len;
      q = P([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return `<circle cx="${q[0]}" cy="${q[1]}" r="4" class="as-p-ein"/>`;
  }).join("");
  const w = 48 + maxX * s, h = 48 + maxY * s;
  return `<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" class="as-p"><polygon points="${poly}" class="as-p-raum"/>${oe}${ei}${nummern}</svg>`;
}

function skizzeHaltung() {
  return `<svg viewBox="0 0 220 120" class="as-skizze">
    <line x1="10" y1="108" x2="210" y2="108" class="sk-boden"/>
    <circle cx="48" cy="22" r="9" class="sk-person"/><path d="M48 31 V76 M48 40 L64 50 M48 76 L38 108 M48 76 L58 108" class="sk-person"/>
    <rect x="63" y="42" width="5" height="12" rx="1" class="sk-handy"/>
    <line x1="66" y1="48" x2="190" y2="108" class="sk-strahl"/>
    <line x1="30" y1="48" x2="30" y2="108" class="sk-mass"/><text x="24" y="82" class="sk-text" text-anchor="end">h</text>
    <text x="150" y="98" class="sk-text">Ecke</text><path d="M190 108 l-6 -3 v6 z" class="sk-pfeil"/>
  </svg>`;
}

let stilDa = false;
function stilEinhaengen() {
  if (stilDa || document.getElementById("as-stil")) { stilDa = true; return; }
  stilDa = true;
  const s = document.createElement("style");
  s.id = "as-stil";
  s.textContent = `
.as-wurzel { position: fixed; inset: 0; z-index: 9000; font-family: inherit; -webkit-tap-highlight-color: transparent;
  --as-akz: var(--ziegel, #A8432A); --as-tief: var(--ziegel-tief, #7C3220); --as-ok: #2f7d3b; --as-warn: #E8B44A; }
.as-hell { background: var(--bg, #F4F1EC); color: var(--ink, #222); overflow-y: auto; -webkit-overflow-scrolling: touch; }
.as-dunkel { background: #111; color: #fff; overflow: hidden; }
.as-blatt { max-width: 560px; margin: 0 auto; padding: calc(14px + env(safe-area-inset-top, 0px)) 16px calc(28px + env(safe-area-inset-bottom, 0px)); }
.as-kopfzeile { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.as-kopfzeile h2 { margin: 2px 0 0; font-size: 22px; line-height: 1.15; }
.as-krume { font-size: 11px; letter-spacing: .14em; opacity: .7; font-weight: 600; }
.as-zu { width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font-size: 20px; cursor: pointer; }
.as-text { font-size: 15px; line-height: 1.45; margin: 4px 0 14px; opacity: .85; }
.as-fein { font-size: 12.5px; opacity: .65; margin-top: 10px; }
.as-karte-wahl { display: flex; gap: 14px; width: 100%; text-align: left; padding: 16px 14px; margin: 0 0 10px; border-radius: 10px;
  border: 1.5px solid var(--line, #d9cfc2); background: var(--card, #fff); color: inherit; cursor: pointer; font: inherit; }
.as-karte-wahl:active { transform: translateY(1px); }
.as-karte-wahl b { display: block; font-size: 17px; margin-bottom: 3px; }
.as-karte-wahl small { display: block; font-size: 13.5px; line-height: 1.4; opacity: .75; }
.as-sym { flex: 0 0 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--as-akz); color: #fff; font-size: 22px; }
.as-bild { background: var(--card, #fff); border-radius: 10px; padding: 8px; margin-bottom: 10px; border: 1px solid var(--line, #ddd); }
.as-skizze { width: 100%; height: auto; display: block; }
.sk-boden { stroke: currentColor; stroke-width: 2; opacity: .5; } .sk-person { fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
.sk-handy { fill: var(--as-akz); } .sk-strahl { stroke: var(--as-akz); stroke-width: 1.6; stroke-dasharray: 4 3; }
.sk-mass { stroke: currentColor; stroke-width: 1; opacity: .6; } .sk-text { font-size: 11px; fill: currentColor; } .sk-pfeil { fill: var(--as-akz); }
.as-liste { padding-left: 20px; margin: 6px 0 14px; font-size: 14.5px; line-height: 1.5; } .as-liste li { margin-bottom: 6px; }
.as-feld { margin: 12px 0; } .as-feld label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
.as-feld input, .as-eingabe { font: inherit; font-size: 17px; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--line, #cfc5b8);
  background: var(--card, #fff); color: inherit; width: 100%; box-sizing: border-box; min-height: 46px; }
.as-feld small { display: block; font-size: 12.5px; opacity: .7; margin-top: 5px; }
.as-schalter { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; font-size: 14.5px; line-height: 1.4; cursor: pointer; }
.as-schalter input { width: 22px; height: 22px; flex: 0 0 22px; accent-color: var(--as-akz); margin: 0; }
.as-haupt { display: block; width: 100%; min-height: 54px; margin-top: 14px; border: 0; border-radius: 10px; background: var(--as-akz); color: #fff;
  font: inherit; font-size: 17px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 0 var(--as-tief); }
.as-haupt:disabled { opacity: .45; box-shadow: none; }
.as-zweit { min-height: 50px; padding: 0 16px; border-radius: 10px; border: 1.5px solid var(--line, #cfc5b8); background: var(--card, #fff); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.as-zweit.klein { min-height: 40px; margin: 4px 0 10px; }
.as-knopfreihe { display: flex; gap: 10px; align-items: stretch; } .as-knopfreihe .as-haupt { flex: 1; margin-top: 0; } .as-knopfreihe { margin-top: 16px; }
.as-link { border: 0; background: none; color: var(--as-akz); font: inherit; font-weight: 700; text-decoration: underline; padding: 0; cursor: pointer; }
.as-plan { background: var(--card, #fff); border: 1px solid var(--line, #ddd); border-radius: 10px; padding: 6px; margin-bottom: 12px; }
.as-p { width: 100%; height: auto; max-height: 300px; display: block; }
.as-p-raum { fill: rgba(168,67,42,.12); fill: color-mix(in srgb, var(--as-akz) 12%, transparent); stroke: currentColor; stroke-width: 3; stroke-linejoin: round; }
.as-p-oeff { stroke: var(--card, #fff); stroke-width: 5; } .as-p-oeff.fenster { stroke: #6aa9d8; }
.as-p-ein { fill: var(--as-akz); stroke: #fff; stroke-width: 1.5; }
.as-p-kreis { fill: var(--card, #fff); stroke: var(--as-akz); stroke-width: 1.5; }
.as-p-nr { font-size: 10px; font-weight: 700; text-anchor: middle; dominant-baseline: central; fill: var(--as-akz); }
.as-p-mass { font-size: 10.5px; text-anchor: middle; dominant-baseline: central; fill: currentColor; opacity: .75; }
.as-leer { padding: 40px 10px; text-align: center; opacity: .6; font-size: 14px; }
.as-zahlen { display: flex; gap: 8px; margin-bottom: 10px; } .as-zahlen div { flex: 1; background: var(--card, #fff); border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 8px 10px; }
.as-zahlen b { display: block; font-size: 18px; } .as-zahlen span { font-size: 11.5px; opacity: .7; }
.as-massstab { border-radius: 10px; padding: 11px 13px; font-size: 14px; line-height: 1.45; margin: 10px 0; }
.as-massstab.ok { background: #d9ecd5; color: #22461f; } .as-massstab.offen { background: #f6e3bd; color: #5d420d; }
.as-massstab small { opacity: .8; } .as-tipp { font-weight: 600; }
.as-klasse { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .1em; padding: 3px 7px; border-radius: 4px; margin-right: 6px; color: #fff; }
.as-klasse.aufmass { background: #2f7d3b; } .as-klasse.plan { background: #b07a12; } .as-klasse.skizze { background: #8a5a44; }
.as-segment { display: flex; gap: 3px; background: rgba(127,127,127,.25); border-radius: 9px; padding: 3px; margin: 6px 0 4px; }
.as-segment button { flex: 1; min-height: 44px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.as-segment button.an { background: var(--card, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
.as-kalib { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; justify-content: space-between; font-size: 13.5px; padding: 9px 11px; border-radius: 8px; background: rgba(232,180,74,.18); margin: 8px 0; }
.as-kalib.ok { background: rgba(47,125,59,.13); }
.as-h3 { font-size: 15px; margin: 16px 0 6px; } .as-h3 small { font-weight: 400; opacity: .65; font-size: 12.5px; margin-left: 6px; }
.as-zeilen { display: flex; flex-direction: column; gap: 6px; }
.as-zeile { display: flex; align-items: center; gap: 8px; background: var(--card, #fff); border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 6px 8px; }
.as-nr { flex: 0 0 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 13px; background: var(--chip, #efe6d8); }
.as-mass { flex: 1; min-width: 0; } .as-mass b { display: block; font-size: 15px; } .as-mass small { font-size: 12px; opacity: .75; }
.as-mass small.band { color: var(--as-ok); opacity: 1; font-weight: 600; }
.as-zeile .as-eingabe { flex: 0 0 104px; width: 104px; min-height: 42px; font-size: 16px; padding: 6px 9px; }
.as-zeile .as-eingabe.breit { flex: 1; width: auto; }
.as-weg { flex: 0 0 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; color: inherit; opacity: .6; font-size: 16px; cursor: pointer; }
.as-dreh { display: flex; gap: 3px; } .as-dreh button { min-width: 42px; height: 42px; border-radius: 8px; border: 1.5px solid var(--line, #cfc5b8); background: var(--card, #fff); color: inherit; font-size: 17px; cursor: pointer; padding: 0 4px; }
.as-dreh .as-eingabe.winkel { flex: 0 0 64px; width: 64px; min-height: 42px; text-align: center; padding: 4px; }
.as-dreh button.an { background: var(--as-akz); border-color: var(--as-akz); color: #fff; }
.as-hinweise { margin: 10px 0; padding-left: 18px; font-size: 13.5px; line-height: 1.45; opacity: .85; }
/* ---- Kamera ---- */
.as-kamera { position: absolute; inset: 0; }
.as-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #1b1b1b; }
.as-kreuz { position: absolute; left: 50%; top: 50%; width: 76px; height: 76px; margin: -38px 0 0 -38px; pointer-events: none; }
.as-kreuz i { position: absolute; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.55); }
.as-kreuz i:first-child { left: 37px; top: 0; width: 2px; height: 76px; } .as-kreuz i:nth-child(2) { top: 37px; left: 0; height: 2px; width: 76px; }
.as-kreuz b { position: absolute; inset: 14px; border-radius: 50%; border: 3px solid rgba(255,255,255,.5); }
.as-kreuz.ruhig b { border-color: #6fd36f; } .as-kreuz.wackelt b { border-color: var(--as-warn); } .as-kreuz.aus b { border-color: #e2584a; }
.as-oben { position: absolute; left: 0; right: 0; top: 0; display: flex; gap: 10px; align-items: flex-start;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 18px; background: linear-gradient(rgba(0,0,0,.72), rgba(0,0,0,0)); }
.as-oben .as-zu { border-color: rgba(255,255,255,.45); background: rgba(0,0,0,.35); }
.as-titel { flex: 1; min-width: 0; } .as-titel b { display: block; font-size: 18px; line-height: 1.2; margin-top: 2px; }
.as-mini { width: 96px; height: 96px; flex: 0 0 96px; background: rgba(0,0,0,.5); border-radius: 10px; border: 1px solid rgba(255,255,255,.25); }
.as-mini-zug { fill: rgba(255,255,255,.12); stroke: #fff; stroke-width: 1.6; stroke-linejoin: round; }
.as-mini-ecke { fill: var(--as-warn); } .as-mini-ich { fill: #6fd36f; } .as-mini-strahl { stroke: rgba(255,255,255,.6); stroke-width: 1; stroke-dasharray: 2 2; } .as-mini-ziel { fill: #fff; }
.as-anleitung { position: absolute; left: 16px; right: 16px; top: calc(50% + 52px); text-align: center; font-size: 15px; line-height: 1.4;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(0,0,0,.8); }
.as-wert { position: absolute; left: 50%; top: calc(50% - 110px); transform: translateX(-50%); text-align: center; background: rgba(0,0,0,.55);
  border-radius: 10px; padding: 6px 14px; min-width: 150px; }
.as-wert b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; } .as-wert small { font-size: 12.5px; opacity: .85; }
.as-unten { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 12px calc(14px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.78) 30%); }
.as-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
.as-chip { flex: 0 0 auto; min-height: 38px; padding: 0 13px; border-radius: 19px; border: 1.5px solid rgba(255,255,255,.5); background: rgba(0,0,0,.35);
  color: #fff; font: inherit; font-size: 14px; cursor: pointer; }
.as-chip.an { background: #fff; color: #111; border-color: #fff; font-weight: 700; } .as-chip:disabled { opacity: .4; }
.as-knoepfe { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.as-neben { flex: 1; min-height: 48px; border-radius: 24px; border: 1.5px solid rgba(255,255,255,.5); background: rgba(0,0,0,.35); color: #fff; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.as-neben:disabled { opacity: .35; }
.as-ausloeser { flex: 0 0 78px; width: 78px; height: 78px; border-radius: 50%; border: 4px solid #fff; background: rgba(255,255,255,.18); padding: 0; cursor: pointer; display: grid; place-items: center; }
.as-ausloeser span { width: 58px; height: 58px; border-radius: 50%; background: var(--as-akz); display: block; }
.as-ausloeser:active span { transform: scale(.9); } .as-ausloeser:disabled { opacity: .4; }
.as-meldung { min-height: 20px; text-align: center; font-size: 14px; margin-top: 8px; color: var(--as-warn); font-weight: 600; }
@media (min-width: 900px) { .as-dunkel .as-anleitung { font-size: 17px; } }
`;
  document.head.append(s);
}

// ================================================================ Helfer

function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
function esc(t) { return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
/** Zahl aus einer Eingabe – Komma oder Punkt, Leerzeichen egal. */
export function zahl(t) { const n = parseFloat(String(t ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; }
function zahlOder(v, f) { const n = Number(v); return n > 0 ? n : f; }
function komma(v, n = 2) { return Number(v).toFixed(n).replace(".", ","); }
function meter(m) { return `${komma(m, 2)} m`; }
function cm(m) { return `${Math.round(Number(m) * 100)} cm`; }
function artWort(a) { return ({ TUER: "Tür", FENSTER: "Fenster", DURCHGANG: "Durchgang", TOR: "Tor" }[a] || a); }
function kurzName(k) { return ({ STECKDOSE_2FACH: "Steckdose 2×", SICHERUNGSKASTEN: "Verteiler", NETZWERKDOSE: "Netzwerk" }[k] || Normmasse.ARTEN.get(k) || k); }
const SCHLUESSEL_HALTUNG = "raumwerk.haltung", SCHLUESSEL_GERAET = "raumwerk.geraet";
function gespeicherteHaltung() { try { return localStorage.getItem(SCHLUESSEL_HALTUNG) === "stativ" ? "stativ" : "hand"; } catch (_) { return "hand"; } }
/** Wende-Kalibrierung dieses Geräts (Neigungsfehler), oder null. */
function geraetKalibrierung() {
  try { const g = JSON.parse(localStorage.getItem(SCHLUESSEL_GERAET) || "null"); return g && Number.isFinite(g.neigungsfehlerGrad) ? g : null; } catch (_) { return null; }
}
function geraetSpeichern(g) { try { localStorage.setItem(SCHLUESSEL_GERAET, JSON.stringify(g)); } catch (_) {} }
function gespeicherteHoehe() { try { const v = Number(localStorage.getItem(SCHLUESSEL_HOEHE)); return v > 0.3 && v < 2.5 ? v : 1.4; } catch (_) { return 1.4; } }
function brumm() { try { navigator.vibrate && navigator.vibrate(25); } catch (_) {} }
