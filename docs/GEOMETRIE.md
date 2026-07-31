# Die Rechnungen im Einzelnen

Wer den Kern erweitert, sollte wissen, warum welche Formel gewählt wurde.
Alle Beispiele sind als Test hinterlegt.

---

## Polygonzug (Traverse)

**Eingabe:** je Wand Länge und Drehung an der Ecke danach.
**Ausgabe:** Eckpunkte.

```
Start:  Punkt (0,0), Richtung 0° (nach rechts)
Je Wand:
    x += länge · cos(richtung)
    y += länge · sin(richtung)
    Punkt merken
    richtung += drehung
```

Da y nach unten zeigt, dreht ein **positiver** Winkel im Bild nach rechts.
Ein im Uhrzeigersinn abgelaufenes Rechteck ergibt deshalb vier Drehungen von
je +90°, und die Eckpunkte kommen im Uhrzeigersinn heraus – genau die
Reihenfolge, die der Rest des Kerns erwartet.

**Restlücke** ist der Abstand zwischen letztem und erstem Punkt. Unter 2 cm
gilt der Zug als geschlossen und der doppelte Punkt entfällt. Darüber wird die
Lücke als Schlusswand aufgefasst *und gemeldet*: Sie ist der einzige
Selbstkontrollmechanismus eines Aufmaßes.

Die 2 cm sind eine Erfahrungsgröße: feiner misst kein Bandmaß im Raum, gröber
verdeckt echte Fehler.

**Rückrechnung** (`Aufmass.waende`) nimmt drei aufeinanderfolgende Punkte und
bildet die Winkeldifferenz der beiden Richtungen, normiert auf −180…+180°.
Damit lässt sich ein als Rechteck angelegter Raum nachträglich wandweise
bearbeiten.

---

## Fläche

**Freies Vieleck** – Gaußsche Trapezformel:

```
A = ½ · |Σ (xᵢ · yᵢ₊₁ − xᵢ₊₁ · yᵢ)|
```

Gilt für jedes einfache (nicht überschlagene) Vieleck. Der Betrag macht die
Umlaufrichtung gleichgültig.

**Trapez** – Mittellinie mal Tiefe:

```
A = (breiteHinten + breiteVorne) / 2 · tiefe
```

Der häufigste Fehler an dieser Stelle ist `breite × tiefe`. Bei 4/6 × 5 m sind
das 30 statt 25 m² – 20 % zu viel.

---

## Trapez zu Ecken

Die kürzere Wand muss irgendwo innerhalb der Gesamtbreite liegen. Wohin, sagt
`Schraege`:

| `Schraege` | kürzere Wand | senkrechte Wand |
|---|---|---|
| `RECHTS` | links bündig | die linke |
| `LINKS` | rechts bündig | die rechte |
| `BEIDSEITIG` | mittig | keine |

Zu lesen ist der Name als „**auf dieser Seite** ist die Wand schräg". Bei
`LINKS` steht also die rechte Wand senkrecht, und beide Wände enden rechts
bündig.

---

## Wand mit Öffnungen zerlegen

Für jede Wand: Öffnungen nach Abstand sortieren, dann durchlaufen.

```
t = 0
je Öffnung (von, bis, brüstung, höhe):
    volle Wand von t bis von
    Brüstung  von…bis, 0 … brüstung           (nur wenn brüstung > 0)
    Sturz     von…bis, brüstung+höhe … raumhöhe (nur wenn darunter)
    t = max(t, bis)
volle Wand von t bis wandlänge
```

`max(t, bis)` fängt überlappende Öffnungen ab: Zwei Türen, die sich
überschneiden, ergeben ein Loch statt eines Wandstücks mit negativer Länge.
Beides – Überlappung wie das Herausragen aus der Wand – kommt bei getippten
Werten vor und darf nicht zu kaputter Geometrie führen.

Die Begrenzung auf die Raumhöhe passiert schon beim Anlegen in
`Normmasse.vervollstaendigen`. Ein 2,50 m hohes Tor in einer 2,00 m hohen Wand
liesse sonst von der Wand nichts stehen.

---

## Lage eines Einbaus an der Wand

Punkt auf der Wand: linear interpolieren zwischen den beiden Ecken.

Abrücken: **senkrecht zur Wand**, nicht in Richtung Raummitte. Das ist der
Unterschied zwischen richtig und beinahe richtig – rückt man Richtung Mitte
ab, wandert das Gerät auch ein Stück *an der Wand entlang* und sitzt nicht
mehr dort, wo es gemessen wurde. Bei 10 cm Abrücken sind das je nach Lage
mehrere Zentimeter Versatz.

```
n = (−dy, dx) / |wand|                   Senkrechte
falls n vom Schwerpunkt wegzeigt: n = −n Richtung umdrehen
lage = punkt + n · abrücken
```

Der Schwerpunkt entscheidet nur über das Vorzeichen, nicht über die Richtung.
Bei stark verwinkelten Räumen kann er ausserhalb liegen; für die Frage „welche
Seite ist innen" reicht er dennoch, weil sie je Wand lokal beantwortet wird.

**Drehung im Plan:** Die Schaltzeichen sind nach oben aufragend gezeichnet.
Gedreht um Wandrichtung + 180° sitzen sie mit der flachen Seite an der Wand
und ragen in den Raum – so, wie es im Installationsplan aussieht.

---

## Nächste Wand finden

Projektion des Punktes auf jede Wandstrecke, begrenzt auf [0,1], dann die
kleinste Entfernung. Das Ergebnis liefert zugleich den Abstand entlang der
Wand – also genau das, was `Einbau.abstandM` braucht.

Wichtig fürs Bedienen: **immer** einrasten, nicht nur bei geringer Entfernung.
Wer eine Steckdose grob in die Nähe einer Wand tippt, meint diese Wand. Ein
Schwellwert würde nur dazu führen, dass Geräte gelegentlich frei im Raum
landen – ohne Höhe und ohne Wandbezug.

---

## Punkt im Raum

Strahlensatz-Verfahren (ray casting): Von dem Punkt aus einen Strahl legen und
die Kreuzungen mit den Kanten zählen. Ungerade Zahl = innen. Gilt für jedes
einfache Vieleck und braucht keine Konvexität.

Gebraucht wird das beim Begehen („in welchem Raum stehe ich?") und beim
Setzen an der Decke.

---

## Selbstüberschneidung

Paarweiser Streckenschnitt über die Orientierung von Punkttripeln, nicht
benachbarte Kanten. O(n²) – bei Raumumrissen mit unter 50 Ecken belanglos.

Der Fall tritt praktisch immer aus demselben Grund auf: eine Drehung falsch
herum eingetragen. Aus dem Rechteck wird dann eine Acht. Die Meldung sollte
das direkt sagen, statt nur „ungültiges Polygon" zu melden.

---

## Einrasten beim Ziehen

Zwei Stufen:

1. Raster – 25 cm. Grob genug, dass man es merkt, fein genug für Türbreiten.
2. Fremde Kanten – Fangbereich 35 cm, etwa eine Handbreit. Groß genug, um mit
   dem Finger zu treffen; klein genug, um eine gewollte Fuge nicht
   wegzuschnappen.

Geprüft wird jede eigene Kante gegen jede fremde: bündig links, bündig rechts,
und Anstoßen von beiden Seiten. Damit rastet ein Raum sowohl *an* einen
Nachbarn als auch *bündig mit* ihm ein.

---

## Geschosse stapeln

```
basis(0) = 0
basis(n+1) = basis(n) + höchsteRaumhöhe(n) + deckenstärke
```

Untergeschosse entsprechend nach unten. 0,30 m Decke ist ein Mittelwert für
Massivdecken mit Aufbau; für ein Modell, das den Zusammenhang zeigen soll,
genügt das. Wer echte Deckenaufbauten verwaltet, ersetzt den Parameter.
