/*
 * RAUMWERK · Aufnahme (Schicht ①) – die Erfassung im Feld.
 *
 * Eine schlanke, installierbare Web-App: Vor Ort werden Fotos (Kamera),
 * Lasermaße (manuell) und Objekt-Tags erfasst und an die Verarbeitungs-
 * Pipeline (Schicht ②) geschickt – nichts wird hier gerechnet, nur erfasst und
 * hochgeladen (Konzept §5, §6.1).
 *
 * Bewusst ohne Rahmenwerk. Der Bild-Upload nutzt genau die API, die die
 * Pipeline anbietet: Auftrag anlegen (auto:false) → Bilder hochladen → starten.
 */

const $ = (id) => document.getElementById(id);

// Kleiner Tag-Katalog – die häufigsten Objekte eines Technikraums. Bewusst hier
// eingebettet (nicht importiert), damit die App als eigenständige PWA offline
// startet, ohne Datei aus einem anderen Verzeichnis.
const TAGS = [
  ["ZAEHLERSCHRANK", "Zählerschrank"],
  ["VERTEILERSCHRANK", "Verteiler (UV)"],
  ["HAUPTVERTEILUNG", "Hauptverteilung"],
  ["SCHALTSCHRANK", "Schaltschrank"],
  ["SERVERSCHRANK", "Serverschrank"],
  ["USV", "USV"],
  ["THERME", "Heiztherme"],
  ["WARMWASSER", "Warmwasserspeicher"],
  ["KLIMA_INNEN", "Klima innen"],
  ["KABEL_NYM5", "Kabel NYM 5×2,5"],
  ["LEERROHR_M25", "Leerrohr M25"],
];

const zustand = {
  fotos: [],   // { name, blob, url }
  laser: [],   // { von, bis, distanzM }
  tags: [],    // Schlüssel
  stream: null,
};

// ------------------------------------------------------------- Kamera

async function kameraStarten() {
  try {
    zustand.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, audio: false,
    });
    $("video").srcObject = zustand.stream;
    await $("video").play();
    $("videoHinweis").hidden = true;
    $("btnFoto").disabled = false;
    $("btnKamera").textContent = "Kamera läuft";
  } catch (e) {
    melde(`Kamera nicht verfügbar: ${e.message}`, true);
  }
}

function fotoAufnehmen() {
  const video = $("video");
  if (!video.videoWidth) return;
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  c.toBlob((blob) => {
    const name = `IMG_${String(zustand.fotos.length + 1).padStart(3, "0")}.jpg`;
    zustand.fotos.push({ name, blob, url: URL.createObjectURL(blob) });
    renderGalerie();
  }, "image/jpeg", 0.85);
}

function renderGalerie() {
  $("galerie").innerHTML = zustand.fotos.map((f, i) => `
    <figure class="mini" data-foto="${i}">
      <img src="${f.url}" alt="">
      <button class="mini-weg" title="Foto entfernen">✕</button>
    </figure>`).join("");
  $("galerie").querySelectorAll("[data-foto]").forEach((el) => {
    el.querySelector(".mini-weg").onclick = () => {
      const i = Number(el.getAttribute("data-foto"));
      URL.revokeObjectURL(zustand.fotos[i].url);
      zustand.fotos.splice(i, 1);
      renderGalerie();
    };
  });
}

// -------------------------------------------------------- Lasermaße

function renderLaser() {
  $("laserListe").innerHTML = zustand.laser.map((m, i) => `
    <div class="laser-zeile" data-laser="${i}">
      <input class="l-von" value="${att(m.von)}" placeholder="von" aria-label="von">
      <input class="l-bis" value="${att(m.bis)}" placeholder="bis" aria-label="bis">
      <input class="l-m" type="number" inputmode="decimal" step="0.01" value="${m.distanzM ?? ""}" placeholder="m" aria-label="Meter">
      <button class="mini-weg" title="entfernen">✕</button>
    </div>`).join("") || `<p class="leer">Noch kein Maß.</p>`;
  zustand.laser.forEach((m, i) => {
    const z = $("laserListe").querySelector(`[data-laser="${i}"]`);
    z.querySelector(".l-von").onchange = (e) => (m.von = e.target.value);
    z.querySelector(".l-bis").onchange = (e) => (m.bis = e.target.value);
    z.querySelector(".l-m").onchange = (e) => (m.distanzM = parseFloat(e.target.value) || 0);
    z.querySelector(".mini-weg").onclick = () => { zustand.laser.splice(i, 1); renderLaser(); };
  });
}

// ------------------------------------------------------------- Tags

function renderTags() {
  $("tagPalette").innerHTML = TAGS.map(([k, label]) =>
    `<button class="chip ${zustand.tags.includes(k) ? "aktiv" : ""}" data-tag="${k}">${label}</button>`).join("");
  $("tagPalette").querySelectorAll("[data-tag]").forEach((b) =>
    b.onclick = () => {
      const k = b.getAttribute("data-tag");
      const i = zustand.tags.indexOf(k);
      if (i >= 0) zustand.tags.splice(i, 1); else zustand.tags.push(k);
      renderTags();
    });
  const namen = zustand.tags.map((k) => (TAGS.find(([s]) => s === k) || [k, k])[1]);
  $("tagListe").textContent = namen.length ? `Gewählt: ${namen.join(", ")}` : "";
}

// ----------------------------------------------------------- Senden

async function senden() {
  const url = $("pipUrl").value.trim().replace(/\/+$/, "") || "http://localhost:8781";
  const name = $("auftragName").value.trim() || "Aufnahme";
  localStorage.setItem("raumwerk.aufnahme.url", url);
  localStorage.setItem("raumwerk.aufnahme.name", name);

  if (!zustand.fotos.length && !zustand.laser.length) {
    return melde("Nichts zu senden – mindestens ein Foto oder ein Maß.", true);
  }
  $("btnSenden").disabled = true;
  try {
    melde("Lege Auftrag an …");
    const antwort = await fetch(`${url}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, auto: false,
        laser: zustand.laser.filter((m) => m.distanzM > 0),
        tags: zustand.tags.map((k) => ({ art: k })),
      }),
    });
    if (!antwort.ok) throw new Error(`Server antwortete ${antwort.status}`);
    const job = await antwort.json();

    for (let i = 0; i < zustand.fotos.length; i++) {
      melde(`Lade Bild ${i + 1}/${zustand.fotos.length} …`);
      await fetch(`${url}/jobs/${job.id}/bild?name=${encodeURIComponent(zustand.fotos[i].name)}`, {
        method: "POST", headers: { "Content-Type": "image/jpeg" }, body: zustand.fotos[i].blob,
      });
    }
    melde("Starte Verarbeitung …");
    await fetch(`${url}/jobs/${job.id}/start`, { method: "POST" });
    fertig(job.id, url);
  } catch (e) {
    melde(`Senden fehlgeschlagen: ${e.message}. Aufnahme bleibt erhalten – bei Netz erneut senden.`, true);
  } finally {
    $("btnSenden").disabled = false;
  }
}

function fertig(id, url) {
  $("status").className = "status gut";
  $("status").innerHTML =
    `Auftrag <code>${id}</code> gesendet – ${zustand.fotos.length} Foto(s), ${zustand.laser.length} Maß(e). ` +
    `<a href="${url}/jobs/${id}" target="_blank" rel="noopener">Status ansehen</a>`;
}

function melde(text, fehler = false) {
  $("status").className = `status${fehler ? " fehler" : ""}`;
  $("status").textContent = text;
}

// -------------------------------------------------------- Start

function att(v) { return String(v ?? "").replace(/"/g, "&quot;"); }

function verdrahten() {
  $("pipUrl").value = localStorage.getItem("raumwerk.aufnahme.url") || "http://localhost:8781";
  $("auftragName").value = localStorage.getItem("raumwerk.aufnahme.name") || "";
  $("btnKamera").onclick = kameraStarten;
  $("btnFoto").onclick = fotoAufnehmen;
  $("btnLaser").onclick = () => { zustand.laser.push({ von: "", bis: "", distanzM: 0 }); renderLaser(); };
  $("btnSenden").onclick = senden;

  const netz = () => { $("netz").textContent = navigator.onLine ? "online" : "offline"; $("netz").className = `netz ${navigator.onLine ? "" : "aus"}`; };
  window.addEventListener("online", netz);
  window.addEventListener("offline", netz);
  netz();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline-Start optional */ });
  }
}

verdrahten();
renderLaser();
renderTags();
