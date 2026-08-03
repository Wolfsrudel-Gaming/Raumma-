# RAUMWERK – Umsetzung des Konzepts

Dieses Repository setzt das RAUMWERK-Konzeptpapier um: ein **digitales Aufmaß-
und Planungssystem**, das aus einem einzigen Vor-Ort-Termin ein begehbares,
vermessbares Raum-Abbild macht. Der Wert liegt nicht in schöner 3D-Optik,
sondern in **Messbarkeit, Alternativplanung und Normprüfung**.

Dieses Dokument hält fest, **welcher Teil des Konzepts schon steht**, wie er
gebaut ist und was bewusst noch fehlt.

---

## Die drei Schichten des Konzepts – Stand

Das Konzept beschreibt drei austauschbare Schichten plus einen optionalen
Seitenzweig:

| Schicht | Konzept | Stand in diesem Repo |
|---|---|---|
| ① Erfassung (Feld) | Eigene App: Video/Foto/IMU/Laser/Tags | offen (Hardware/App-Phase) |
| ② Verarbeitung (Server-CPU) | COLMAP → OpenMVS → Maß-Solver → Semantik | **Gerüst gebaut** (`pipeline/`) |
| **③ Viewer & Planung (Browser)** | **Messen · Klötzchen mit Abstandsprüfung · Varianten · Report** | **gebaut** (`web/raumwerk/`) |
| ✦ Fotorealismus (GPU-Burst) | Gaussian Splatting, nur bei Bedarf | offen (optional) |

Gebaut ist **Schicht ③** – die Schicht, in der das eigentliche Wertversprechen
sichtbar wird (Killer-Feature und USP) – zusammen mit dem **proprietären Kern**,
der sie trägt. Die Erfassungs- und Verarbeitungsschicht (Photogrammetrie) sind
Hardware-/Pipeline-Aufgaben und bewusst noch nicht angefasst.

---

## Was gebaut ist

### Proprietärer Kern (Kotlin, getestet)

Der eigentliche Wert laut Konzept ist nicht der Code, sondern das
Domänenwissen. Es liegt gebündelt und getestet im Kotlin-Kern:

| Datei | Rolle im Konzept |
|---|---|
| `Komponente.kt` / `Komponenten` | **Komponenten-DB** (§6.2, §9 Stufe 1): parametrische „Klötzchen" mit echten Baumaßen |
| `Regelwerk.kt` | **Versionierte Normbasis** (§8): VDE/DIN-Freiräume mit Quelle und Fassung |
| `Pruefung.kt` | **Normprüfung** (§8, USP): Footprint-Geometrie, Freiraum vorne, Abstand rundum, konservative untere Schranke |

Dazu die schon vorhandene Aufmaß-Grundlage (`Modell`, `Geometrie`, `Aufmass`,
`Normmasse`, `Platzierung`). Alles ohne Framework, nur Kotlin-Standardbibliothek.

```
gradle test        # 38 Tests, u. a. 11 für die Normprüfung
```

### Browser-App (Schicht ③)

`web/raumwerk/` – ein lauffähiges Planungswerkzeug ohne Fremdbibliothek
(ES-Module). Es setzt die Kernfunktionen des fertigen Viewers aus §3 um:

- **Gemessenen Raum erfassen** – Kurzform (Rechteck/Trapez) oder
  **Polygonzug-Editor** mit laufender **Restlücke** (die Baureihenfolge aus
  `EINBAU.md`: der Polygonzug zuerst).
- **Grundriss mit Wandnummern**, Öffnungen (Tür/Fenster/…) und Einbauten als
  Schaltzeichen.
- **Maßstabsgetreue Klötzchen** aus der Palette setzen, ziehen, drehen; nahe
  einer Wand rasten sie mit dem Rücken ein.
- **Live-Normprüfung** – jede Freiraumzone ist grün, solange der geforderte
  Bedienbereich frei ist, und **rot** bei Unterschreitung; rechts die Befunde
  mit Quelle und Regelwerk-Fassung. Das ist das Killer-Feature und der USP.
- **Bestand dokumentieren** – Einbauten (Steckdosen, Schalter, Leuchten …) mit
  Norm-Höhen setzen und verschieben; wandgebundene rasten an die Wand.
- **Verortete Fotos** – Foto-Pins im Grundriss, an die Stelle gezogen; ein
  Klick zeigt das echte Bild groß (§3: „Typenschild, Klemmen lesbar"). Bilder
  werden beim Import verkleinert und im Report als Galerie ausgegeben.
- **Messen** – Punkt-zu-Punkt und Fläche, konservativ (untere Schranke).
- **Varianten** – Szenarien anlegen, duplizieren, vergleichen (Warnungen je
  Variante). Genau das „Alternativen durchspielen ohne zweite Anfahrt".
- **Mehrraum & Gebäude** – mehrere Räume je Geschoss, in einer Gebäude-
  Übersicht per Ziehen angeordnet (Kanten rasten an Nachbarräume ein) oder per
  „links/rechts/davor/dahinter" an den aktiven Raum angelegt. Geschosse
  umschaltbar.
- **3D-Ansicht** – die Räume als begehbares Modell (`modell3d.js`, three.js):
  umschauen, Räume im Raum schieben, in Augenhöhe hindurchgehen. three.js liegt
  lokal unter `web/lib/` (MIT) und wird erst beim Öffnen der Ansicht geladen;
  beim Verlassen wird das Modell abgebaut, damit es keinen Akku zieht.
- **Pipeline-Ergebnis laden** – Verbindung zur Verarbeitungs-Pipeline
  (Schicht ②): fertige Aufträge auflisten und die **metrische Punktwolke** im
  Browser (three.js, `wolke3d.js`) anzeigen – samt Maßstab und Kontrollmaß aus
  dem Manifest. Alternativ eine PLY-Datei öffnen. Das schließt den Kreis von
  der Server-Verarbeitung zurück in den Betrachter.
- **PDF-Report** – die gewählte Variante als druckbares Dokument, inklusive
  Maß-Herkunft und konservativer Rundungsregel.

Persistenz über `localStorage` – kein Server nötig, offline- und
kundenlink-tauglich, wie im Konzept vorgesehen.

### Verarbeitungs-Pipeline (Schicht ②, Gerüst)

`pipeline/` – ein lauffähiges, getestetes Server-Gerüst (Python-Standard-
bibliothek, keine Fremd-Deps) für die Photogrammetrie-Verarbeitung:

- **Job-Queue mit einem Worker**, `nice`/`ionice`, optionales Nacht-Fenster
  (§11: Koexistenz auf dem geteilten Server).
- Die Stufen **SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik**;
  real via COLMAP/OpenMVS (Kommandos dokumentiert) oder im **Simulationsmodus**,
  sodass alles ohne die schweren Binaries end-to-end durchläuft.
- Der **Maß-Solver** ist echt gerechnet (Laser-Constraints → Maßstab,
  Kontrollmaß → Genauigkeitszahl §7, konservative Rundung wie im Kern).
- **Bild-Upload** (`POST /jobs/<id>/bild`) und **Ergebnis-Auslieferung**
  (`/jobs/<id>/result`, `/jobs/<id>/wolke.ply`, mit CORS) – der Betrachter lädt
  das Ergebnis direkt.
- **Docker** mit CPU-/RAM-Limits (cgroups), HTTP-API, Tests.

```
cd pipeline
python3 -m unittest discover -s tests -t .   # 8 Tests
python3 -m raumwerk_pipeline demo            # Beispiel-Auftrag
```

**Starten:**

```
cd web
python3 -m http.server 8099
# Browser: http://localhost:8099/raumwerk/
```

(Ein Datei-Server ist nötig, weil ES-Module über `file://` nicht laden.)

---

## Leitplanke: konservative Messung

Das Konzept macht die konservative Messung zum festen Prinzip: Freiräume sind
**immer untere Schranken** (gemessen − Toleranz, auf ganze cm abgerundet).
`Pruefung.konservativ` setzt genau das um und ist eigens getestet. Die
Oberfläche und der Report sagen „mind. X cm", nie „ca. X cm".

---

## Doppelung Kotlin ↔ JavaScript

Wie schon bei der Geometrie ist die Fachlogik doppelt vorhanden, damit der
Browser **live** prüfen kann, während ein Klötzchen gezogen wird, und ein
späterer Server dieselben Zahlen für den Report liefert:

| Kotlin (verbindlich) | JavaScript (Spiegel) |
|---|---|
| `Komponente.kt` | `web/komponenten.js` |
| `Regelwerk.kt` | `web/regelwerk.js` |
| `Pruefung.kt` | `web/pruefung.js` |
| `Normmasse.kt` | `web/normmasse.js` |
| `Platzierung.kt` | `web/platzierung.js` |
| `Geometrie.kt` | `web/geometrie.js` |

**Regel:** Die Kotlin-Tests sind verbindlich, die JS-Dateien folgen ihnen. Die
Werte wurden gegeneinander geprüft (identische Ergebnisse für alle Testfälle).

---

## Was bewusst noch fehlt

Ehrlichkeit über die Grenzen, wie im Konzept:

- **Erfassung** (Schicht ①) – die eigene Capture-App (Video/Foto/IMU/Laser).
  Hardware-/App-Phase; die Browser-Planung arbeitet bis dahin auf dem manuell
  erfassten Grundriss (Kurzform oder Polygonzug).
- **Echte Photogrammetrie** (Schicht ②) – das Pipeline-**Gerüst** steht
  (`pipeline/`), aber COLMAP/OpenMVS sind noch nicht angebunden (läuft im
  Simulationsmodus); der Maß-Solver rechnet bereits echt.
- **Punktwolken-Viewer (Potree)** – heute wird der Grundriss maßstäblich in 2D
  gezeichnet. Die Punktwolke ist die Realität, das hier gebaute Kern-Modell die
  planbare, prüfbare Struktur darüber; beide werden in der Verarbeitungsschicht
  zusammengeführt.
- **Fotorealismus (Splatting)** – Ausbaustufe aus Phase 2 des Konzepts
  (optionaler GPU-Burst).
- **Norm-Zahlen final absichern** – die Werte in `Regelwerk.kt` sind
  konservative Richtwerte mit Quellenangabe; wo Haftung berührt ist, gehören
  sie fachlich/normativ geprüft (Konzept §8, §14).

---

## Roadmap-Bezug

Der gebaute Stand entspricht dem Kern von **Phase 1 (MVP „Digitaler
Ortstermin")** – Grundriss, Klötzchen-Planung, Live-Prüfung, Report – und legt
zugleich das Fundament für den Differenzierer aus **Phase 3** (Komponenten-DB
und Normprüfung als pflegbare, versionierte Basis).
