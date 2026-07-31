# Aufmaß-Kern

Ein Baukasten, um Räume aufzumessen, zu zeichnen und begehbar zu machen.

Er entstand als Teil eines Verwaltungswerkzeugs für einen DRK-Ortsverein und
ist hier herausgelöst, um als Grundlage für ein eigenständiges Aufmaßsystem zu
dienen. Alles Fachliche ist enthalten, alles Projektspezifische nicht.

---

## RAUMWERK

Auf diesem Kern baut **RAUMWERK** auf – das digitale Aufmaß- und
Planungssystem aus dem Konzeptpapier. Umgesetzt ist die **Viewer- und
Planungsschicht** samt proprietärem Kern:

- **Komponenten-DB, Regelwerk und Normprüfung** (Kotlin, getestet):
  `Komponente.kt`, `Regelwerk.kt`, `Pruefung.kt` – die parametrischen
  „Klötzchen" mit echten Baumaßen, die versionierte VDE/DIN-Regelbasis und die
  aktive Freiraum-/Normprüfung mit konservativer unterer Schranke.
- **Browser-App** unter `web/raumwerk/`: Grundriss mit Wandnummern,
  Klötzchen setzen/ziehen mit **Live-Abstands- und Normprüfung**, Messen,
  Varianten-Vergleich und PDF-Report.

```
gradle test                                   # Kern inkl. Normprüfung (38 Tests)
cd web && python3 -m http.server 8099         # dann: http://localhost:8099/raumwerk/
```

Details, Konzept-Zuordnung und was bewusst noch fehlt: **[docs/RAUMWERK.md](docs/RAUMWERK.md)**.

---

## Was drin ist

| Teil | Datei | Zweck |
|---|---|---|
| Datenmodell | `src/main/kotlin/.../Modell.kt` | Raum, Öffnung, Einbau |
| Geometrie | `src/main/kotlin/.../Geometrie.kt` | Ecken, Fläche, Wände, Wandzerlegung, Lage |
| Aufmaß | `src/main/kotlin/.../Aufmass.kt` | Polygonzug, Prüfungen, Aufmaßliste |
| Normmaße | `src/main/kotlin/.../Normmasse.kt` | Katalog, Einbauhöhen, Türmaße |
| Platzierung | `src/main/kotlin/.../Platzierung.kt` | Anlegen am Nachbarn, Einrasten, Geschosse |
| Tests | `src/test/kotlin/…` | 30 Tests, zugleich die Fallsammlung |
| Schema | `sql/schema.sql` | PostgreSQL-Tabellen |
| Geometrie (Web) | `web/geometrie.js` | Spiegel der Kotlin-Geometrie fürs Frontend |
| Schaltzeichen | `web/symbole.js` | Technische Zeichen für den Grundriss |
| 3D-Modell | `web/modell3d.js` | Begehbares Modell (three.js) |

**Abhängigkeiten:** Der Kotlin-Kern braucht **nur** die Kotlin-Standard-
bibliothek. Kein Spring, kein Jackson, keine Geometrie-Bibliothek. Das
Web-Modul `modell3d.js` braucht three.js (MIT), sonst nichts.

Der schnellste Weg zum Verständnis: `src/test/kotlin` lesen. Die Tests
beschreiben die Fälle, die beim Aufmessen tatsächlich vorkommen.

```
./gradlew test        # oder: gradle test
```

---

## Die Grundgedanken

### 1. Aufgenommen wird, was gemessen wird

Niemand kennt vor Ort die Koordinate einer Ecke. Man kennt **Wandlängen** und
**Abbiegungen**. Deshalb ist der Polygonzug (`Aufmass.zug`) die primäre
Erfassungsform: eine Zeile je Wand, Länge und Drehung an der Ecke danach.

```kotlin
Aufmass.zug(listOf(
    Aufmass.Wand(6.0,  90.0),   // 6,00 m, dann rechts
    Aufmass.Wand(2.0,  90.0),
    Aufmass.Wand(0.8, -90.0),   // Verkofferung: 0,80 m, dann links
    Aufmass.Wand(2.0,  90.0),
    Aufmass.Wand(5.2,  90.0),
    Aufmass.Wand(4.0,  90.0)
))
// → 6 Ecken, 22,4 m², geschlossen
```

### 2. Die Restlücke ist die Qualitätsaussage

Ein Zug, der sich nicht schließt, enthält einen Messfehler. `Zug.restlueckeM`
sagt, wie groß er ist. Der Kern schließt den Zug trotzdem – aber nie
stillschweigend. **Diese Zahl gehört in jede Oberfläche.** Sie ist der einzige
Selbstkontrollmechanismus, den ein Aufmaß hat.

### 3. Fläche ist nicht Breite × Tiefe

Für jedes Vieleck gilt die Gaußsche Trapezformel, für das Trapez die
Mittellinie. Wer mit Breite × Tiefe rechnet, bestellt zu viel Bodenbelag.
`Geometrie.flaecheM2` macht das richtig, ohne dass der Aufrufer nachdenken muss.

### 4. Eine Tür ist ein Loch in der Wand, kein Symbol darauf

`Geometrie.wandStuecke` zerlegt eine Wand in das, was nach Abzug der Öffnungen
stehen bleibt: volle Wand daneben, Brüstung unter dem Fenster, Sturz darüber.
Erst dadurch entsteht ein Modell, durch das man gehen kann.

### 5. Richtwerte helfen, Vorschriften wären falsch

`Normmasse` kennt die üblichen Einbauhöhen (DIN 18015-3) und Türmaße
(DIN 18101). Sie sind **Vorschläge**. Im Bestand sitzt vieles anders, und das
ist kein Mangel – ein Gebäude ist meist älter als die aktuelle Fassung der
Norm. Jeder Wert ist einzeln überschreibbar, und ein einmal gesetzter Wert
wird nie überschrieben.

### 6. Nachsichtig lesen, deutlich melden

Ein kaputter Umriss macht keinen Raum unsichtbar – er fällt auf das Rechteck
zurück (`Geometrie.umrissLesen` gibt `null` statt zu werfen). Auffälligkeiten
meldet `Aufmass.pruefen` als Liste von Sätzen, nicht als Ausnahme. Der Mensch
entscheidet, was ein Fehler ist.

---

## Koordinaten und Zählweise

**Raumkoordinaten:** Ursprung linke obere Ecke des umschließenden Rechtecks,
x nach rechts, y nach hinten, Einheit Meter.

y zeigt **nach unten** – wie in jedem Grundriss und in SVG. Ungewohnt aus der
Mathematik, aber es sorgt dafür, dass Bildschirm, Ausdruck und gespeicherte
Zahl dasselbe meinen. Eine Drehung „nach rechts" ist deshalb eine Drehung mit
**positivem** Winkel.

**Ecken und Wände:** Ecken laufen im Uhrzeigersinn. Wand *i* verläuft von
Ecke *i* zur nächsten. Bei einem Viereck ist damit

```
        Wand 0 (vorne)
   0 ─────────────────► 1
   ▲                    │
   │ Wand 3      Wand 1 │
   │ (links)   (rechts) ▼
   3 ◄───────────────── 2
        Wand 2 (hinten)
```

`abstandM` misst immer von Ecke *i* aus an der Wand entlang. Bei mehr als vier
Ecken werden Wände nur noch durchnummeriert (`Geometrie.wandName`).

**Geschosse:** 0 = Erdgeschoss, negativ = Untergeschoss.
`Platzierung.geschossBasis` stapelt sie automatisch über der jeweils höchsten
Decke darunter.

---

## Datenmodell in Kurzform

**Raum** hat zwei sich ausschließende Formbeschreibungen:

1. `umriss` gesetzt → freies Vieleck, `[[x,y],…]` im Uhrzeigersinn
2. `umriss` leer → Rechteck/Trapez aus `breiteM`, `breiteVorneM`, `tiefeM`,
   `schraege`

Beides landet über `Geometrie.ecken` bei derselben Eckenliste. `breiteM` und
`tiefeM` werden auch bei gesetztem Umriss weitergeführt – sie beschreiben dann
das umschließende Rechteck und werden für Lage, Einrasten und Vorschau
gebraucht.

**Öffnung** hängt an `wandIndex` + `abstandM` + `breiteM` + `hoeheM` +
`bruestungM`.

**Einbau** kennt vier Befestigungen:

| Befestigung | Lage über |
|---|---|
| `WAND` | `wandIndex`, `abstandM`, `hoeheM` |
| `DECKE` | `relX`/`relY`, Höhe = Raumhöhe |
| `BODEN` | `relX`/`relY`, Höhe 0 |
| `FREI` | `relX`/`relY`, Höhe wie erfasst |

`relX`/`relY` sind Anteile (0…1) des umschließenden Rechtecks, keine Meter.
Damit bleibt die Lage erhalten, wenn ein Raum nachträglich anders vermessen
wird.

`art` ist bewusst ein `String`, keine Aufzählung: Welche Gerätearten es gibt,
ist eine fachliche Festlegung, die man ohne Schemaänderung erweitern können
muss. Der mitgelieferte Katalog steht in `Normmasse.arten`.

---

## Die Doppelung Kotlin ↔ JavaScript

`Geometrie.kt` und `web/geometrie.js` rechnen dasselbe. Das ist bewusst so und
kein Versehen:

* Der **Editor** muss reagieren, während noch getippt wird. Ein Rundruf zum
  Server je Ziffer wäre weder schnell noch offline-tauglich.
* Der **Server** muss dieselben Zahlen liefern, wenn er einen Plan als PDF
  ausgibt oder eine Flächenliste exportiert.

**Regel:** Die Kotlin-Tests sind verbindlich, die JS-Datei folgt ihnen. Wer
eine Formel ändert, ändert beide Stellen und passt den Test an. Wer die
Doppelung loswerden will, hat zwei Wege: den Kern nach Kotlin/Multiplatform
oder nach WASM übersetzen, oder die Geometrie ausschließlich im Browser
rechnen und den Server nur speichern lassen. Beides ist machbar, beides war
für den Ursprungszweck zu viel Aufwand.

---

## Was bewusst fehlt

Ehrlichkeit über die Grenzen spart später Zeit:

* **Keine Wanddicke.** Räume sind Innenmaße; benachbarte Räume stoßen
  aneinander. Für ein Aufmaßsystem, das Wandaufbauten verwaltet, wäre eine
  eigene Wand-Entität nötig, die sich zwei Räume *teilen* – ein spürbarer
  Umbau, aber der richtige Weg, wenn Bauteilschichten dazukommen sollen.
* **Keine gemeinsame Wand.** Eine Tür zwischen zwei Räumen ist heute zwei
  Öffnungen. Für Bauantrag oder Fluchtwegberechnung müsste sie eine sein.
* **Keine Rundungen und Bögen.** Alle Wände sind gerade. Runde Räume gibt es
  im Bestand selten genug, dass sich der Aufwand nicht lohnte.
* **Keine Kollisionsprüfung beim Begehen.** Solange nicht jeder Raum eine Tür
  hat, wäre sie eine Falle statt einer Hilfe.
* **Keine Prüfung auf Überlappung** zwischen Räumen. Zwei Räume dürfen
  einander durchdringen – im Modell fällt es auf, verhindert wird es nicht.
* **Keine Historie.** Das Modell hält den aktuellen Stand. Wer Bauzustände
  vergleichen will, braucht eine Versionierung darüber.

---

## Ideen für den Ausbau

Grob nach Nutzen sortiert, mit dem Teil, den es berührt:

1. **Wanddicke und geteilte Wände** – eigene Entität `Wand`, Räume verweisen
   darauf. Öffnungen wandern von `Raum` an `Wand`. Berührt: Modell, Geometrie,
   Renderer.
2. **Kollision beim Begehen** – sobald Türen flächendeckend erfasst sind. Der
   Renderer kennt die Wandstücke bereits.
3. **Maßketten im Plan** – aus `Geometrie.wandLaengen` und den Öffnungen
   ergeben sich Maßlinien fast von selbst; das macht aus dem Grundriss eine
   prüffähige Zeichnung.
4. **Import aus DXF/IFC** – Umrisse als Polygone einlesen. Der Umriss-Typ
   passt dazu; nötig ist ein Umrechner auf das Raumkoordinatensystem.
5. **Export nach DXF/SVG/PDF** – der Renderer liefert schon SVG; für DXF
   genügt eine Linienausgabe aus `wandStuecke`.
6. **Mengenermittlung** – Wandflächen abzüglich Öffnungen, Bodenfläche,
   Umfang für Sockelleisten. Alle Eingangsgrößen sind vorhanden.
7. **Aufmaß per Sprache** – „Schulungsraum, sechs Komma null, rechts, vier
   Komma null" während des Messens. Der Polygonzug ist dafür die passende
   Struktur, weil er genau der gesprochenen Reihenfolge folgt.
8. **Mehrere Gebäude/Liegenschaften** – heute gibt es nur Geschosse. Eine
   Ebene darüber ist ein Feld, kein Umbau.

---

## Herkunft, Lizenz, Doppelpflege

Der Kern ist eine **Herauslösung**, keine Bibliothek, gegen die das
Ursprungsprojekt läuft. Das DRK-Werkzeug hat weiterhin seine eigene,
eingewachsene Fassung (dort auf Englisch benannt und in Spring-Controller
eingebettet). Wer beide weiterentwickelt, pflegt zwei Stellen – wer nur hier
weiterbaut, hat freie Hand.

Die fachlichen Zahlen stammen aus DIN 18015-3, DIN 18040, DIN 18101,
DIN EN 60617-11, DIN 1356-1, ASR A1.3 und DIN EN 1838. Die Normen selbst sind
kostenpflichtig und liegen dem Paket nicht bei; die verwendeten Werte sind
Richtwerte und in `Normmasse.kt` an einer Stelle gebündelt, damit sie sich
prüfen und austauschen lassen.

`web/modell3d.js` setzt three.js voraus (MIT-Lizenz, nicht enthalten).
