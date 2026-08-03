# RAUMWERK-Pipeline (Schicht ②)

Die **Verarbeitungsschicht** aus dem RAUMWERK-Konzept: Aufnahmen und Lasermaße
gehen rein, ein **metrisch skaliertes** Ergebnis kommt heraus. Sie läuft auf dem
geteilten CPU-Server – gekapselt, ressourcenbegrenzt, mit einem einzelnen
Worker, damit sie andere Dienste nie aushungert (Konzept §6, §11).

Dies ist ein **lauffähiges Gerüst**: Die schweren Werkzeuge (COLMAP, OpenMVS)
sind als Stufen mit dokumentierten Kommandozeilen eingebaut, aber austauschbar.
Ohne sie läuft die Pipeline im **Simulationsmodus** vollständig durch und
liefert ein prüfbares Ergebnis. Der **Maß-Solver** ist immer echt gerechnet –
er ist der Kern der Genauigkeitsstrategie und braucht kein schweres Binary.

Reine Python-Standardbibliothek, keine Fremdabhängigkeiten.

---

## Die Stufen

```
Erfassung → SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik → Ergebnis
             │        │             │             │            │
          COLMAP   OpenMVS      echt (Laser-   Katalog-     regelbasiert
          (CPU)     (CPU)       Constraints)   Lookup
```

| Stufe | Real | Simulation |
|---|---|---|
| SfM | COLMAP (CPU-Modus) | Platzhalter-Posen, Anker aus Lasermaßen |
| Dichte Wolke | OpenMVS (CPU-Modus) | Demo-Punktwolke (`wolke.ply`) |
| **Maß-Solver** | **echt** (Ausgleichsrechnung) | **echt** |
| Komponenten | Katalog-Lookup | Katalog-Lookup |
| Semantik | regelbasiert (später ML) | regelbasiert |

**Maß-Solver:** Die Lasermaße gehen als harte Constraints in eine
Ausgleichsrechnung; der Maßstab folgt in geschlossener Form. Ein Anker wird als
**Kontrollmaß** zurückgehalten und liefert die reale Genauigkeitszahl je
Auftrag (Konzept §7). Freiräume werden **konservativ** ausgegeben (untere
Schranke) – dieselbe Regel wie `Pruefung.konservativ` im Kern.

---

## Starten

**Lokal (Simulationsmodus, ohne Docker):**

```bash
cd pipeline
python3 -m raumwerk_pipeline demo         # ein Beispiel-Auftrag, synchron
python3 -m raumwerk_pipeline serve 8781   # HTTP-API + Worker
python3 -m raumwerk_pipeline tools        # erkannte Werkzeuge anzeigen
```

**Tests:**

```bash
cd pipeline
python3 -m unittest discover -s tests -t .
```

**Docker (mit Ressourcengrenzen):**

```bash
cd pipeline
docker compose up --build
```

`docker-compose.yml` setzt harte CPU-/RAM-Grenzen (cgroups), einen einzelnen
Worker und optional ein Nacht-Zeitfenster.

---

## HTTP-API

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/jobs` | Auftrag anlegen (JSON: `name`, `laser[]`, `tags[]`, `auto?`) |
| `POST` | `/jobs/<id>/bild?name=…` | ein Bild hochladen (rohe Bytes) |
| `POST` | `/jobs/<id>/start` | Verarbeitung anstoßen (nach dem Upload) |
| `GET` | `/jobs` | alle Aufträge |
| `GET` | `/jobs/<id>` | Status + Ergebnis eines Auftrags |
| `GET` | `/jobs/<id>/result` | Ergebnis-Manifest |
| `GET` | `/jobs/<id>/bilder` | Liste der hochgeladenen Bilder |
| `GET` | `/jobs/<id>/wolke.ply` | die Punktwolke (für den Betrachter) |
| `GET` | `/healthz` | Bereitschaft + erkannte Werkzeuge |
| `GET` | `/` | kleine Statusseite |

Alle Antworten tragen CORS-Header, damit der Browser-Viewer (andere Herkunft)
das Ergebnis laden kann.

```bash
# Variante A: alles in einem Aufruf (Metadaten + Lasermaße, sofort rechnen)
curl -X POST localhost:8781/jobs -H 'Content-Type: application/json' \
     -d @beispiel-auftrag.json

# Variante B: erst anlegen, Bilder hochladen, dann starten
ID=$(curl -s -X POST localhost:8781/jobs -d '{"name":"…","auto":false,"laser":[…]}' | ...)
curl -X POST "localhost:8781/jobs/$ID/bild?name=IMG_001.jpg" --data-binary @IMG_001.jpg
curl -X POST "localhost:8781/jobs/$ID/start"
curl localhost:8781/jobs/$ID
```

---

## Ressourcen & Koexistenz (§11)

- **Container** mit CPU-/RAM-Limits (cgroups) über Compose; zusätzlich deckelt
  der Prozess den Adressraum je Kindprozess (`RLIMIT_AS`).
- **Ein Worker**, Jobs laufen nacheinander – nie parallel.
- **`nice` / `ionice`**: schwere Läufe bekommen die niedrigste CPU- und
  I/O-Priorität; mit `RAUMWERK_NACHT="22,6"` laufen sie nur nachts.
- **Eigener, unprivilegierter Nutzer** im Container.
- **Speicher-Lebenszyklus:** Roh- (Bilder) und Ergebnisdaten liegen unter
  `/daten`. 500 GB füllen sich schnell – Archiv-/Löschregeln früh festlegen.

Einstellbar per Umgebungsvariable: `RAUMWERK_DATEN`, `RAUMWERK_MAX_CPUS`,
`RAUMWERK_MAX_RAM_MB`, `RAUMWERK_NICE`, `RAUMWERK_IONICE`, `RAUMWERK_NACHT`,
`RAUMWERK_SIMULIEREN`.

---

## Was noch fehlt

- Echte Anbindung von COLMAP/OpenMVS (Kommandos stehen, Auslesen der Modell-
  Distanzen an den Ankerpunkten ist projektspezifisch).
- Registrierung mehrerer Räume/Wolken (CloudCompare) und Mehrraum-Ausrichtung.
- Dichter Betrachter im Browser (heute lädt die App die Wolke in einen
  leichten three.js-Viewer; für große Wolken wäre Potree der nächste Schritt).
