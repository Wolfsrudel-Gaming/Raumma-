# Aufmessen ohne Würfel

RAUMWERK nimmt einen echten Raum mit einem gewöhnlichen Handy auf – ohne
Referenzwürfel, ohne ARCore, ohne Server. Drei Wege, je nachdem, was vor Ort
zur Hand ist; alle enden in demselben Datenmodell (Umriss, Höhe, Öffnungen,
Einbauten) und jede Wand trägt ihre **Maß-Herkunft**.

| Weg | Braucht | Dauer | Genauigkeit |
|---|---|---|---|
| **Zielen** (Handy) | Kamera + Lagesensor, 1 bekanntes Maß | ~2 min | Form ± wenige cm; mit Bandmaß an einer Wand ± 1–5 cm |
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

### Warum kein Würfel nötig ist

Alle Ergebnisse sind **linear in h**. Die Form stimmt immer; nur der Maßstab
hängt an der (geschätzten) Kamerahöhe. Ein einziges bekanntes Maß legt h fest
und skaliert alles mit – Ecken, Öffnungen, Höhen:

- eine Wand mit dem **Bandmaß** (am besten die längste),
- die **Raumhöhe** vom Laser (Laser einfach nach oben halten),
- die **Höhe einer Tür** (z. B. 2,01 m Rohbaumaß),
- oder mehrere davon – dann per kleinste Quadrate: `k = Σ ist·soll / Σ ist²`.

Widersprechen sich mehrere Maße um mehr als 15 cm, meldet die App, welches
vermutlich falsch abgelesen ist.

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

Ein Winkelfehler σ wirkt radial mit `h / sin²β · σ` und seitlich mit `d · σ`.
Bei h = 1,40 m und σ = 0,4°:

| Entfernung zur Ecke | Fehler (1σ) |
|---|---|
| 1,5 m | ~ 2 cm |
| 3 m | ~ 6 cm |
| 5 m | ~ 15 cm |

Deshalb: **in die Raummitte stellen** und **eine Wand mit dem Bandmaß**
nachmessen. Jede gezielte Wand trägt ihre Unsicherheit („gezielt ± 6 cm") –
im Raumblatt, im Report, in der Prüfansicht. Wände mit > 10 cm Unsicherheit
werden zum Nachmessen vorgeschlagen.

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

1. **Vorbereitung** – geschätzte Kamerahöhe (wird gemerkt), „Estrich fehlt
   noch" (dann zählen gezielte Höhen ab Rohboden und werden auf den
   Fertigfußboden umgerechnet), „rechtwinklig".
2. **Ecken** – Bodenecken im Kreis antippen. Verdeckte Ecke (Schrank davor)?
   Auf „Decke" umschalten und die Deckenecke anzielen.
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
| `web/raumaufnahme.js` | Rohdaten → Raum: Maßstab, Glätten, Ausgleich, Öffnungen, Einbauten, Hinweise |
| `src/main/kotlin/.../Aufmass.kt` | `rechtwinklig`, `ausgleichen` (verbindlich, getestet) |
| `web/geometrie.js` | JS-Spiegel davon |
| `web/raumwerk/assistent.js` | der Assistent (Kamera, Fadenkreuz, Schritte, Prüfen, Maßband, Rechteck) |
| `web/raumwerk/uebernahme.js` | Ergebnis ins Projekt schreiben, Nachmessen |
| `web/raumwerk/native.js` | Lage (`beiLage`), Lautstärketaste, Teilen, Drucken, Zurück-Taste |
| `android-app/…/NativeBridge.kt` | Spiel-Rotationsvektor, Teilen (FileProvider), Drucken (PrintManager) |

Tests: `web/tests/zielen.test.mjs` (Geometrie, Rauschen),
`web/tests/raumaufnahme.test.mjs` (L-Raum Ende zu Ende mit falscher
Kamerahöhe, Zittern, Kalibrierung über Bandmaß/Raumhöhe/Tür, Estrich),
`web/tests/aufmass.test.mjs` (Parität mit Kotlin),
`web/tests/e2e/feld.e2e.mjs` (echter Browser, Handy-Ablauf, CI).

## Grenzen

- **Ein Standpunkt.** Alle Ecken müssen von einer Stelle aus sichtbar sein.
  Für verwinkelte Räume: zweimal aufnehmen (zwei Räume) oder Maßband-Weg.
- **Kein Ersatz für ein Laser-Aufmaß** bei Haftungsfragen – deshalb steht an
  jeder gezielten Wand ihre Unsicherheit, und ein Bandmaß überschreibt sie.
- Der **Referenzblock** (`docs/REFERENZBLOCK.md`) bleibt eine Option für die
  spätere Photogrammetrie; für das Aufmaß wird er nicht gebraucht.
