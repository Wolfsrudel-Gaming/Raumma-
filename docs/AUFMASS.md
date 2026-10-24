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

- **Bandmaße** an Wänden (± 5 mm; im Ausgleich gegen die *gezielte* Länge
  derselben Wand mit deren Zielrauschen gewichtet – sonst presste der
  Ausgleich dieses Rauschen in h, r, δ und verzerrte alle Winkel),
- eine **bekannte Raumhöhe** (Laser nach oben, ± 1 cm) – sie setzt nur
  zusammen mit der gezielten Raumkante (Schritt „Raumhöhe“) einen Maßstab;
  ohne Kante sagt die App das und verweist auf den Schritt,
- eine **bekannte Tür-/Fensterhöhe** (Norm-Innentür lichte Höhe ≈ 1,97 m) –
  genau die Größe, die die App an der Öffnung als Höhe anzeigt: bei Türen und
  Durchgängen die lichte Höhe ab Fertigfußboden (auch wenn auf den Rohboden
  gezielt wurde), beim Fenster mit Brüstung Oberkante − Unterkante,
- „der Raum ist **rechtwinklig**“ (weich, ± 1° je Ecke – nur für Ecken, die
  auch geglättet werden, also unter 8° Abweichung; eine schräge 80°-Wand
  zieht sonst Kamerahöhe und Neigung schief),
- Vorwissen über die Haltung (Freihand: r = 0,30 ± 0,10 m; Stativ: r = 0).

Die Gier-Drift ω kommt aus dem **Kontrollschuss**: nach den Ecken noch einmal
auf Ecke 1 zielen. Fehlt er, rechnet die App eine unbekannte Drift von
± 1,5°/min in die Unsicherheit ein (ohne Glätten meist PLAN statt AUFMASS). Der Neigungsfehler δ lässt sich **einmal je Gerät**
kalibrieren: ein Ziel normal und mit dem Handy auf dem Kopf anzielen – der
Fehler wechselt das Vorzeichen, das Ziel nicht: `δ = (θ₁ − θ₂)/2`. Die Formel
gilt nur, wenn die Linse beim Umdrehen an ihrem Platz bleibt; wandert sie um
e, verfälscht das δ um ≈ e/D (Zielentfernung D): 1 cm auf 2 m sind schon
0,3°. Deshalb ein **fernes Ziel** (≥ 10 m, durchs Fenster oder den Flur
hinunter), die Handykante an einer festen Kante anlegen, zwei Wendepaare,
die sich auf ~0,2° einig sein müssen; mehr als 1,5° wird abgelehnt. Im
Ausgleich zählt ein kalibriertes δ mit ± 0,35° (unkalibriert ± 0,7°).

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
festliegt, ist so genau wie diese. Dazu kommen die **Richtungen**, die der
Ausgleich festhält: das Zielrauschen und die h-, r-, δ-Unsicherheit nicht
geglätteter Ecken (sie verzerrt nahe und ferne Ecken verschieden) und – bei
geglätteten Ecken – die Annahme selbst mit ± 0,3° je Ecke (auch Neubauten
sind nicht exakt rechtwinklig). Daraus folgt die **Qualitätsklasse**:

| Klasse | Bedeutung | typisch erreicht mit |
|---|---|---|
| **AUFMASS** | jede Wand ± 5 cm oder besser | 2 Bandmaße über Eck (Rechteck oft schon 1) |
| **PLAN** | ± 15 cm | Türhöhe oder Raumhöhe (mit gezielter Kante) als einziger Maßstab, Stativ + kalibrierte Neigung |
| **SKIZZE** | Form stimmt, Maßstab ± 5–8 % | kein bekanntes Maß |

Monte-Carlo-Simulation (300 zufällige Standpunkte je Fall, Freihand mit
r = 20–45 cm, δ ≈ 0,5°, Zittern 0,2°, Drift 2°/min; `RMS / 95 %`):

| Fall | Rechteck 4,80 × 3,60 | L-Raum 5 × 4 |
|---|---|---|
| ohne Maßstab | 21 / 42 cm | 17 / 35 cm |
| Türzarge 1,97 m | 10 / 20 cm | 7 / 15 cm |
| 1 Bandmaß | 2,0 / 4,4 cm | 3,0 / 6,1 cm |
| 2 Bandmaße + Kontrollschuss | 0,3 / 0,6 cm | 1,7 / 3,6 cm |

Die angezeigte 2σ-Unsicherheit deckte den tatsächlichen Fehler in 99–100 %
der Fälle; 1σ deckt 87–100 %. Mit einem Bandmaß ist die Angabe bewusst
vorsichtig (meist PLAN, obwohl der Fehler oft nur 2–4 cm ist): Erst das zweite
Bandmaß über Eck legt den Maßstab beider Richtungen fest – dann AUFMASS (Rechteck
300/300, L-Raum 260/300). Die Simulation kennt nur exakt rechte Winkel; die
angenommenen ± 0,3° je Ecke sind darin also reine Vorsicht. Die App sagt
außerdem, **welches Maß jetzt am meisten bringt** (ohne Bandmaß: die längste
Wand). Schüsse flacher als 12° (Ecke > ~6 m weg)
oder steiler als 75° (man steht fast auf der Ecke) werden abgelehnt.

**Höhen** (Steckdosen, Schalter, Brüstungen) hängen an h und δ, die sich aus
Längen allein nur schwach trennen lassen: angezeigt werden ohne Kalibrierung
± 3–4 cm, mit kalibrierter Neigung ± 2–3 cm (tatsächlich meist ± 1–2 cm).

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
(fast) parallel, wird nur der schließbare Anteil verteilt; der Rest bleibt
als ehrliche Restlücke sichtbar. „Fast“ heißt: weniger als ≈ 11,5° zwischen
den freien Richtungen (`det M < 0,01·spur² M`, Pseudo-Inverse über den
Haupt-Eigenvektor). Sonst würde der Anteil quer zu ihnen mit 1/sin α in die
Längen gedrückt – aus 3,00 m Seitenwand eines Trapezes wurden 2,40 m.

Die Lücke vor dem Ausgleich wird gegen das Messrauschen geprüft
(Mahalanobis-Abstand mit der Kovarianz der Längen). Ab 1,5σ zählt ein Teil
der Schließkorrektur zur Unsicherheit der verschobenen Wände, ab 3σ die ganze –
gleitend, damit eine Wand an der Schwelle nicht von ± 0,5 cm auf ± 20 cm
springt. Ab 3σ nennt die App die Wand zum Nachmessen und die am stärksten
geglättete Ecke. „Rechtwinklig glätten“ auszuschalten rät sie erst, wenn
Bandmaße sich unter rechten Winkeln widersprechen (bleibende Restlücke; die
Klasse fällt dann auf die Größe dieser Lücke) – auf bloßen Verdacht hin
machte das rechtwinklige Räume nur schlechter.

**Rechte Winkel sind eine Annahme.** Wurde geglättet, steht jedes Ergebnis
unter dem Vorbehalt „vorausgesetzt, die geglätteten Ecken sind rechtwinklig“
(`annahmen: ["rechtwinklig"]`) – im Assistenten, am Raum (Handy: „∟
ANGENOMMEN“, PC) und im Bericht. Das Zielen allein erkennt eine schiefe Ecke
erst ab einigen Grad sicher. Die App schlägt deshalb ein **Kontrollmaß** vor:
alle freien Wände einer Richtung (im Rechteck eine Wand, im L zwei). Danach
bestimmen die Bandmaße den Zug in dieser Richtung über, eine schiefe Ecke
zeigt sich als bleibende Restlücke, und die Klasse fällt. Der Vorbehalt
bleibt trotzdem: Ein Parallelogramm hat dieselben Längen – das zeigte erst
eine Diagonale.

Simulation einer 87°-Ecke (≈ 20 cm auf 5 m), zufällige Standpunkte und
Haltungen, zwei Bandmaße: meist PLAN/SKIZZE, in 18–27 % noch AUFMASS mit
≈ 20 cm Fehler – immer mit Vorbehalt. Nach dem vorgeschlagenen Kontrollmaß
sinkt das auf 3 % (88°/92°-Trapez: von 73 % auf 11 %); rechtwinklige Räume
bleiben AUFMASS.

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
