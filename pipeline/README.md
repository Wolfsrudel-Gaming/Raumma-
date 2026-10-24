# RAUMWERK-Pipeline (Schicht ②)

Die **Verarbeitungsschicht** aus dem RAUMWERK-Konzept: Aufnahmen und bekannte
Längen gehen rein, ein **metrisch skaliertes** Ergebnis kommt heraus. Sie läuft
auf dem geteilten CPU-Server – gekapselt, ressourcenbegrenzt, mit einem
einzelnen Worker, damit sie andere Dienste nie aushungert (Konzept §6, §11).

Reine Python-Standardbibliothek, keine Fremdabhängigkeiten.

---

## Ehrlicher Stand

| Teil | Stand | Getestet |
|---|---|---|
| Job-Queue, ein Worker, HTTP-API, Lebenszyklus | **echt** | ja (Unit + HTTP-Rundlauf) |
| Raumvorschlag aus Bandmaß-Zug (`raum`) | **echt** – reine Geometrie aus den eingegebenen Wandlängen/Drehungen | ja, inkl. Parität mit `web/geometrie.js` (über `node`) |
| Maß-Solver (Rechnung) | **echt** – ab **einer** bekannten Länge | ja |
| Modellabstände für den Maß-Solver | **echt nur im echten Modus**: aus der Rekonstruktion gelesen (Koordinaten, Punkt-IDs, Bildpunkte, Kamerahöhe über Bodenpunkten). In der Simulation erzeugt (Länge ÷ 0,37) und als `simuliert` markiert | ja (nachgebautes COLMAP-Modell, Text + binär) |
| Kontrollmaß (Genauigkeitszahl §7) | **echt nur im echten Modus mit ≥ 2 Maßen**; sonst `null` + Begründung | ja |
| SfM (COLMAP) | Kommandos stehen (inkl. `model_converter`) | **nicht im CI** – nur gegen nachgebaute Werkzeug-Ausgaben |
| Dichte Wolke (OpenMVS) | `image_undistorter` → `InterfaceCOLMAP` → `DensifyPointCloud` → ASCII-`wolke.ply` | **nicht im CI** – Umwandlung binär→ASCII getestet |
| Dichte Wolke in der Simulation | **Demo-Quadrat 4 × 4**, im PLY-Kopf und in `result.json` als simuliert markiert | ja |
| Komponenten-Zuordnung | echter Katalog-Lookup (3 Einträge) | ja |
| Elektro-Semantik | eine Regel (Zählerschrank → VDE 0100-729) | ja |

**Simulation ist überall gekennzeichnet:** `result.json` und `massstab.json`
tragen dann `"simuliert": true` und `"hinweis": "Simulation – keine echte
Messung"`, ebenso `sfm`, `wolke` und `viewer`; die Demo-Wolke trägt es als
`comment` im PLY-Kopf. Ein Kontrollmaß wird in der Simulation **nicht** als
Genauigkeitszahl gemeldet (`kontrollmass_abweichung_mm: null`); der Demo-Wert
steht separat unter `kontrollmass_abweichung_mm_simuliert`.

**Echter Modus erfindet nichts:** Fehlen Modellpunkte, scheitert der Auftrag
vor der teuren Rechnung mit „Modellabstände fehlen – Laser-Constraints brauchen
Modellpunkte …". Einzelne nicht auflösbare Punkte werden mit Grund in
`hinweise` genannt.

**Was noch fehlt:** Die Aufnahme-Apps schicken heute nur Längen, noch keine
Modellpunkte. Für den echten Modus braucht es eine Oberfläche, in der man die
Endpunkte eines Maßes in einem Foto antippt (`{"bild": …, "px": [u, v]}`) –
der Server löst das dann selbst über die Rekonstruktion auf.

---

## Maßstab ohne Würfel: eine bekannte Länge reicht

Die Rekonstruktion hat keine Einheit. Jede bekannte Länge, deren Endpunkte im
Modell zu finden sind, legt den Maßstab fest:

```
Maßstab [m je Modelleinheit] = bekannte Länge [m] / Abstand im Modell
```

| bekannte Längen | Ergebnis |
|---|---|
| 0 | Fehler im Klartext („Kein bekanntes Maß – … genügt eine einzige bekannte Länge …") |
| 1 | Maßstab; **kein** Kontrollmaß (`null` + Hinweis „Nur ein bekanntes Maß …") |
| ≥ 2 | Maßstab aus allen außer einem; das zurückgehaltene (`"kontrolle": true`, sonst das letzte) ist das **Kontrollmaß** |
| ≥ 4 im Maßstab | zusätzlich robuste Ausreißerprüfung (Median der Einzelmaßstäbe) |

Bekannte Längen können sein: ein **Lasermaß**, ein **Bandmaß** (Wand oder
beliebige Strecke), die **Raumhöhe** oder die **Kamerahöhe über dem Boden**
(Abstand der Kamerazentren zur Ebene durch ≥ 3 Bodenpunkte).

---

## Eingabe eines Auftrags

```json
{
  "name": "Technikraum",
  "auto": true,
  "laser": [
    { "von": "A", "bis": "B", "distanzM": 4.20,
      "modell_a": { "punkt3d": 1234 }, "modell_b": { "bild": "IMG_001.jpg", "px": [812, 455] } },
    { "von": "A", "bis": "C", "distanzM": 5.16, "kontrolle": true,
      "modell_a": [0.12, 1.5, -3.2], "modell_b": [4.8, 1.4, -2.9] }
  ],
  "bekannte_laengen": [
    { "art": "wand", "laenge": 4.20, "drehung": 90 },
    { "art": "wand", "laenge": 3.00, "drehung": 90 },
    { "art": "wand", "laenge": 4.20, "drehung": 90 },
    { "art": "wand", "laenge": 3.00, "drehung": 90 },
    { "art": "raumhoehe", "laenge": 2.50 },
    { "art": "kamerahoehe", "laenge": 1.45, "boden": [11, 12, 13], "bild": "IMG_001.jpg" }
  ],
  "tags": [ { "art": "ZAEHLERSCHRANK" } ]
}
```

- **Modellpunkt** (`modell_a`/`modell_b`, Einträge in `boden`): `[x, y, z]` im
  Modell, eine COLMAP-Punkt-ID (`1234` oder `{"punkt3d": 1234}`) oder ein
  Bildpunkt `{"bild", "px": [u, v], "radius_px"?}` – aufgelöst über den
  nächsten rekonstruierten Merkmalspunkt in diesem Foto (Vorgabe ≤ 10 px).
- **`art`**: `wand` (Teil des Polygonzugs; mit `drehung` in Grad, positiv =
  rechts – wie im Aufmaß-Assistenten), `strecke`, `raumhoehe`, `kamerahoehe`.
  Ohne `art` gilt: mit `drehung` → `wand`, sonst `strecke`. Statt `laenge` geht
  auch `laengeM`.
- **Raumvorschlag** (`raum` in `result.json`): entsteht **nur**, wenn ≥ 3
  Wände mit Länge **und** Drehung angegeben sind – im Schema des
  Aufmaß-Assistenten (`methode: "band"`, `umriss`, `breiteM`, `tiefeM`,
  `hoeheM`, `waende[{laenge, quelle, sigmaM}]`), gerechnet mit demselben
  Polygonzug wie `web/geometrie.js` (`geometrie.py` ist der Spiegel). Schließt
  der Zug nicht, wird die Schlusswand ergänzt und als `getippt` markiert.
  Fehlt eine Drehung, gibt es keinen Raum – geraten wird nicht.

Ohne Modellpunkte funktioniert alles im **Simulationsmodus**; im echten Modus
sind sie Pflicht.

---

## Die Stufen

```
Raum → Eingabe → SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik → Ergebnis
 │        │        │        │              │             │            │
Polygon- früh    COLMAP  COLMAP-Entzerr. bekannte     Katalog-     regelbasiert
zug     scheitern (CPU)  + OpenMVS (CPU) Längen ↔     Lookup
                                         Modellpunkte
```

Echter Lauf (`tools.py`), alle Pfade absolut, gedrosselt mit `nice`/`ionice`
und `RLIMIT_AS`, Ausgaben in `werkzeuge.log`:

1. `colmap feature_extractor` / `exhaustive_matcher` / `mapper` → `sparse/0`
2. `colmap model_converter --output_type TXT` → `sparse/0/*.txt` (der Solver
   liest Text oder binär)
3. `colmap image_undistorter … --output_type COLMAP` → `dense/`
4. `InterfaceCOLMAP -i dense -o szene.mvs --image-folder dense/images`
5. `DensifyPointCloud szene.mvs` → `szene_dense.ply` (binär, bleibt liegen)
6. Umwandlung → **`wolke.ply` (ASCII)** für den Browser-Betrachter, bei mehr
   als `RAUMWERK_MAX_WOLKE_PUNKTE` (Vorgabe 300 000) gleichmäßig ausgedünnt.
   Die Wolke bleibt in **Modelleinheiten**; der Maßstab steht in
   `massstab.skala_m_je_einheit`.

Gebraucht werden `colmap`, `InterfaceCOLMAP` und `DensifyPointCloud`.
CloudCompare wird nur angezeigt, nicht benutzt. Die Optionsnamen entsprechen
COLMAP 3.7–3.11 und OpenMVS 2.x – **gegen echte Binaries ist das nicht im CI
geprüft**; ein erster Lauf auf dem Server ist der Abnahmetest.

---

## Starten

```bash
cd pipeline
python3 -m raumwerk_pipeline demo              # Beispiel-Auftrag (Laser + Bandmaß-Zug)
python3 -m raumwerk_pipeline demo ein-mass     # nur eine Kamerahöhe – kein Laser, kein Würfel
python3 -m raumwerk_pipeline serve 8781        # HTTP-API + Worker
python3 -m raumwerk_pipeline tools             # erkannte Werkzeuge anzeigen
```

**Tests** (Python ≥ 3.11; der Paritätstest mit `web/geometrie.js` läuft, wenn
`node` installiert ist, sonst wird er übersprungen):

```bash
cd pipeline
python3 -m unittest discover -s tests -t .
```

**Docker (mit Ressourcengrenzen):**

```bash
cd pipeline
docker compose up --build
```

---

## HTTP-API

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/jobs` | Auftrag anlegen (JSON siehe oben). `auto:false` → Zustand `angelegt`, rechnet erst nach `/start` |
| `POST` | `/jobs/<id>/bild?name=…` | ein Bild hochladen (rohe Bytes); Namen `.`, `..`, leer, mit `/`, `\` oder NUL → **400** |
| `POST` | `/jobs/<id>/start` | (neu) rechnen: setzt auf `wartet`, verwirft das alte Ergebnis; während `laeuft` → **409** |
| `GET` | `/jobs` | alle Aufträge |
| `GET` | `/jobs/<id>` | Status + Ergebnis eines Auftrags |
| `GET` | `/jobs/<id>/result` | Ergebnis-Manifest (`massstab.skala_m_je_einheit`, `massstab.kontrollmass_abweichung_mm`, `raum`, `simuliert`, `hinweise` …) |
| `GET` | `/jobs/<id>/bilder` | Liste der hochgeladenen Bilder |
| `GET` | `/jobs/<id>/wolke.ply` | die Punktwolke als ASCII-PLY (für den Betrachter) |
| `GET` | `/healthz` | Bereitschaft, erkannte und benötigte Werkzeuge |
| `GET` | `/` | kleine Statusseite (zeigt den Simulationsmodus an) |

Zustände: `angelegt` → `wartet` → `laeuft` → `fertig` | `fehler`. Nach einem
Neustart des Servers werden `wartet`-Aufträge eingereiht, unterbrochene
(`laeuft`) von vorn gerechnet, `angelegt` bleibt liegen. Fehler kommen immer
als JSON `{"fehler": …}` – nie als abgerissene Verbindung. Alle Antworten
tragen CORS-Header.

```bash
# Variante A: alles in einem Aufruf (Metadaten + Längen, sofort rechnen)
curl -X POST localhost:8781/jobs -H 'Content-Type: application/json' \
     -d @beispiel-auftrag.json

# Variante B: erst anlegen, Bilder hochladen, dann starten
ID=$(curl -s -X POST localhost:8781/jobs -d '{"name":"…","auto":false,"laser":[…]}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -X POST "localhost:8781/jobs/$ID/bild?name=IMG_001.jpg" --data-binary @IMG_001.jpg
curl -X POST "localhost:8781/jobs/$ID/start"
curl localhost:8781/jobs/$ID/result
```

---

## Ressourcen & Koexistenz (§11)

- **Container** mit CPU-/RAM-Limits (cgroups) über Compose; zusätzlich deckelt
  der Prozess den Adressraum je Kindprozess (`RLIMIT_AS`).
- **Ein Worker**, Jobs laufen nacheinander – nie parallel.
- **`nice` / `ionice`**: schwere Läufe bekommen die niedrigste CPU- und
  I/O-Priorität; mit `RAUMWERK_NACHT="22,6"` laufen sie nur nachts.
- **Früh scheitern:** Fehlt ein bekanntes Maß oder (im echten Modus) jeder
  Modellbezug, bricht der Auftrag ab, **bevor** COLMAP startet.
- **Eigener, unprivilegierter Nutzer** im Container.
- **Speicher-Lebenszyklus:** Roh- (Bilder) und Ergebnisdaten liegen unter
  `/daten`. Ein Neustart eines Auftrags löscht dessen abgeleitete Dateien
  (Wolke, `sparse/`, `dense/` …), die Bilder bleiben. 500 GB füllen sich
  schnell – Archiv-/Löschregeln früh festlegen.

Einstellbar per Umgebungsvariable: `RAUMWERK_DATEN`, `RAUMWERK_MAX_CPUS`,
`RAUMWERK_MAX_RAM_MB`, `RAUMWERK_NICE`, `RAUMWERK_IONICE`, `RAUMWERK_NACHT`,
`RAUMWERK_SIMULIEREN`, `RAUMWERK_MAX_WOLKE_PUNKTE`.

---

## Was noch fehlt

- **Ein echter Lauf mit COLMAP/OpenMVS** auf dem Zielserver (Abnahmetest der
  Kommandozeilen; im CI sind die Binaries nicht installiert).
- **Modellpunkte aus der Aufnahme:** Antippen der Maß-Endpunkte im Foto
  (Bildpunkte) in der Aufnahme-App; Marker-Erkennung (z. B. ArUco) gibt es
  nicht.
- Automatische Bodenebene (heute: Bodenpunkte angeben) und metrische Wolke
  (heute: Modelleinheiten + Maßstab).
- Registrierung mehrerer Räume/Wolken (CloudCompare) und Mehrraum-Ausrichtung.
- Dichter Betrachter im Browser (heute lädt die App die Wolke in einen
  leichten three.js-Viewer; für große Wolken wäre Potree der nächste Schritt).
