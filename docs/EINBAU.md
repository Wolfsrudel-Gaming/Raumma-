# Einbau in ein eigenes Projekt

Schritt für Schritt vom kopierten Ordner zum laufenden Aufmaß.

---

## 1. Was kopieren?

Zwingend nötig ist genau ein Ordner:

```
src/main/kotlin/de/aufmass/kern/
```

Fünf Dateien, keine Abhängigkeit ausser der Kotlin-Standardbibliothek. Sie
lassen sich in jedes JVM-Projekt legen – Spring Boot, Ktor, Android, Desktop.

Empfohlen dazu:

* `src/test/kotlin/` – die Tests sind die Fallsammlung und die verbindliche
  Beschreibung. Sie laufen ohne Datenbank und ohne Netz in unter einer Sekunde.
* `sql/schema.sql` – als Vorlage, nicht als Vorschrift.
* `web/` – wenn die Oberfläche im Browser laufen soll.

Das Paket heisst `de.aufmass.kern`. Umbenennen ist gefahrlos: Suchen und
Ersetzen der Paketzeile genügt, es gibt keine Reflexion und keine Ressourcen,
die auf den Namen zeigen.

---

## 2. Speichern

Der Kern speichert nichts. Er kennt weder Datenbank noch HTTP – das ist der
Grund, warum er sich übernehmen lässt.

Zum Anbinden gibt es zwei übliche Wege:

**a) Eigene Persistenz-Klassen, Modell übernehmen.**
`Raum`, `Oeffnung` und `Einbau` sind reine `data class`. Wer JPA nutzt, legt
Entitäten daneben und wandelt um; wer SQL schreibt, mappt direkt. Der Umriss
ist ein `String` – in PostgreSQL genügt `TEXT`, `jsonb` geht auch.

**b) Modell annotieren.**
Kürzer, bindet den Kern aber an ein Framework. Vertretbar, wenn absehbar nur
ein Projekt entsteht.

Beispiel mit einfachem JDBC (Spring `NamedParameterJdbcTemplate`):

```kotlin
fun mappeRaum(rs: ResultSet) = Raum(
    id = rs.getObject("id", UUID::class.java),
    name = rs.getString("name"),
    nummer = rs.getString("nummer"),
    geschoss = rs.getInt("geschoss"),
    breiteM = rs.getBigDecimal("breite_m"),
    breiteVorneM = rs.getBigDecimal("breite_vorne_m"),
    tiefeM = rs.getBigDecimal("tiefe_m"),
    schraege = Schraege.valueOf(rs.getString("schraege")),
    umriss = rs.getString("umriss"),
    hoeheM = rs.getBigDecimal("hoehe_m"),
    xM = rs.getBigDecimal("x_m"),
    yM = rs.getBigDecimal("y_m"),
    drehungGrad = rs.getBigDecimal("drehung_grad"),
    farbe = rs.getString("farbe"),
    notiz = rs.getString("notiz")
)
```

---

## 3. Anlegen und Vervollständigen

Beim Anlegen sollte immer `Normmasse.vervollstaendigen` laufen. Sonst fehlen
Höhen, und Öffnungen können höher werden als der Raum:

```kotlin
fun oeffnungAnlegen(roh: Oeffnung): Oeffnung {
    val raum = raumDao.finde(roh.raumId) ?: fehlt()
    val fertig = Normmasse.vervollstaendigen(roh, raum)
    oeffnungDao.speichern(fertig)
    return fertig
}
```

Dasselbe gilt für Einbauten. Eine bereits gesetzte Höhe wird dabei **nie**
überschrieben – im Bestand sitzt vieles anders, und das ist kein Mangel.

---

## 4. Eine Oberfläche anschliessen

Die Web-Dateien sind ES-Module ohne Rahmenwerk. Sie erwarten Daten in genau
der Form, die das Modell liefert (die Feldnamen werden sowohl deutsch als auch
englisch erkannt, damit ein bestehendes Backend nicht umbenannt werden muss).

```js
import * as G from "./geometrie.js";
import { fixtureSymbol, openingSymbol } from "./symbole.js";
import { createModel } from "./modell3d.js";

const raum = { breiteM: 6, tiefeM: 4, hoeheM: 2.5,
               umriss: "[[0,0],[6,0],[6,2],[5.2,2],[5.2,4],[0,4]]" };

G.ecken(raum);        // 6 Eckpunkte
G.flaeche(raum);      // 22.4
G.wandLaengen(raum);  // [6, 2, 0.8, 2, 5.2, 4]
```

**Grundriss zeichnen** – die Kurzfassung:

1. Füllfläche als `<polygon>` aus `G.ecken(raum)`.
2. Je Wand die Stücke aus `G.wandStuecke(raum, i, oeffnungen)` als `<line>`.
   Was dazwischen fehlt, ist die Öffnung.
3. In jede Lücke `openingSymbol(art, laengeInPixeln)`, gedreht um die
   Wandrichtung.
4. Je Einbau `G.lageImRaum(raum, einbau)` und darauf `fixtureSymbol(art)`,
   gedreht um **Wandrichtung + 180°** (die Zeichen sind nach oben aufragend
   gezeichnet).

**3D-Modell:**

```js
const modell = createModel(container, {
  onMoved:  raum   => speichern(raum),
  onCreate: wunsch => anlegen(wunsch),
  onPick:   t      => auswaehlen(t),
  snap:     (id, x, y) => einrasten(id, x, y)
});
modell.setRooms(raeume.map(r => ({
  id: r.id, name: r.name, number: r.nummer, floor: r.geschoss,
  corners: G.ecken(r), posX: r.xM, posY: r.yM,
  rotationDeg: r.drehungGrad, heightM: r.hoeheM, color: r.farbe,
  openings: oeffnungenZu(r), fixtures: einbautenZu(r)
})));
```

`modell3d.js` erwartet three.js unter `./lib/three.module.min.js`. Es rechnet
dauerhaft – beim Verlassen der Ansicht `dispose()` aufrufen, sonst läuft die
Grafik im Hintergrund weiter und zieht Akku.

---

## 5. Was zuerst gebaut werden sollte

Aus der Erfahrung mit dem Ursprungsprojekt, in dieser Reihenfolge:

1. **Polygonzug-Editor.** Er ist die Erfassungsform, mit der man tatsächlich
   arbeitet. Wichtig: Vorschau und Restlücke *neben* der Tabelle, sofort
   mitlaufend.
2. **Grundriss mit Wandnummern.** Ohne sichtbare Wandnummern ist „Wand 3" im
   Formular eine Ratepartie.
3. **Einbauten setzen durch Antippen.** Wandgeräte immer auf die nächste Wand
   einrasten – ein Schalter hängt an einer Wand, auch wenn man daneben tippt.
4. **Erst dann 3D.** Es beeindruckt, aber es erfasst nichts. Ohne saubere
   Grundrisse ist es eine hübsche Fehleranzeige.

---

## 6. Fallstricke

* **Umlaute in Klassennamen.** Klassennamen werden zu Dateinamen, und die
  überleben nicht jede Build-Umgebung. In Kommentaren und Zeichenketten sind
  Umlaute unproblematisch – deshalb heisst das Enum `Buendig`.
* **Drehrichtung.** y zeigt nach unten, „rechts" ist ein positiver Winkel.
  Wer das verwechselt, bekommt Räume, die sich selbst kreuzen –
  `Aufmass.pruefen` erkennt genau das.
* **Anteile statt Meter.** `relX`/`relY` sind 0…1, nicht Meter. Beim
  Umrechnen immer `G.breite`/`G.tiefe` verwenden, nicht `breiteM` direkt: Bei
  einem freien Umriss sind das verschiedene Dinge.
* **Rundung.** Der Kern rundet auf Zentimeter. Feiner ist kein Bandmaß, und
  ungerundete Zahlen erzeugen im Formular Werte wie `0.8513849223570…`.
* **Öffnung höher als der Raum.** `Normmasse.vervollstaendigen` begrenzt sie.
  Wer selbst Öffnungen anlegt, muss das nachbauen – sonst entstehen
  Wandstücke mit negativer Höhe.
