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
| ① Erfassung (Feld) | Eigene App: Foto/Laser/Tags → Pipeline | **gebaut**: würfelfreies Aufmaß per Zielen/Bandmaß (`web/raumwerk/assistent.js`), Handy-App + APK; Foto-PWA (`web/aufnahme/`) |
| ② Verarbeitung (Server-CPU) | COLMAP → OpenMVS → Maß-Solver → Semantik | **Kette gebaut** (`pipeline/`), Simulation klar gekennzeichnet |
| **③ Viewer & Planung (Browser)** | **Messen · Klötzchen mit Abstandsprüfung · Varianten · Report** | **gebaut** (`web/raumwerk/`) |
| ✦ Fotorealismus (GPU-Burst) | Gaussian Splatting, nur bei Bedarf | offen (optional) |

Gebaut ist **Schicht ③** – die Schicht, in der das eigentliche Wertversprechen
sichtbar wird (Killer-Feature und USP) – zusammen mit dem **proprietären Kern**,
der sie trägt, und einer **Erfassung, die ohne Zusatzhardware funktioniert**:
kein Referenzwürfel, kein Laser, nur das Handy und – für den Maßstab – ein
Bandmaß (siehe „Aufmessen vor Ort“ unten und [AUFMASS.md](AUFMASS.md)).

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
gradle test        # 43 Tests, u. a. für Normprüfung und Zugausgleich
```

### Browser-App (Schicht ③)

`web/raumwerk/` – ein lauffähiges Planungswerkzeug ohne Fremdbibliothek
(ES-Module). Es setzt die Kernfunktionen des fertigen Viewers aus §3 um:

- **Gemessenen Raum erfassen** – mit dem **Aufmaß-Assistenten** (Zielen,
  Bandmaß-Zug, Rechteck; siehe unten), als Kurzform (Rechteck/Trapez) oder im
  **Polygonzug-Editor** mit laufender **Restlücke** (die Baureihenfolge aus
  `EINBAU.md`: der Polygonzug zuerst). Jede Wand weiß, woher ihr Maß stammt
  (Bandmaß, gezielt ± x cm, getippt); eine nachgemessene Wand wird fest, der
  Rest des Umrisses gleicht sich an.
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
- **Türen zwischen Räumen** – eine gemeinsame Verbindung (Tür/Durchgang) zu
  einem angrenzenden Raum; die abgeleitete Öffnung erscheint **in beiden
  Räumen**, im Gebäudeplan und begehbar in 3D. Das schließt die im Kern-README
  benannte Lücke „keine gemeinsame Wand" auf Gebäudeebene (`verbindung.js`).
- **3D-Ansicht** – die Räume als begehbares Modell (`modell3d.js`, three.js):
  umschauen, Räume im Raum schieben, in Augenhöhe hindurchgehen. three.js liegt
  lokal unter `web/lib/` (MIT) und wird erst beim Öffnen der Ansicht geladen;
  beim Verlassen wird das Modell abgebaut, damit es keinen Akku zieht.
- **Pipeline-Ergebnis laden** – Verbindung zur Verarbeitungs-Pipeline
  (Schicht ②): fertige Aufträge auflisten und die **metrische Punktwolke** im
  Browser (three.js, `wolke3d.js`) anzeigen – samt Maßstab und Kontrollmaß aus
  dem Manifest. Alternativ eine PLY-Datei öffnen. Das schließt den Kreis von
  der Server-Verarbeitung zurück in den Betrachter.
- **AR-Elektroplanung vor Ort** (`ar.js`) – am PC den Plan zeichnen (wo kommt
  welche Steckdose, welcher Schalter, welche Leuchte hin, auf welcher Höhe),
  dann auf der Baustelle über das echte Kamerabild legen und mit dem Kunden
  setzen:
  · **Einbauten setzen:** Art aus der Palette wählen, auf die Wand tippen – der
    Einbau rastet an die Wand, auf DIN-Höhe. Antippen wählt, Wand antippen
    verschiebt. Ein Regler stellt die **Höhe** ein (Anzeige „… cm über fertigem
    Boden"). Wo ein Einbau hinkommt, trifft das Fadenkreuz Wand, Decke oder
    Boden des Raummodells.
  · **Estrich/Bodenaufbau** (`raum.aufbauM`): Höhen zählen ab dem *fertigen*
    Boden. Der fertige Boden liegt als Ebene über dem Rohboden, jeder Einbau
    sitzt um den Aufbau höher als im nackten Kamerabild – der noch fehlende
    Estrich ist eingerechnet.
  · **Ausrichten ohne Würfel:** zwei Bodenecken einer bekannten Wand anzielen –
    daraus folgen Standpunkt, Drehung und die Kamerahöhe (`web/ausrichten.js`,
    mit demselben Kameramodell wie das Aufmaß). Von Hand einstellbar; unter
    WebXR kommt die Lage vom Gerät.
  · **Geräte-Klötzchen** als Kontext mit **Live-Normprüfung** (Freiraumzone
    grün/rot).
  Hauptweg ist ein **Magic-Window** (Kamera + Geräteausrichtung, **ohne
  ARCore** – ARCore ist auf dem gerooteten Feldgerät unzuverlässig, §5); wo
  verfügbar, lässt sich auf **WebXR**-Welttracking aufwerten. Braucht Kamera
  und einen sicheren Kontext (localhost/HTTPS).
- **PDF-Report** – die gewählte Variante als druckbares Dokument, inklusive
  Maß-Herkunft und konservativer Rundungsregel.

Persistenz über `localStorage` – kein Server nötig, offline- und
kundenlink-tauglich, wie im Konzept vorgesehen.

### Aufmessen vor Ort (Schicht ①)

Der Aufmaß-Assistent (`web/raumwerk/assistent.js`, auf Handy und PC gleich)
bietet drei Wege, je nachdem, was vor Ort zur Hand ist:

- **Zielen** – Kamera mit Fadenkreuz, das Handy der Reihe nach auf die
  Bodenecken richten; aus Neigung und Richtung folgen die Ecken. Ein
  Kontrollschuss auf die erste Ecke misst die Kreiseldrift, ein
  „Wende“-Paar kalibriert einmal je Gerät den Neigungsfehler. Danach Decke
  (Raumhöhe), Türen/Fenster (Unter- und Oberkante) und Einbauten anzielen.
  Ein eingetipptes Bandmaß setzt den Maßstab; die Ausgleichsrechnung
  (`web/raumaufnahme.js`) schätzt Kamerahöhe, Linsenabstand und
  Neigungsfehler mit und gibt für jede Wand ± cm und für den Raum eine Klasse
  aus. Mit zwei Bandmaßen liegt ein Rechteckraum in der Simulation bei
  wenigen Millimetern (Tabelle in [AUFMASS.md](AUFMASS.md)).
- **Bandmaß-Zug** – Wandlängen und Abbiegungen eintippen; ein Ausgleich
  verteilt die Restlücke auf die nicht gemessenen Wände.
- **Rechteck** – Breite, Tiefe, Höhe.

Das Ergebnis wird mit Maß-Herkunft übernommen (`uebernahme.js`); die
Rohdaten der Aufnahme bleiben im Projekt, sodass ein später nachgemessenes
Bandmaß den ganzen Raum neu rechnet. Von Hand geänderte oder gelöschte Türen,
Fenster und Einbauten bleiben dabei, wie sie sind. „Neu aufmessen“ ersetzt
alles, was aus einer früheren Zielaufnahme stammt (auch Nachgebessertes);
reine Handeinträge bleiben. Höhen zählen ab Fertigfußboden, auch wenn der
Estrich noch fehlt (`raum.aufbauM`).

Nachgewiesen wird der ganze Ablauf durch einen **Feldtest im echten Browser**
(`web/tests/e2e/feld.e2e.mjs`, Playwright, in der CI): simulierte Lagesensorik
mit realistischem Neigungsfehler und Kreiseldrift, Kalibrierung, sechs Ecken,
Raumhöhe, Tür, Fenster, Steckdose, zwei Bandmaße → Klasse AUFMASS, Fläche und
Höhen auf 2 cm; dazu Bandmaß-Raum, Nachmessen, Bericht und PC-Ansicht.

### Aufnahme-App (Schicht ①, Foto-PWA)

`web/aufnahme/` – eine schlanke, installierbare **PWA** für die Erfassung vor
Ort: Fotos über die Kamera (`getUserMedia`), **Lasermaße** manuell eintippen
(ein Bluetooth-Laser kann sie später liefern, §18) und Objekte **taggen**. Ein
Klick sendet alles an die Pipeline – Auftrag anlegen → Bilder hochladen →
starten. Ein Service Worker macht die Hülle offline-startbar („im Keller ohne
Netz", §5); gesendet wird, sobald wieder Netz da ist. Es wird nichts vor Ort
gerechnet – nur erfasst und hochgeladen (§6.1).

### Plattformen: Web, PWA, native Apps

Eine Codebasis, drei Auslieferungen:

- **Web** – die App läuft im Browser (Kundenlink), nichts zu installieren.
- **PWA** – dieselbe App ist **installierbar** (`web/raumwerk/manifest.webmanifest`
  + Service Worker): auf Android und iOS „zum Startbildschirm hinzufügen" →
  eigenständige App, offline-startbar (App-Hülle wird gecacht).
- **Native Apps (Android + iOS)** – dünne Hüllen um dieselbe Web-App via
  **Capacitor** (`native/`). Store-fähig, und Kamera/AR laufen ohne
  HTTPS-Aufwand, weil die WebView ein sicherer Kontext ist. Wahlweise die
  Web-App gebündelt (offline) oder eine gehostete Weboberfläche „live
  verlinkt". Details: `native/README.md`.

Damit ist das Konzept-Ziel „im Browser öffenbar, plattformübergreifend
(Android zuerst, iOS später)" erfüllt – ohne Code zu doppeln.

Hinweis zur Ausrichtung: RAUMWERK ist ein **allgemeines** Aufmaß-,
Dokumentations- und Planungssystem (Räume, Messen, Varianten, 3D, Punktwolke,
Verbindungen). Die **Elektro-Installationsplanung** (Einbauten mit Höhen,
Estrich-Bezug, AR vor Ort) ist eine **Domäne** davon – die erste, weil sie den
klarsten Nutzen zeigt, aber nicht die einzige.

### Verarbeitungs-Pipeline (Schicht ②, Gerüst)

`pipeline/` – ein lauffähiges, getestetes Server-Gerüst (Python-Standard-
bibliothek, keine Fremd-Deps) für die Photogrammetrie-Verarbeitung:

- **Job-Queue mit einem Worker**, `nice`/`ionice`, optionales Nacht-Fenster
  (§11: Koexistenz auf dem geteilten Server).
- Die Stufen **SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik**;
  real via COLMAP/OpenMVS (Kommandos dokumentiert) oder im **Simulationsmodus**,
  sodass alles ohne die schweren Binaries end-to-end durchläuft.
- Der **Maß-Solver** ist echt gerechnet: Modellabstände kommen aus der
  Rekonstruktion, **ein** bekanntes Maß genügt (Laser, Wand, Raum- oder
  Kamerahöhe); ein weiteres dient als Kontrollmaß (§7). Alles, was aus dem
  Simulationsmodus stammt, trägt `"simuliert": true` – der Betrachter zeigt
  das deutlich an und meldet dort kein Kontrollmaß.
- **Raumvorschlag** aus eingegebenen Wandlängen (Python-Spiegel des
  Polygonzugs), im Betrachter mit einem Klick übernehmbar.
- **Bild-Upload** (`POST /jobs/<id>/bild`) und **Ergebnis-Auslieferung**
  (`/jobs/<id>/result`, `/jobs/<id>/wolke.ply`, mit CORS) – der Betrachter lädt
  das Ergebnis direkt.
- **Docker** mit CPU-/RAM-Limits (cgroups), HTTP-API, Tests.

```
cd pipeline
python3 -m unittest discover -s tests -t .   # 67 Tests
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

- **Erfassung** (Schicht ①) – das würfelfreie Aufmaß steht und ist in
  Simulation und Browser-Feldtest nachgewiesen; **ein Abgleich mit echten
  Geräten und echten Räumen steht noch aus** (Sensorrauschen und
  Neigungsfehler realer Handys können von den Annahmen abweichen – die
  Klassen und ± cm sind darauf ausgelegt, das ehrlich zu zeigen). Offen
  bleiben die Anbindung eines Bluetooth-Lasers und Video-/IMU-Erfassung.
- **Echte Photogrammetrie** (Schicht ②) – die COLMAP/OpenMVS-Kette ist
  angebunden, aber noch nicht an echten Bildserien erprobt; ohne die Binaries
  läuft die Pipeline im (gekennzeichneten) Simulationsmodus.
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
