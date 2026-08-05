/*
 * Scan-Assistent – geführte Raumaufnahme für die Photogrammetrie (Schicht ②).
 *
 * Idee aus dem Gespräch: einen **Referenzwürfel** bekannter Kantenlänge (z. B.
 * 30 cm) in den Raum stellen – er gibt dem späteren Modell den absoluten
 * Maßstab. Die App führt dann per **Pfeil auf dem Display** um den Raum, damit
 * aus möglichst vielen Richtungen sauber überlappende Bilder entstehen.
 *
 * „KI" ist hier ein ehrlicher, regelbasierter Abdeckungsplaner: Der Horizont
 * wird in Sektoren geteilt; der Kompass (nativ aus dem Rotationsvektor, im
 * Browser aus DeviceOrientation) sagt, wohin das Gerät zeigt. Ein noch offener
 * Sektor zieht den Pfeil zu sich; steht das Gerät ruhig auf einem offenen
 * Sektor, löst die Aufnahme selbst aus. Jedes Bild wird mit seiner Lage
 * (Azimut/Neigung/Roll), dem Ort (GPS) und der Würfelkante verschlagwortet –
 * genau das, was die Rekonstruktion braucht.
 *
 * Alles offline: Kamera über getUserMedia, Sensorik über window.__native.
 */

const SEKTOREN = 12;                 // 30°-Schritte rund um den Raum
const SEKTOR_GRAD = 360 / SEKTOREN;
const RUHE_GRAD = 4;                 // als „ruhig" gilt < 4° Wackeln
const RUHE_MS = 600;                 // so lange ruhig → Auslösung
const MAX_BILDER = 72;               // Speicher begrenzen

export async function starteScan(opts) {
  const N = window.__native || null;
  const info = N && N.geraete ? N.geraete() : null;

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
        <label class="scan-feld">Würfelkante
          <span class="scan-kante-reihe">
            <input class="scan-kante" type="number" min="5" max="200" step="1" value="30"> cm
          </span>
        </label>
        <label class="scan-feld">Kamera
          <select class="scan-kamwahl"></select>
        </label>
        <div class="scan-fortschritt"><span class="scan-balken"></span><b class="scan-zahl">0 / ${SEKTOREN}</b></div>
        <label class="scan-feld scan-auto"><input type="checkbox" class="scan-auto-an" checked> Auto-Auslösung</label>
        <button class="scan-schuss">Auslösen</button>
      </div>

      <div class="scan-galerie"></div>
    </div>`;
  document.body.appendChild(overlay);

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
  let heading = null, neigung = 0, roll = 0;
  function ausOrient(o) {
    if (!o) return;
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
  let stabilSeit = 0, letztesHeading = null, letzteAuto = 0, laeuft = true;
  function schleife() {
    if (!laeuft) return;
    if (heading == null) {
      lageEl.textContent = "Kein Kompass – bitte manuell auslösen. (Sektorführung inaktiv.)";
      pfeilDreh.style.opacity = "0.2";
    } else {
      const offen = naechsterOffen(heading);
      if (!offen) {
        pfeilDreh.style.transform = "scale(0.9)";
        lageEl.textContent = `Alle ${SEKTOREN} Sektoren abgedeckt. Für ein besseres Modell einmal tiefer (zum Würfel geneigt) wiederholen.`;
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
  function manifest() {
    return {
      werkzeug: "raumwerk-scan",
      erstellt: new Date().toISOString(),
      raumId: opts && opts.raum ? opts.raum.id : null,
      wuerfelKanteM: (Number(overlay.querySelector(".scan-kante").value) || 30) / 100,
      kamera: kamWahl.options[kamWahl.selectedIndex] ? kamWahl.options[kamWahl.selectedIndex].text : null,
      geraet: info ? { hersteller: info.hersteller, modell: info.modell } : null,
      abgedeckteSektoren: abgedeckt.filter(Boolean).length,
      sektoren: SEKTOREN,
      anzahl: bilder.length,
      aufnahmen: bilder.map((b, i) => Object.assign({ datei: `bild_${String(i + 1).padStart(2, "0")}.jpg` }, b.pose))
    };
  }

  function allesSichern() {
    const m = manifest();
    lade(new Blob([JSON.stringify(m, null, 2)], { type: "application/json" }), "scan_manifest.json");
    bilder.forEach((b, i) => { if (b.dataUrl) setTimeout(() => ladeDataUrl(b.dataUrl, `bild_${String(i + 1).padStart(2, "0")}.jpg`), i * 250); });
  }

  const beenden = () => {
    laeuft = false;
    if (strom) strom.getTracks().forEach(t => t.stop());
    if (N) N.stoppe();
    const m = manifest();
    if (bilder.length && opts && opts.speichern) {
      // Nur die Metadaten (Posen) ins Projekt – die Bilder bleiben als Download,
      // damit der localStorage nicht mit Base64 vollläuft.
      opts.speichern(m);
    }
    if (bilder.length) {
      const frage = document.createElement("div");
      frage.className = "scan-abschluss";
      frage.innerHTML = `<div class="scan-abschluss-box">
        <b>${bilder.length} Aufnahmen, ${m.abgedeckteSektoren}/${SEKTOREN} Sektoren.</b>
        <p>Die Posen sind im Projekt gesichert. Bilder + Manifest für die Photogrammetrie herunterladen?</p>
        <div class="scan-abschluss-knoepfe">
          <button class="scan-dl">Bilder + Manifest sichern</button>
          <button class="scan-fertig">Schließen</button>
        </div></div>`;
      overlay.appendChild(frage);
      frage.querySelector(".scan-dl").onclick = () => { allesSichern(); schliessen(); };
      frage.querySelector(".scan-fertig").onclick = schliessen;
    } else {
      schliessen();
    }
  };
  function schliessen() { overlay.remove(); if (opts && opts.onEnde) opts.onEnde(); }
  overlay.querySelector(".scan-zu").onclick = beenden;

  return { beenden };
}

// -------------------------------------------------------- Helfer

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

function lade(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function ladeDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
