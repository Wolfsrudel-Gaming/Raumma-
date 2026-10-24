# Aufmessen ohne Würfel

RAUMWERK nimmt einen echten Raum mit einem gewöhnlichen Handy auf – ohne
Referenzwürfel, ohne ARCore, ohne Server. Drei Wege, je nachdem, was vor Ort
zur Hand ist; alle enden in demselben Datenmodell (Umriss, Höhe, Öffnungen,
Einbauten) und jede Wand trägt ihre **Maß-Herkunft**.

| Weg | Braucht | Dauer | Genauigkeit |
|---|---|---|---|
| **Zielen** (Handy) | Kamera + Lagesensor, 1 bekanntes Maß | ~2 min | 1 Bandmaß: ~2–3 cm (95 % < 5–6 cm); 2 Bandmaße: ~0,3–2 cm |
| **Maßband / Laser** | Bandmaß oder Laser | ~5 min | wie gemessen (± 0,5 cm), Restlücke als Kontrolle |
| **Rechteck** | zwei Maße | sofort | wie gemessen |

Einstieg: Handy-App → Projekte → **Neuen Raum aufnehmen** (oder im Raumblatt
**Raum aufmessen**). Am PC: „Raum aufnehmen" im Panel „Aktiver Raum".

---

## 1. Zielen – das Prinzip

Man steht im Raum, hält das Handy auf Brusthöhe **h** und zielt mit dem
Fadenkreuz auf eine Bodenecke. Die Kamera schaut dann um den Winkel **β** unter
den Horizont; die waagerechte Entfernung zur Ecke ist

```
d = h / tan β
```

Die Blickrichtung (Gier) kommt vom Lagesensor. Polar → kartesisch, und die
Ecken ergeben den Grundriss. Ist der Grundriss bekannt, trifft jeder weitere
Zielstrahl eine Wand – Tür, Fenster, Steckdose, Schalter bekommen so Wand,
Abstand ab Ecke und **Höhe**. Ein Strahl nach oben an die Deckenkante derselben
senkrechten Raumkante liefert die Raumhöhe:

```
H = h · (1 + tan γ / tan β)        γ = Winkel nach oben zur Deckenkante
```

### Das Messmodell – wo die Kamera wirklich sitzt

Die einfache Formel nimmt an, die Kamera sitze genau auf der eigenen
Drehachse. Tatsächlich hält man das Handy **r ≈ 20–45 cm vor dem Körper**, die
Linse sitzt **L ≈ 8 cm über dem Drehpunkt der Hand** und wandert beim Neigen
mit, das Gerät hat einen kleinen festen **Neigungsfehler δ** (0,5–1°), und die
Gier läuft langsam weg. Ohne diese Terme lägen die Wände um **Dezimeter**
daneben. Das Modell (`zielen.js`, „Kameramodell“):

```
a = r + L·sinθ'        z = h + L·cosθ'        θ' = θ − δ
ρ_Boden = a + z·cot θ'                         ψ' = ψ − ω·(t − t₀)
```

`raumaufnahme.js` gleicht **h, r und δ** nach kleinsten Quadraten aus
(Levenberg-Marquardt) – aus allem, was bekannt ist:

- **Bandmaße** an Wänden (± 5 mm),
- eine **bekannte Raumhöhe** (Laser nach oben, ± 1 cm),
- eine **bekannte Tür-/Kantenhöhe** (Norm-Innentür lichte Höhe ≈ 1,97 m),
- „der Raum ist **rechtwinklig**“ (weich, ± 1° je Ecke),
- Vorwissen über die Haltung (Freihand: r = 0,30 ± 0,10 m; Stativ: r = 0).

Die Gier-Drift ω kommt aus dem **Kontrollschuss**: nach den Ecken noch einmal
auf Ecke 1 zielen. Der Neigungsfehler δ lässt sich **einmal je Gerät**
kalibrieren: ein Ziel in ~2 m normal und mit dem Handy auf dem Kopf anzielen –
der Fehler wechselt das Vorzeichen, das Ziel nicht: `δ = (θ₁ − θ₂)/2`.

Widersprechen sich mehrere Maße deutlich, meldet die App, welches vermutlich
falsch abgelesen ist.

### Lage ohne Kompass

Gemessen wird mit dem **Spiel-Rotationsvektor** (Gyroskop + Beschleunigung,
Android) bzw. `deviceorientation` (Browser) – bewusst **ohne Magnetometer**:
Kompasse sind neben Stromleitungen, Stahlträgern und Heizkörpern unbrauchbar.
Die Neigung kommt aus der Schwerkraft (genau), die Gier aus dem Gyroskop
(driftet wenige Zehntelgrad pro Minute – für eine zweiminütige Aufnahme
unerheblich).

Beim Auslösen mittelt die App die Lage der letzten ~0,4 s **vor** dem Druck
(der Druck selbst wackelt). In der Android-App löst auch die
**Lautstärketaste** aus. Ist die Streuung > 1,2°, wird um ruhiges Halten
gebeten.

### Genauigkeit – ehrlich ausgewiesen

Jede gezielte Wand trägt ihre Unsicherheit („gezielt ± 3 cm") – im Raumblatt,
im Report, in der Prüfansicht. Sie setzt sich zusammen aus dem Zittern je
Schuss und der Restunsicherheit von h, r, δ (Kovarianz des Ausgleichs), linear
durch den Zugausgleich geführt: Eine Wand, die durch Bandmaße und Schluss
festliegt, ist so genau wie diese. Daraus folgt die **Qualitätsklasse**:

| Klasse | Bedeutung | typisch erreicht mit |
|---|---|---|
| **AUFMASS** | jede Wand ± 5 cm oder besser | 1–2 Bandmaße, oder Stativ + kalibrierte Neigung |
| **PLAN** | ± 15 cm | Türhöhe oder Raumhöhe als einziger Maßstab |
| **SKIZZE** | Form stimmt, Maßstab ± 5–8 % | kein bekanntes Maß |

Monte-Carlo-Simulation (300 zufällige Standpunkte je Fall, Freihand mit
r = 20–45 cm, δ ≈ 0,5°, Zittern 0,2°, Drift 2°/min; `RMS / 95 %`):

| Fall | Rechteck 4,80 × 3,60 | L-Raum 5 × 4 |
|---|---|---|
| ohne Maßstab | 21 / 42 cm | 17 / 35 cm |
| Türzarge 1,97 m | 10 / 20 cm | 7 / 15 cm |
| 1 Bandmaß | 2,0 / 4,5 cm | 3,0 / 6,3 cm |
| 2 Bandmaße + Kontrollschuss | 0,3 / 0,6 cm | 2,2 / 4,8 cm |

Die angezeigte 2σ-Unsicherheit deckte den tatsächlichen Fehler in 98–100 %
der Fälle. Die App sagt außerdem, **welches Maß jetzt am meisten bringt**
(ohne Bandmaß: die längste Wand). Schüsse flacher als 12° (Ecke > ~6 m weg)
oder steiler als 75° (man steht fast auf der Ecke) werden abgelehnt.

**Höhen** (Steckdosen, Schalter, Brüstungen) hängen an h und δ, die sich aus
Längen allein nur schwach trennen lassen: ohne Kalibrierung ± 2–3 cm, mit
kalibrierter Neigung ± 1 cm.

### Rechtwinklig glätten und Ausgleich

Die meisten Räume sind rechtwinklig. Mit „rechtwinklig glätten" werden
Ecken, die weniger als 8° von einem Vielfachen von 90° abweichen, auf genau
diesen Winkel gesetzt (`Aufmass.rechtwinklig`). Die dabei entstehende
Restlücke wird auf die **nicht** gemessenen Wände verteilt – so wenig wie
möglich, nach kleinsten Quadraten (`Aufmass.ausgleichen`):

```
Σ δᵢ·uᵢ = −Lücke,   Σ δᵢ² → min,   δᵢ = 0 für Wände mit Bandmaß
```

Jedes Bandmaß bleibt dadurch **exakt** erhalten. Laufen alle freien Wände
parallel, wird nur der schließbare Anteil verteilt; der Rest bleibt als
ehrliche Restlücke sichtbar.

### Ablauf in der App

1. **Vorbereitung** – Haltung (Freihand / Stativ), geschätzte Kamerahöhe
   (wird gemerkt), einmalig „Neigung kalibrieren" (30 s), „Estrich fehlt
   noch" (dann zählen gezielte Höhen ab Rohboden und werden auf den
   Fertigfußboden umgerechnet), „rechtwinklig".
2. **Ecken** – Bodenecken im Kreis antippen. Verdeckte Ecke (Schrank davor)?
   Auf „Decke" umschalten und die Deckenecke anzielen. Danach der
   **Kontrollschuss** auf Ecke 1.
3. **Raumhöhe** – unten an eine freie Kante, dann oben an dieselbe Kante.
4. **Öffnungen** – Tür/Fenster/Durchgang: untere linke, dann obere rechte Ecke.
5. **Installation** – Steckdose, Schalter, Leuchte … je ein Schuss.
6. **Prüfen** – Skizze, Wände mit Herkunft, Bandmaß-Felder, Hinweise →
   **Übernehmen**.

Die App speichert nicht nur das Ergebnis, sondern die **Rohdaten** (die
Zielstrahlen). Wird später eine Wand nachgemessen, rechnet sie den ganzen Raum
aus denselben Strahlen neu – richtig skaliert, statt eine fertige Zeichnung zu
verbiegen.

## 2. Maßband / Laser – Wand für Wand

Der klassische Polygonzug aus `Aufmass.zug`: an einer Ecke beginnen, im
Uhrzeigersinn je Wand die Länge eintragen und die Abbiegung an der nächsten
Ecke wählen (↱ rechts, ↰ links, ∠ anderer Winkel, z. B. 45° am Erker). Die
**letzte Länge darf leer bleiben** – sie ergibt sich aus dem Schluss. Bleibt
eine Restlücke, steckt ein Messfehler drin; „auf alle Wände verteilen"
gleicht sie aus.

## 3. Nachmessen – jederzeit

Im Raumblatt steht jede Wand mit Länge und Herkunft (Bandmaß / gezielt ± x cm /
eingegeben) und einem Feld „Bandmaß". Eine eingetragene Länge

- rechnet einen **gezielten** Raum aus seinen Strahlen neu (neuer Maßstab,
  alle Öffnungen und Einbauten wandern mit),
- gleicht einen **eingegebenen** Raum so aus, dass alle per Bandmaß
  gesicherten Wände exakt stimmen.

## Wo der Code liegt

| Datei | Rolle |
|---|---|
| `web/zielen.js` | Zielgeometrie: Blickrichtung aus Lage, Boden-/Wand-/Deckenpunkt, Kalibrierung, Unsicherheit |
| `web/raumaufnahme.js` | Rohdaten → Raum: Ausgleich von h, r, δ, Kovarianz, Glätten, Zugausgleich, Öffnungen, Einbauten, Klasse, Hinweise |
| `src/main/kotlin/.../Aufmass.kt` | `rechtwinklig`, `ausgleichen` (verbindlich, getestet) |
| `web/geometrie.js` | JS-Spiegel davon |
| `web/raumwerk/assistent.js` | der Assistent (Kamera, Fadenkreuz, Schritte, Prüfen, Maßband, Rechteck) |
| `web/raumwerk/uebernahme.js` | Ergebnis ins Projekt schreiben, Nachmessen |
| `web/raumwerk/native.js` | Lage (`beiLage`), Lautstärketaste, Teilen, Drucken, Zurück-Taste |
| `android-app/…/NativeBridge.kt` | Spiel-Rotationsvektor, Teilen (FileProvider), Drucken (PrintManager) |

Tests: `web/tests/zielen.test.mjs` (Geometrie, Rauschen),
`web/tests/raumaufnahme.test.mjs` (L-Raum Ende zu Ende mit realistischem
Zielvorgang – Linse vor der Achse, Neigungsfehler, Zittern, Drift –,
Kalibrierung über Bandmaß/Raumhöhe/Tür/Wende, Stativ, Estrich, Klassen),
`web/tests/aufmass.test.mjs` (Parität mit Kotlin),
`web/tests/e2e/feld.e2e.mjs` (echter Browser, Handy-Ablauf, CI).

## Grenzen

- **Ein Standpunkt.** Alle Ecken müssen von einer Stelle aus sichtbar sein.
  Für verwinkelte Räume: zweimal aufnehmen (zwei Räume) oder Maßband-Weg.
  Mehrere Standpunkte in einem Ausgleich sind der nächste Schritt.
- **Laser per Bluetooth** gibt es noch nicht (Web Bluetooth fehlt in der
  Android-WebView; ein nativer Weg über die Brücke ist möglich). Laserwerte
  werden eingetippt.
- Das Messmodell lebt bewusst nur in JavaScript (Erfassungsschicht); der
  Kotlin-Kern enthält den daraus folgenden Zugausgleich (`Aufmass.ausgleichen`).
- **Kein Ersatz für ein Laser-Aufmaß** bei Haftungsfragen – deshalb steht an
  jeder gezielten Wand ihre Unsicherheit, und ein Bandmaß überschreibt sie.
- Der **Referenzblock** (`docs/REFERENZBLOCK.md`) bleibt eine Option für die
  spätere Photogrammetrie; für das Aufmaß wird er nicht gebraucht.
