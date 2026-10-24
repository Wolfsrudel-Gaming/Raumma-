/*
 * Scan-Assistent – geführte Bildserie rundum: Dokumentation des Raums und
 * Material für die spätere Photogrammetrie (Schicht ②).
 *
 * Ehrlich eingeordnet: Die **Maße** des Raums kommen nicht aus diesen Bildern,
 * sondern aus dem Aufmaß (Zielen mit dem Handy, Maßband, Laser – siehe
 * assistent.js). Ein **Referenzwürfel/-block** (docs/REFERENZBLOCK.md) ist
 * optional: Steht einer im Raum, kommen seine Kante und die nachgemessene
 * Markerkante ins Manifest, sonst bleibt `wuerfelKanteM` null. Eine Marker-
 * Erkennung gibt es noch nicht – die App behauptet auch keine.
 *
 * Die App führt per **Pfeil auf dem Display** um den Raum, damit aus möglichst
 * vielen Richtungen sauber überlappende Bilder entstehen. „KI" ist hier ein
 * ehrlicher, regelbasierter Abdeckungsplaner: Der Horizont wird in Sektoren
 * geteilt; der Kompass (nativ aus dem Rotationsvektor, im Browser aus
 * DeviceOrientation) sagt, wohin das Gerät zeigt. Ein noch offener Sektor
 * zieht den Pfeil zu sich; steht das Gerät ruhig auf einem offenen Sektor,
 * löst die Aufnahme selbst aus. Jedes Bild wird mit seiner Lage
 * (Azimut/Neigung/Roll) und dem Ort (GPS) verschlagwortet.
 *
 * Aufruf: starteScan({ raum, speichern, onEnde, fotoHinzufuegen })
 *   raum                       – aktiver Raum (für raumId im Manifest)
 *   speichern(manifest)        – Metadaten (Posen) ins Projekt, ohne Bilddaten
 *   onEnde()                   – nach dem Schließen
 *   fotoHinzufuegen(url, titel) – optional: ein Bild als Projektfoto übernehmen
 *                                (JPEG, max. 1280 px, Qualität 0,75). Ist es da,
 *                                bietet der Abschluss „Bilder ins Projekt" an –
 *                                in der Android-App der Weg für die Bilder, denn
 *                                Downloads gibt es in der WebView nicht.
 *                                Rückgabe: wahr = gespeichert; falsch (null) =
 *                                Projekt nicht speicherbar, Foto wieder entfernt
 *                                → die Übernahme bricht dort ab und meldet es.
 * Weitergabe: das Manifest über window.__native.teilen (App: Teilen-Menü,
 * Browser: Teilen bzw. Download), die Bilder im Browser als Download.
 *
 * Alles offline: Kamera über getUserMedia, Sensorik über window.__native.
 */

const SEKTOREN = 12;                 // 30°-Schritte rund um den Raum
const SEKTOR_GRAD = 360 / SEKTOREN;
const RUHE_GRAD = 4;                 // als „ruhig" gilt < 4° Wackeln
const RUHE_MS = 600;                 // so lange ruhig → Auslösung
const MAX_BILDER = 72;               // Speicher begrenzen
const FOTO_KANTE = 1280;             // Projektfotos: längste Kante in px …
const FOTO_QUALITAET = 0.75;         // … und JPEG-Qualität (wie beim Foto-Import)
const VIELE_FOTOS = 24;              // ab hier vor vollem Gerätespeicher warnen

export async function starteScan(opts) {
  const N = window.__native || null;
  const info = N && N.geraete ? N.geraete() : null;
  stilEinmal();

  const overlay = document.createElement("div");
  overlay.className = "scan-overlay";
  overlay.innerHTML = `
    <video class="scan-video" playsinline muted autoplay></video>
    <canvas class="scan-grab" hidden></canvas>
    <div class="scan-ui">
      <div class="scan-kopf">
        <div class="scan-geraet"></div>
        <button class="scan-zu">Fertig</button>
      </div>
      <div class="scan-zweck" style="align-self:flex-start;max-width:min(100%,560px);background:rgba(0,0,0,.6);color:#f3e7d7;border-radius:4px;padding:6px 10px;font-size:12px;line-height:1.35">
        Bildserie zur Dokumentation und für die spätere Photogrammetrie. Die Maße kommen aus dem Aufmaß – ein Referenzwürfel ist nicht nötig.</div>

      <div class="scan-fuehrung">
        <svg class="scan-pfeil" viewBox="-50 -50 100 100" aria-hidden="true">
          <g class="scan-pfeil-dreh">
            <path d="M0,-34 L13,-6 L4,-6 L4,30 L-4,30 L-4,-6 L-13,-6 Z"/>
          </g>
          <circle class="scan-ring" cx="0" cy="0" r="44"/>
        </svg>
        <div class="scan-lage"></div>
      </div>

      <div class="scan-leiste">
        <label class="scan-feld">Kamera
          <select class="scan-kamwahl"></select>
        </label>
        <label class="scan-feld scan-auto" title="Nur für die spätere Photogrammetrie – für das Aufmaß nicht nötig.">
          <input type="checkbox" class="scan-ref-an"> Referenzwürfel/-block steht im Raum</label>
        <label class="scan-feld scan-ref-feld" style="display:none">Blockkante
          <span class="scan-kante-reihe">
            <input class="scan-kante scan-block" type="number" min="5" max="200" step="0.1" value="25"> cm
          </span>
        </label>
        <label class="scan-feld scan-ref-feld" style="display:none">Markerkante (nachgemessen)
          <span class="scan-kante-reihe">
            <input class="scan-kante scan-marker" type="number" min="10" max="1000" step="0.1" value="160"> mm
          </span>
        </label>
        <div class="scan-fortschritt"><span class="scan-balken"></span><b class="scan-zahl">0 / ${SEKTOREN}</b></div>
        <label class="scan-feld scan-auto"><input type="checkbox" class="scan-auto-an" checked> Auto-Auslösung</label>
        <button class="scan-schuss">Auslösen</button>
      </div>

      <div class="scan-galerie"></div>
    </div>`;
  document.body.appendChild(overlay);

  // Zurück-Taste (App): Das Overlay liegt über der Feld-App. Ohne eigenen Hörer
  // schaltete die den Schirm darunter um, und das zweite Zurück beendete die
  // App samt der Bilder, die nur hier im Speicher liegen. Also erst die Serie
  // abschließen (Abschluss-Dialog), dann schließen. Solange die Kamera noch
  // startet, wird Zurück nur abgefangen – wie „Fertig" ist es dann noch tot.
  let beimZurueck = () => {};
  const zurueckWeg = N && typeof N.beiZurueck === "function" ? N.beiZurueck(() => { beimZurueck(); return true; }) : null;

  const video = overlay.querySelector(".scan-video");
  const grab = overlay.querySelector(".scan-grab");
  const pfeilDreh = overlay.querySelector(".scan-pfeil-dreh");
  const ring = overlay.querySelector(".scan-ring");
  const lageEl = overlay.querySelector(".scan-lage");
  const balken = overlay.querySelector(".scan-balken");
  const zahl = overlay.querySelector(".scan-zahl");
  const galerie = overlay.querySelector(".scan-galerie");
  const geraetEl = overlay.querySelector(".scan-geraet");
  const autoAn = overlay.querySelector(".scan-auto-an");
  const kamWahl = overlay.querySelector(".scan-kamwahl");
  const refAn = overlay.querySelector(".scan-ref-an");
  const refFelder = [...overlay.querySelectorAll(".scan-ref-feld")];

  // Referenzblock ist Zubehör: die Felder erscheinen erst, wenn einer dasteht.
  // (style.display statt hidden – .scan-feld setzt display:flex.)
  refAn.onchange = () => refFelder.forEach(f => { f.style.display = refAn.checked ? "" : "none"; });

  // Geräte-Zeile: was steckt im Telefon? Mono/IR-Linsen hervorheben.
  if (info) {
    const irs = (info.kameras || []).filter(k => k.mono);
    geraetEl.innerHTML = `<b>${esc(info.hersteller || "")} ${esc(info.modell || "")}</b>`
      + ` · ${(info.kameras || []).length} Kameras`
      + (irs.length ? ` · <span class="scan-ir">${irs.length}× Mono/IR</span>` : "")
      + (N && N.app ? "" : " · <i>Browser</i>");
  } else {
    geraetEl.textContent = N && N.app ? "Gerät wird gelesen …" : "Browser-Modus";
  }

  // ---- Kamera-Auswahl (streambare videoinputs) -------------------------
  let aktuelleKamId = null;
  async function kamerasFuellen() {
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"); } catch (_) {}
    if (!devs.length) { kamWahl.innerHTML = `<option value="">Rückkamera</option>`; return; }
    kamWahl.innerHTML = devs.map((d, i) =>
      `<option value="${esc(d.deviceId)}">${esc(d.label || ("Kamera " + (i + 1)))}</option>`).join("");
    // Sinnvolle Vorauswahl: die hintere Kamera.
    const hinten = devs.find(d => /back|rear|environment|hinten/i.test(d.label));
    if (hinten) kamWahl.value = hinten.deviceId;
    aktuelleKamId = kamWahl.value || null;
  }

  let strom = null;
  async function kameraStarten(devId) {
    if (strom) strom.getTracks().forEach(t => t.stop());
    const constraints = devId
      ? { video: { deviceId: { exact: devId } }, audio: false }
      : { video: { facingMode: { ideal: "environment" } }, audio: false };
    strom = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = strom;
    await video.play().catch(() => {});
  }

  try {
    await kameraStarten(null);
    await kamerasFuellen();     // Labels gibt es erst nach erteiltem Kamerarecht
    if (aktuelleKamId) await kameraStarten(aktuelleKamId);
  } catch (_) {
    overlay.classList.add("scan-ohne-kamera");
    lageEl.textContent = "Keine Kamera – Aufnahme nur mit Lagedaten möglich.";
  }
  kamWahl.onchange = async () => { try { await kameraStarten(kamWahl.value || null); } catch (_) {} };

  // ---- Sensorik --------------------------------------------------------
  if (N) N.starte();
  let heading = null, neigung = 0, roll = 0, laeuft = true;
  function ausOrient(o) {
    if (!o || !laeuft) return;   // Hörer lassen sich nicht abmelden – nach dem Ende ignorieren
    if (o.azimut != null) heading = ((o.azimut % 360) + 360) % 360;
    if (o.neigung != null) neigung = o.neigung;
    if (o.roll != null) roll = o.roll;
  }
  if (N) N.beiOrient(ausOrient);
  ausOrient(N && N.orientierung && N.orientierung());

  // ---- Abdeckung -------------------------------------------------------
  const abgedeckt = new Array(SEKTOREN).fill(false);
  const bilder = [];               // { dataUrl, pose }
  const ringSegmente = baueRing(ring, overlay);

  function sektorVon(h) { return Math.floor((((h % 360) + 360) % 360) / SEKTOR_GRAD) % SEKTOREN; }
  function normWinkel(d) { d = (d + 180) % 360; if (d < 0) d += 360; return d - 180; }

  function naechsterOffen(h) {
    let best = null, bestAbs = 999;
    for (let s = 0; s < SEKTOREN; s++) {
      if (abgedeckt[s]) continue;
      const ziel = s * SEKTOR_GRAD + SEKTOR_GRAD / 2;
      const d = Math.abs(normWinkel(ziel - h));
      if (d < bestAbs) { bestAbs = d; best = { s, delta: normWinkel(ziel - h) }; }
    }
    return best;
  }

  function abdeckungMalen() {
    const n = abgedeckt.filter(Boolean).length;
    balken.style.width = Math.round((n / SEKTOREN) * 100) + "%";
    zahl.textContent = `${n} / ${SEKTOREN}`;
    ringSegmente.forEach((seg, s) => seg.classList.toggle("voll", abgedeckt[s]));
  }
  abdeckungMalen();

  // ---- Aufnahme --------------------------------------------------------
  function aktuellePose() {
    const ort = N && N.ort ? N.ort() : null;
    return {
      azimut: heading == null ? null : Math.round(heading * 10) / 10,
      neigung: Math.round(neigung * 10) / 10,
      roll: Math.round(roll * 10) / 10,
      sektor: heading == null ? null : sektorVon(heading),
      ort: ort ? { breite: ort.breite, laenge: ort.laenge, hoehe: ort.hoehe, genauigkeit: ort.genauigkeit } : null,
      t: Date.now()
    };
  }

  function bildDaten() {
    if (!video.videoWidth) return null;
    const max = 1600, sk = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    grab.width = Math.round(video.videoWidth * sk);
    grab.height = Math.round(video.videoHeight * sk);
    const g = grab.getContext("2d");
    g.drawImage(video, 0, 0, grab.width, grab.height);
    try { return grab.toDataURL("image/jpeg", 0.82); } catch (_) { return null; }
  }

  function ausloesen(auto) {
    if (bilder.length >= MAX_BILDER) { blitz("Maximale Bildzahl erreicht"); return; }
    const pose = aktuellePose();
    const dataUrl = bildDaten();
    bilder.push({ dataUrl, pose });
    if (pose.sektor != null) abgedeckt[pose.sektor] = true;
    abdeckungMalen();
    galerieAnhaengen(bilder.length - 1);
    blitz(auto ? "aufgenommen ✓" : "Bild " + bilder.length);
  }
  overlay.querySelector(".scan-schuss").onclick = () => ausloesen(false);

  function galerieAnhaengen(i) {
    const b = bilder[i];
    const t = document.createElement("div");
    t.className = "scan-thumb";
    const grad = b.pose.azimut == null ? "—" : Math.round(b.pose.azimut) + "°";
    t.innerHTML = (b.dataUrl ? `<img src="${b.dataUrl}" alt="">` : `<span class="scan-nobild">kein Bild</span>`)
      + `<span class="scan-thumb-tag">${grad}</span>`;
    galerie.appendChild(t);
    galerie.scrollLeft = galerie.scrollWidth;
  }

  let blitzT = 0;
  function blitz(text) {
    lageEl.dataset.blitz = text;
    blitzT = Date.now();
  }

  // ---- Führungsschleife ------------------------------------------------
  let stabilSeit = 0, letztesHeading = null, letzteAuto = 0;
  function schleife() {
    if (!laeuft) return;
    if (heading == null) {
      lageEl.textContent = "Kein Kompass – bitte manuell auslösen. (Sektorführung inaktiv.)";
      pfeilDreh.style.opacity = "0.2";
    } else {
      const offen = naechsterOffen(heading);
      if (!offen) {
        pfeilDreh.style.transform = "scale(0.9)";
        lageEl.textContent = `Alle ${SEKTOREN} Sektoren abgedeckt. Für ein besseres Modell eine zweite Runde mit stärker geneigtem Gerät (Richtung Boden) aufnehmen.`;
      } else {
        pfeilDreh.style.opacity = "1";
        pfeilDreh.style.transform = `rotate(${offen.delta}deg)`;
        const richtung = Math.abs(offen.delta) < 12 ? "hier – ruhig halten"
          : offen.delta > 0 ? "nach rechts drehen" : "nach links drehen";
        const l = Date.now() - blitzT < 900 ? ` · ${lageEl.dataset.blitz || ""}` : "";
        lageEl.textContent = `Azimut ${Math.round(heading)}° · Sektor ${sektorVon(heading) + 1}/${SEKTOREN} · ${richtung}${l}`;

        // Ruhe-Erkennung für Auto-Auslösung.
        if (letztesHeading == null || Math.abs(normWinkel(heading - letztesHeading)) > RUHE_GRAD) {
          stabilSeit = Date.now();
        }
        letztesHeading = heading;
        const ruhig = Date.now() - stabilSeit > RUHE_MS;
        const s = sektorVon(heading);
        if (autoAn.checked && ruhig && !abgedeckt[s] && Date.now() - letzteAuto > 1200) {
          letzteAuto = Date.now();
          ausloesen(true);
        }
      }
    }
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  // ---- Abschluss -------------------------------------------------------
  let erstellt = null;
  const stamm = () => "scan_" + (erstellt || new Date()).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const bildName = i => `${stamm()}_bild_${String(i + 1).padStart(2, "0")}.jpg`;
  const manifestName = () => `${stamm()}_manifest.json`;
  const zahlAus = el => { const n = Number(String(el.value).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };

  function manifest() {
    erstellt = erstellt || new Date();
    // Ohne Referenzblock trägt die Bildserie keinen Maßstab – dann null, nicht geraten.
    const block = refAn.checked;
    const kanteCm = block ? zahlAus(overlay.querySelector(".scan-block")) : null;
    const markerMm = block ? zahlAus(overlay.querySelector(".scan-marker")) : null;
    return {
      werkzeug: "raumwerk-scan",
      erstellt: erstellt.toISOString(),
      raumId: opts && opts.raum ? opts.raum.id : null,
      referenzblock: block,
      wuerfelKanteM: kanteCm ? Math.round(kanteCm * 100) / 10000 : null,   // auf 0,1 mm
      markerKanteM: markerMm ? Math.round(markerMm * 10) / 10000 : null,
      kamera: kamWahl.options[kamWahl.selectedIndex] ? kamWahl.options[kamWahl.selectedIndex].text : null,
      geraet: info ? { hersteller: info.hersteller, modell: info.modell } : null,
      abgedeckteSektoren: abgedeckt.filter(Boolean).length,
      sektoren: SEKTOREN,
      anzahl: bilder.length,
      aufnahmen: bilder.map((b, i) => Object.assign({ datei: bildName(i) }, b.pose))
    };
  }

  /** Manifest weitergeben: App → Teilen-Menü, Browser → Teilen bzw. Download. */
  function manifestTeilen(m) {
    const text = JSON.stringify(m, null, 2);
    if (N && typeof N.teilen === "function") {
      return N.teilen(manifestName(), "application/json", text).catch(() => false);
    }
    return Promise.resolve(herunterladen(new Blob([text], { type: "application/json" }), manifestName()));
  }

  /** Browser: Manifest und Bilder als Downloads (in der App-WebView wirkungslos). */
  function allesHerunterladen(m) {
    const p = manifestTeilen(m);
    bilder.forEach((b, i) => { if (b.dataUrl) setTimeout(() => ladeDataUrl(b.dataUrl, bildName(i)), (i + 1) * 250); });
    return p;
  }

  /**
   * Bilder verkleinert als Projektfotos übergeben → { n, voll }: n übernommen.
   * Eine falsche Rückgabe heißt, das Projekt ließ sich nicht mehr speichern
   * (das Foto ist dann schon wieder heraus) – dort aufhören (`voll`), statt
   * weitere Bilder als übernommen zu zählen, die beim Schließen fehlen.
   */
  async function bilderInsProjekt() {
    let n = 0;
    for (let i = 0; i < bilder.length; i++) {
      const b = bilder[i];
      if (!b.dataUrl) continue;
      const url = await verkleinern(b.dataUrl, FOTO_KANTE, FOTO_QUALITAET);
      if (!url) continue;
      const grad = b.pose.azimut == null ? "" : ` · ${Math.round(b.pose.azimut)}°`;
      let r;
      try { r = await opts.fotoHinzufuegen(url, `Bildserie · Bild ${i + 1}${grad}`); } catch (_) { r = null; }
      if (!r) return { n, voll: true };
      n++;
    }
    return { n, voll: false };
  }

  let beendet = false;
  const beenden = () => {
    if (beendet) return;
    beendet = true;
    laeuft = false;
    if (strom) strom.getTracks().forEach(t => t.stop());
    if (N) N.stoppe();
    const m = manifest();
    if (bilder.length && opts && opts.speichern) {
      // Nur die Metadaten (Posen) ins Projekt – Bilddaten kommen nur auf Wunsch
      // dazu (fotoHinzufuegen), damit der Speicher nicht mit Base64 vollläuft.
      opts.speichern(m);
    }
    if (!bilder.length) { schliessen(); return; }

    const app = !!(N && N.app);
    const insProjekt = !!(opts && typeof opts.fotoHinzufuegen === "function");
    const mitBild = bilder.filter(b => b.dataUrl).length;
    const knoepfe = [];
    if (insProjekt && mitBild) {
      knoepfe.push(`<button class="scan-dl scan-insprojekt">${mitBild === 1 ? "Bild" : `${mitBild} Bilder`} als Fotos ins Projekt</button>`);
    }
    if (app && insProjekt) {
      // In der App gibt es keine Downloads: die Bilder gehen ins Projekt, das Manifest ins Teilen-Menü.
      knoepfe.push(`<button class="scan-teilen">Manifest teilen</button>`);
    } else {
      const titel = !mitBild ? "Manifest sichern" : app ? "Bilder + Manifest sichern" : "Bilder + Manifest herunterladen";
      knoepfe.push(`<button class="${insProjekt && mitBild ? "" : "scan-dl "}scan-sichern">${titel}</button>`);
    }
    knoepfe.push(`<button class="scan-fertig">Schließen</button>`);
    const block = m.wuerfelKanteM ? ` Referenzblock (${komma(m.wuerfelKanteM * 100)} cm) ist vermerkt.` : "";

    const frage = document.createElement("div");
    frage.className = "scan-abschluss";
    frage.innerHTML = `<div class="scan-abschluss-box">
      <b>${bilder.length} Aufnahmen, ${m.abgedeckteSektoren}/${SEKTOREN} Sektoren.</b>
      <p>Richtung und Neigung jedes Bildes sind im Projekt gesichert.${block} Die Bilder dokumentieren den Raum und sind Material für die spätere Photogrammetrie – die Raummaße kommen aus dem Aufmaß (Zielen oder Maßband).</p>
      ${insProjekt && mitBild > VIELE_FOTOS ? `<p>${mitBild} Fotos belegen viel Gerätespeicher. Meldet die App, dass er voll ist, das Projekt exportieren.</p>` : ""}
      <p class="scan-meldung" role="status" style="display:none"></p>
      <div class="scan-abschluss-knoepfe">${knoepfe.join("")}</div></div>`;
    overlay.appendChild(frage);

    const meldungEl = frage.querySelector(".scan-meldung");
    const melde = t => { meldungEl.textContent = t; meldungEl.style.display = t ? "" : "none"; };
    const knopf = sel => frage.querySelector(sel);
    if (knopf(".scan-insprojekt")) knopf(".scan-insprojekt").onclick = async e => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = "Übernehme …";
      const { n, voll } = await bilderInsProjekt();
      if (voll) {
        b.textContent = `${n} von ${mitBild} übernommen`;
        melde(`${n} von ${mitBild} übernommen – Gerätespeicher voll, Projekt exportieren.`);
        return;
      }
      b.textContent = n ? `✓ ${n === 1 ? "1 Foto" : `${n} Fotos`} im Projekt` : "Keine Bilder übernommen";
      melde(n ? "" : "Die Bilder ließen sich nicht übernehmen.");
    };
    if (knopf(".scan-teilen")) knopf(".scan-teilen").onclick = () =>
      manifestTeilen(m).then(ok => melde(ok ? "Manifest weitergegeben." : "Teilen nicht möglich."));
    if (knopf(".scan-sichern")) knopf(".scan-sichern").onclick = () => {
      const bilderMit = mitBild && !app;   // in der App-WebView laden Bild-Links nichts
      (mitBild ? allesHerunterladen(m) : manifestTeilen(m)).then(ok => melde(!ok ? "Sichern nicht möglich."
        : bilderMit ? `Manifest und ${mitBild === 1 ? "1 Bild" : `${mitBild} Bilder`} werden gespeichert.` : "Manifest gesichert."));
    };
    knopf(".scan-fertig").onclick = schliessen;
  };
  function schliessen() {
    if (zurueckWeg) zurueckWeg();
    if (!overlay.isConnected) return;
    overlay.remove();
    if (opts && opts.onEnde) opts.onEnde();
  }
  overlay.querySelector(".scan-zu").onclick = beenden;
  beimZurueck = () => { if (!beendet) beenden(); else schliessen(); };

  return { beenden };
}

// -------------------------------------------------------- Helfer

/**
 * Kästchen in der Leiste behalten ihre eigene Größe: styles.css gibt allen
 * Eingaben width:100 %. :where() hält die Spezifität klein, damit die
 * Handy-Stile (mobil.css) weiter gewinnen.
 */
function stilEinmal() {
  if (document.getElementById("scan-stil")) return;
  const st = document.createElement("style");
  st.id = "scan-stil";
  st.textContent = ":where(.scan-leiste) label > input { width: auto; flex: none; }";
  document.head.appendChild(st);
}

function baueRing(ringEl, overlay) {
  const svg = overlay.querySelector(".scan-pfeil");
  const segmente = [];
  const r = 44, cx = 0, cy = 0;
  for (let s = 0; s < SEKTOREN; s++) {
    const a0 = (s * SEKTOR_GRAD - 90 - SEKTOR_GRAD / 2 + 2) * Math.PI / 180;
    const a1 = (s * SEKTOR_GRAD - 90 + SEKTOR_GRAD / 2 - 2) * Math.PI / 180;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", `M ${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A ${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}`);
    p.setAttribute("class", "scan-seg");
    svg.insertBefore(p, ringEl);
    segmente.push(p);
  }
  ringEl.style.display = "none";
  return segmente;
}

/** Download über einen Blob-Link (Browser; die App nimmt __native.teilen). */
function herunterladen(blob, name) {
  try {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
    return true;
  } catch (_) {
    return false;
  }
}
function ladeDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/** Bild auf `max` px (längste Kante) verkleinern und als JPEG kodieren; null bei Fehler. */
function verkleinern(dataUrl, max, qualitaet) {
  return new Promise(fertig => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { fertig(null); return; }
      const sk = Math.min(1, max / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * sk));
      c.height = Math.max(1, Math.round(h * sk));
      try {
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        fertig(c.toDataURL("image/jpeg", qualitaet));
      } catch (_) {
        fertig(null);
      }
    };
    img.onerror = () => fertig(null);
    img.src = dataUrl;
  });
}

const komma = z => String(Math.round(z * 10) / 10).replace(".", ",");
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
