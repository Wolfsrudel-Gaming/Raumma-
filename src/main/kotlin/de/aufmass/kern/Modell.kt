package de.aufmass.kern

import java.math.BigDecimal
import java.util.UUID

/*
 * Datenmodell des Aufmaßes.
 *
 * Bewusst ohne Framework: keine Annotationen, keine Abhängigkeit auf Spring,
 * JPA oder Jackson. Wer das Paket übernimmt, entscheidet selbst, wie
 * gespeichert und übertragen wird – die Fachlogik hängt nicht daran.
 *
 * Alle Längen sind Meter, alle Winkel Grad.
 */

// ---------------------------------------------------------------- Räume

/**
 * Auf welcher Seite die schräge Wand sitzt, wenn ein Raum als Trapez
 * beschrieben wird. `KEINE` heißt: vordere und hintere Wand sind gleich lang,
 * der Raum ist rechteckig.
 *
 * Das Trapez ist die einfache Beschreibung für den häufigsten Sonderfall.
 * Alles darüber hinaus – Nischen, Verkofferungen, L-Form – wird über
 * [Raum.umriss] erfasst.
 */
enum class Schraege {
    /** Rechteck. */
    KEINE,

    /** Linke Wand schräg, rechte Wand senkrecht – beide Wände enden rechts bündig. */
    LINKS,

    /** Rechte Wand schräg, linke Wand senkrecht – beide Wände beginnen links bündig. */
    RECHTS,

    /** Beide Seitenwände gleich schräg, die kürzere Wand liegt mittig. */
    BEIDSEITIG
}

/**
 * Ein Raum.
 *
 * Die Form entsteht auf zwei Wegen, die sich gegenseitig ausschließen:
 *
 *  1. **[umriss] gesetzt** – der frei erfasste Weg. Die Eckpunkte stehen als
 *     JSON-Liste im Uhrzeigersinn, in Metern, bezogen auf die linke obere Ecke
 *     des umschließenden Rechtecks:
 *     `[[0,0],[6,0],[6,2],[5.2,2],[5.2,4],[0,4]]`
 *     Damit lässt sich jedes einfache Vieleck abbilden.
 *
 *  2. **[umriss] leer** – dann gilt die Kurzbeschreibung aus [breiteM]
 *     (hintere Wand), [breiteVorneM] (vordere Wand, `null` = wie hinten) und
 *     [tiefeM]. Das ist Rechteck oder Trapez.
 *
 * Warum beides? Weil die Kurzbeschreibung schnell eingetippt ist und für den
 * Großteil der Räume genügt, während der Umriss den Bestand abbildet. Beim
 * Rechnen macht [Geometrie] daraus immer dasselbe: eine Liste von Ecken.
 *
 * [breiteM] und [tiefeM] werden auch bei gesetztem Umriss weitergeführt: Sie
 * beschreiben dann das umschließende Rechteck und werden für Lage, Einrasten
 * und Vorschau gebraucht.
 */
data class Raum(
    val id: UUID = UUID.randomUUID(),
    val name: String,
    /** Raumnummer am Türschild, z. B. „1.03". Leer, wenn keine vergeben ist. */
    val nummer: String = "",
    /** Geschoss: 0 = Erdgeschoss, negativ = Untergeschoss. */
    val geschoss: Int = 0,

    /** Breite der **hinteren** Wand (bei gesetztem Umriss: umschließendes Rechteck). */
    val breiteM: BigDecimal = BigDecimal("4"),
    /** Breite der **vorderen** Wand; `null` = wie hinten, also rechteckig. */
    val breiteVorneM: BigDecimal? = null,
    /** Tiefe von vorn nach hinten. */
    val tiefeM: BigDecimal = BigDecimal("4"),
    val schraege: Schraege = Schraege.KEINE,
    /** Frei erfasster Umriss als JSON, siehe Klassenkommentar. Leer = nicht gesetzt. */
    val umriss: String = "",

    /** Lichte Raumhöhe – bestimmt die Wandhöhe und die Lage der Geschosse. */
    val hoeheM: BigDecimal = BigDecimal("2.50"),

    /** Lage der linken oberen Ecke im Gebäudeplan. */
    val xM: BigDecimal = BigDecimal.ZERO,
    val yM: BigDecimal = BigDecimal.ZERO,
    /** Drehung im Plan, im Uhrzeigersinn um die Raummitte. */
    val drehungGrad: BigDecimal = BigDecimal.ZERO,

    val farbe: String = "#cfe8e9",
    val notiz: String = ""
)

// ------------------------------------------------------------ Öffnungen

enum class OeffnungsArt { TUER, DURCHGANG, FENSTER, TOR }

/**
 * Öffnung in einer Wand.
 *
 * Eine Tür gehört zur **Wand**, nicht zum Raum als Ganzes. Nur so entsteht
 * beim Zeichnen ein echtes Loch, durch das man gehen oder schauen kann – und
 * nur so weiß man, welche Wand betroffen ist.
 *
 * Die Wand wird über ihren Index angesprochen: Die Ecken eines Raumes sind im
 * Uhrzeigersinn nummeriert, Wand *i* verläuft von Ecke *i* zur nächsten. Bei
 * einem Viereck ist damit 0 = vorne, 1 = rechts, 2 = hinten, 3 = links; bei
 * einem freien Umriss zählt man einfach weiter.
 *
 * [abstandM] misst von Ecke *i* aus an der Wand entlang bis zur **linken
 * Kante** der Öffnung.
 */
data class Oeffnung(
    val id: UUID = UUID.randomUUID(),
    val raumId: UUID,
    val art: OeffnungsArt = OeffnungsArt.TUER,
    val bezeichnung: String = "",
    val wandIndex: Int = 0,
    val abstandM: BigDecimal = BigDecimal.ZERO,
    val breiteM: BigDecimal = BigDecimal("0.885"),
    val hoeheM: BigDecimal = BigDecimal("2.01"),
    /** Brüstungshöhe: 0 bei Türen, sonst Unterkante über dem Fußboden. */
    val bruestungM: BigDecimal = BigDecimal.ZERO,
    val notiz: String = ""
)

// ------------------------------------------------------------- Einbauten

/** Wie ein Einbau befestigt ist – daraus folgt, wo er sitzt. */
enum class Befestigung {
    /** Ohne Wandbezug, nur Lage im Grundriss über [Einbau.relX]/[Einbau.relY]. */
    FREI,

    /** An einer Wand: [Einbau.wandIndex], [Einbau.abstandM], [Einbau.hoeheM]. */
    WAND,

    /** An der Decke, Lage über [Einbau.relX]/[Einbau.relY]. */
    DECKE,

    /** Auf dem Fußboden stehend, Lage über [Einbau.relX]/[Einbau.relY]. */
    BODEN
}

/**
 * Ein Einbau im Raum: Steckdose, Schalter, Leuchte, Heizkörper …
 *
 * [art] ist bewusst ein `String` und kein `enum`: Welche Arten es gibt, ist
 * eine fachliche Festlegung, die sich je Projekt unterscheidet und die man
 * ohne Schemaänderung erweitern können muss. Der mitgelieferte Katalog steht
 * in [Normmasse.arten]; ein unbekannter Wert schadet nicht, er bekommt nur
 * keine Vorgabewerte.
 *
 * [relX]/[relY] sind Anteile (0…1) des umschließenden Rechtecks, nicht Meter.
 * Damit bleibt die Lage erhalten, wenn ein Raum nachträglich anders vermessen
 * wird.
 */
data class Einbau(
    val id: UUID = UUID.randomUUID(),
    val raumId: UUID,
    val art: String,
    val bezeichnung: String = "",
    val befestigung: Befestigung = Befestigung.FREI,
    val wandIndex: Int? = null,
    val abstandM: BigDecimal? = null,
    /** Höhe der Mitte über dem fertigen Fußboden. */
    val hoeheM: BigDecimal? = null,
    val relX: BigDecimal = BigDecimal("0.5"),
    val relY: BigDecimal = BigDecimal("0.5"),
    val notiz: String = ""
)
