# RAUMWERK · Referenzblock 250 mm — Bau- und Druckkonzept

Der Referenzblock ist das einzige physische Zubehör des Systems. Er wird in den
Raum gestellt und übernimmt **drei Aufgaben gleichzeitig** (Konzept v2 §8):

| Aufgabe | Was er liefert |
|---|---|
| **Maßstab** | Seine bekannte Größe skaliert die Foto-Rekonstruktion metrisch. |
| **AR-Anker** | Er ist der Nullpunkt der Weltkoordinaten für die AR-Überlagerung. |
| **Ausrichtung** | Er definiert Lage und Drehung: oben, Nordung, Bodenbezug. |

Ein Block pro Raum genügt.

---

## 1. Warum codierte Marker und nicht die bloße Würfelform

Reine Form/Größe zu erkennen ist fehleranfällig: Ein Würfel sieht aus vielen
Blickwinkeln mehrdeutig aus, Kanten verschwinden vor hellen Wänden, und die
Drehung um die Hochachse ist aus der Form allein nicht bestimmbar.

Deshalb trägt **jede der sechs Flächen einen codierten Marker** der Familie
**AprilTag `tag36h11`**:

- 587 unterscheidbare Codes, **Mindest-Hamming-Abstand 11** → praktisch keine
  Falscherkennung an Fliesenfugen, Steckdosen oder Schriftzügen.
- **Bis zu 5 Bitfehler korrigierbar** — der Marker wird noch erkannt, wenn er
  teilweise verdeckt, verschmutzt oder halb im Schatten ist.
- In **OpenCV** enthalten (`cv2.aruco`, `DICT_APRILTAG_36h11`) — läuft auf dem
  Gerät **ohne ARCore**. Das ist der Grund für diese Wahl: auf dem gerooteten
  Fairphone mit LineageOS ist ARCore unzuverlässig, der Marker-Weg ist es nicht.
- Jede Fläche hat eine **eigene ID (0–5)** → die App weiß immer, welche Fläche
  sie sieht, und kennt damit die Drehung des Blocks eindeutig.

Sieht die Kamera eine Würfelecke, sind **drei Marker gleichzeitig** im Bild.
Zusammen mit der bekannten Würfelgeometrie ergibt das eine deutlich stabilere
Pose als ein einzelner flacher Marker.

> **Der Marker bleibt Papier — er wird nicht mitgedruckt.**
> Die Erkennung lebt von hartem Schwarz-Weiß-Kontrast und scharfen Kanten. Ein
> Laserdruck auf mattem Papier ist darin jedem Zweifarben-3D-Druck deutlich
> überlegen, kostet fast nichts und ist bei Verschmutzung in einer Minute
> ersetzt. Der 3D-Druck liefert die **Struktur**, das Papier die **Optik**.

---

## 2. Geometrie

Außenkante **250,0 mm**. Ein 250-mm-Würfel passt **nicht am Stück** auf einen
Drucker mit 250 × 250 × 250 mm Bauraum: es bliebe kein Spielraum für Brim, der
Bettrand ist selten perfekt eben, und ein massiver Würfel wäre absurd in
Material und Zeit. Deshalb ein **Rahmen aus Ecken und Streben mit eingelegten
Tafeln**:

```
        20 mm          210 mm           20 mm
      ┌───────┬────────────────────────┬───────┐
Ecke  │ Ecke  │        Strebe          │ Ecke  │   = 250,0 mm
      └───────┴────────────────────────┴───────┘
```

| Teil | Anzahl | Maße | Bemerkung |
|---|---|---|---|
| **Ecke** | 8 | 20 × 20 × 20 mm (mit 3 Zapfen, Hüllmaß 30 × 30 × 30) | Zapfen 10 × 10 × 10 mm |
| **Strebe** | 12 | 20 × 20 × 210 mm | Zapfloch beidseitig, 0,2 mm Spiel |
| **Tafel** | 6 | 210 × 210 × 3 mm | Vertiefung 190 × 190 × 0,4 mm für den Markerbogen |

**Größtes Einzelteil: 210 mm** — überall mindestens 20 mm Luft zum Bauraumrand.

### Ruhezone des Markers (kritisch für die Erkennung)

| Maß | Wert |
|---|---|
| Schwarzes Markerquadrat | **160,0 mm** (8 Module à 20,0 mm) |
| Weißrand auf dem Druckbogen | 15,0 mm |
| Weißer Rand der Tafel ringsum | 10,0 mm |
| **Ruhezone gesamt** | **25,0 mm = 1,25 Module** |

Gefordert ist mindestens **1 Modul**. Die Tafeln müssen deshalb in **Weiß**
gedruckt werden — der Rahmen darf jede Farbe haben.

---

## 3. Zwei Bauvarianten

### Variante A — Rahmen gedruckt, Tafeln aus Platte *(empfohlen)*

Nur Ecken und Streben werden gedruckt (20 Teile, klein). Die sechs Tafeln
werden aus **3 mm weißem PVC-Hartschaum** (Forex/Kapa, Baumarkt) auf
210 × 210 mm geschnitten — mit Cuttermesser und Anschlag in einer Viertelstunde.

- Filament: **≈ 550 g PETG** ≈ 12 €
- Platte 50 × 100 cm: ≈ 10 € (reicht für alle sechs Tafeln plus Reserve)
- **Druckzeit ≈ 12 h**

### Variante B — komplett gedruckt

Alle 26 Teile aus dem Drucker, keine Fremdmaterialien.

- Filament: **≈ 1,2 kg PETG** ≈ 26 €
- **Druckzeit ≈ 35–45 h**

> Die Kosten sind ähnlich; der Unterschied ist vor allem die **Druckzeit**.
> Wenn der Drucker ohnehin läuft, ist B bequemer. Wer schnell ein erstes
> Exemplar braucht, nimmt A.

---

## 4. Druckparameter

| Einstellung | Empfehlung | Begründung |
|---|---|---|
| **Material** | **PETG** | Erweicht erst ab ≈ 80 °C. PLA verzieht sich im sommerlichen Firmenwagen (dort werden leicht 60 °C erreicht) — genau das darf einem Maßnormal nicht passieren. |
| Farbe | Tafeln **weiß** (matt), Rahmen beliebig | Weiß ist Teil der Ruhezone. Kein glänzendes Filament. |
| Schichthöhe | 0,2 mm | |
| Wandlinien | 3 | |
| Füllung | 20–25 %, Gyroid | |
| Deck-/Bodenschichten | 4 / 4 | bei den Tafeln wichtig für eine geschlossene, ebene Fläche |
| Stützstrukturen | **keine** | bei richtiger Ausrichtung nicht nötig |
| Brim | 5 mm bei den Tafeln | gegen Ecken-Aufwölbung auf großer Fläche |

### Ausrichtung auf dem Bett

- **Tafeln:** flach liegend, Vertiefung nach oben. Die Bettseite wird die
  Rückseite — so ist die Markerseite die vom Drucker sauber geschlossene
  Oberseite und bleibt eben. **Ebenheit ist hier die wichtigste Eigenschaft.**
- **Streben:** liegend (Achse in X). Das Zapfloch bildet dabei eine
  10-mm-Überbrückung an der Oberseite — das schafft PETG ohne Stütze.
- **Ecken:** wie exportiert, große Fläche unten.

### Passung

Zapfen 10,0 mm, Loch 10,4 mm (0,2 mm Spiel je Seite). Fällt der Druck des
Kontakts enger oder weiter aus, im Slicer die **horizontale Maßkorrektur**
nutzen oder `SPIEL` im Generator anpassen — die Teile sind parametrisch.

---

## 5. Dateien im Projekt

| Datei | Inhalt |
|---|---|
| `tools/referenzblock_stl.py` | erzeugt `ecke.stl`, `strebe.stl`, `tafel.stl` (parametrisch) |
| `docs/referenzblock/stl/*.stl` | die fertigen Druckteile |
| `tools/referenzblock.py` | erzeugt die sechs Marker-Druckseiten |
| `docs/referenzblock/*.svg` | sechs A4-Seiten, je ein Marker (Vektor) |
| `docs/referenzblock/druck.html` | alle sechs Seiten als Druckbogen |

Beide Generatoren sind parametrisch: Kantenlänge, Profilstärke und Markergröße
stehen als Konstanten oben in der Datei.

**Geprüft:** Alle drei STL-Körper sind wasserdicht und liegen im Bauraum;
montiert ergibt sich exakt 250,0 mm. Alle sechs Marker wurden nach dem Rendern
mit dem echten OpenCV-Detektor zurückgelesen — korrekte IDs 0–5, gemessene
Kante 160,13 mm bei 160,0 mm Soll (+0,08 %).

---

## 6. Marker drucken — der wichtigste Handgriff

1. `docs/referenzblock/druck.html` im Browser öffnen und drucken.
2. Im Druckdialog **Skalierung auf 100 %** stellen, „An Seite anpassen"
   **ausschalten**, Rand „keine/minimal".
3. **Mattes** Papier (80–120 g normales Laserpapier ist gut). Kein Glanzpapier,
   **keine Glanzlaminierung** — Reflexe unter Baustellenlicht verhindern die
   Erkennung zuverlässiger als jeder Schmutz. Matte Laminierung ist in Ordnung.
4. Nach dem Druck das aufgedruckte **Kontrollmaß von 100,0 mm nachmessen**.

> **Das ist die häufigste Fehlerquelle im ganzen System.** Fast jeder Drucker
> skaliert per Voreinstellung um 2–4 % („fit to page"). Ein Marker, der statt
> 160,0 mm nur 155 mm groß ist, macht **jede** spätere Länge im Raum um 3 % zu
> groß — aus 4,00 m werden 4,12 m, und niemand sieht es dem Ergebnis an.
>
> Deshalb: Stimmt das Kontrollmaß nicht, entweder neu drucken **oder** die
> **tatsächlich gemessene Markerkante** in der App eintragen. Die App rechnet
> mit dem eingetragenen Wert, nicht mit dem Sollwert.

5. Bogen auf 190 × 190 mm schneiden und in die Tafelvertiefung kleben
   (Sprühkleber oder doppelseitiges Klebeband, vollflächig — Blasen und
   Wellen verziehen die Markerkanten).

---

## 7. Montage

1. Vier Streben und vier Ecken zum Bodenrahmen stecken.
2. Vier senkrechte Streben aufsetzen, oberen Rahmen ergänzen.
3. Tafeln von außen in die Rahmenöffnungen einlegen; sie sitzen in der
   Fuge zwischen den Profilen.
4. Reihenfolge der IDs: **0 = OBEN, 1 = VORN, 2 = RECHTS, 3 = HINTEN,
   4 = LINKS, 5 = UNTEN.** Der aufgedruckte Pfeil „OBEN" jeder Fläche muss
   im montierten Zustand nach oben zeigen.
5. Verbindungen bei gutem Sitz trocken lassen (dann bleibt der Block zerlegbar
   und die Tafeln tauschbar), sonst je Zapfen ein Tropfen Sekundenkleber.

**Keine Gummifüße, keine Filzgleiter.** Der Block definiert mit seiner
Unterseite die **Bodenebene** — jede Fußhöhe würde als systematischer
Höhenfehler in alle Montagehöhen eingehen. Die Unterseite bleibt plan.

Für mehr Standfestigkeit vor dem Schließen der letzten Tafel einen kleinen
Beutel Sand (300–500 g) hineinlegen. Das Gewicht ist unkritisch, weil es die
Maße nicht verändert.

---

## 8. Aufstellen im Raum

- **Auf den Boden**, nicht auf einen Tisch: die Unterseite ist die Bodenebene.
- Während der Rohbauphase steht der Block auf dem **Rohboden**. Der spätere
  Estrich/Belag wird in der App als Aufbauhöhe eingetragen; die App rechnet die
  Montagehöhen dann auf den **Fertigfußboden** um (Konzept v2 §10).
- Möglichst so, dass er **von den meisten Standpunkten aus sichtbar** ist —
  etwa 1 bis 1,5 m von den Wänden entfernt, nicht in einer Ecke.
- Bei mehreren Räumen: ein Block pro Raum, oder den Block umsetzen und für
  bewusste Überlappung zwischen den Aufnahmen sorgen.

---

## 9. Was das für die Genauigkeit heißt

Ehrlich eingeordnet (Konzept v2 §10, „physikalische Ehrlichkeit"):

- Der Block liefert den **Maßstab** und einen sehr gut bestimmten
  **Ankerpunkt** — dort ist die Genauigkeit am höchsten.
- Ein 160-mm-Marker ist mit einer 12-MP-Kamera weit über die übliche
  Raumdiagonale hinaus erkennbar. Die Grenze setzen in der Praxis
  **Bewegungsunschärfe und Licht**, nicht die Markergröße: lieber langsam
  schwenken und mehr Licht, als näher herangehen.
- Je weiter ein Punkt vom Block entfernt ist, desto stärker hängt seine
  Genauigkeit an der Rekonstruktion, nicht mehr am Marker. Die belastbaren
  Zahlen kommen weiterhin aus **Lasermaßen** und der Komponenten-Datenbank.
- Deshalb bleibt das Leitprinzip: **konservativ messen** — Freiräume als untere
  Schranke, gemessener Wert minus Toleranz.

---

## 10. Offener Punkt in der App

Die App fragt derzeit nach der **Würfelkante** (250 mm). Metrologisch maßgeblich
ist aber die **Markerkante** (160 mm), denn sie ist das, was die Kamera
tatsächlich vermisst — und sie ist es, die durch Druckskalierung abweichen kann.

Nächster Schritt: Im Scan-Bereich ein zusätzliches Feld **„Markerkante (mm)"**
mit Vorgabe 160,0 aufnehmen und den Wert in das Scan-Manifest schreiben, damit
die Pipeline mit der real gemessenen Größe rechnet statt mit dem Sollwert.
