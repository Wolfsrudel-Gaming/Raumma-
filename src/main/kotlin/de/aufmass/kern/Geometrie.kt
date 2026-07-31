package de.aufmass.kern

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Ein Punkt im **Raumkoordinatensystem**: Ursprung links oben, x nach rechts,
 * y nach hinten, Einheit Meter.
 *
 * y zeigt nach unten – wie in jedem Grundriss und in SVG. Das ist gewöhnungs-
 * bedürftig, wenn man aus der Mathematik kommt, macht aber alles einfacher:
 * Der Bildschirm, der ausgedruckte Plan und die gespeicherten Zahlen meinen
 * dasselbe, ohne dass irgendwo gespiegelt werden muss. Eine Drehung „nach
 * rechts" ist deshalb eine Drehung mit **positivem** Winkel.
 */
data class Punkt(val x: Double, val y: Double)

/**
 * Alles, was sich aus der Form eines Raumes ergibt.
 *
 * Alle Funktionen sind rein: gleicher Raum → gleiches Ergebnis, keine
 * Seiteneffekte, kein Zustand. Damit lassen sie sich in einem Web-Backend,
 * in einem Batch-Export oder in einem Test gleichermaßen verwenden.
 */
object Geometrie {

    // ------------------------------------------------------------ Umriss

    /**
     * Liest den frei erfassten Umriss aus [Raum.umriss].
     *
     * Erwartet wird `[[x,y],[x,y],…]`. Der Parser ist mit Absicht winzig und
     * ohne JSON-Bibliothek geschrieben: Das Paket soll sich ohne Abhängigkeiten
     * übernehmen lassen, und das Format ist eine reine Zahlenliste.
     *
     * **Nachsichtig**: Bei Unsinn kommt `null` zurück statt einer Ausnahme.
     * Ein Tippfehler in einem Feld darf keinen Raum unsichtbar machen – dann
     * gilt eben wieder die Kurzbeschreibung (Rechteck/Trapez).
     */
    fun umrissLesen(text: String): List<Punkt>? {
        if (text.isBlank()) return null
        val zahlen = Regex("-?\\d+(?:\\.\\d+)?").findAll(text)
            .mapNotNull { it.value.toDoubleOrNull() }.toList()
        if (zahlen.size < 6 || zahlen.size % 2 != 0) return null
        val punkte = zahlen.chunked(2).map { Punkt(it[0], it[1]) }
        return if (punkte.size >= 3) punkte else null
    }

    /** Schreibt Eckpunkte in das Format, das [umrissLesen] versteht. */
    fun umrissSchreiben(punkte: List<Punkt>): String =
        punkte.joinToString(",", "[", "]") { "[${runde(it.x)},${runde(it.y)}]" }

    private fun runde(v: Double) = Math.round(v * 100.0) / 100.0

    // ------------------------------------------------------------- Ecken

    /**
     * Von wo bis wo eine Wand der Länge [len] innerhalb der Gesamtbreite [w]
     * verläuft. Die schräge Seite bestimmt, wohin die kürzere Wand rückt: Ist
     * die *linke* Wand schräg, steht die rechte senkrecht – dann enden beide
     * Wände rechts bündig.
     */
    private fun spanne(len: Double, w: Double, s: Schraege): Pair<Double, Double> = when (s) {
        Schraege.LINKS -> (w - len) to w
        Schraege.BEIDSEITIG -> ((w - len) / 2) to ((w + len) / 2)
        else -> 0.0 to len            // RECHTS und KEINE: links bündig
    }

    /**
     * Eckpunkte des Raumes im Uhrzeigersinn.
     *
     * Ist ein Umriss erfasst, gilt er. Sonst entsteht aus Breite hinten,
     * Breite vorne und Tiefe ein Viereck: vorne links, vorne rechts, hinten
     * rechts, hinten links.
     */
    fun ecken(raum: Raum): List<Punkt> {
        umrissLesen(raum.umriss)?.let { return it }
        val hinten = raum.breiteM.toDouble()
        val vorne = raum.breiteVorneM?.toDouble() ?: hinten
        val tiefe = raum.tiefeM.toDouble()
        val w = max(hinten, vorne)
        val (vx0, vx1) = spanne(vorne, w, raum.schraege)
        val (hx0, hx1) = spanne(hinten, w, raum.schraege)
        return listOf(Punkt(vx0, 0.0), Punkt(vx1, 0.0), Punkt(hx1, tiefe), Punkt(hx0, tiefe))
    }

    /** Breite des umschließenden Rechtecks. */
    fun breite(raum: Raum): Double =
        umrissLesen(raum.umriss)?.maxOf { it.x }
            ?: max(raum.breiteM.toDouble(), raum.breiteVorneM?.toDouble() ?: raum.breiteM.toDouble())

    /** Tiefe des umschließenden Rechtecks. */
    fun tiefe(raum: Raum): Double =
        umrissLesen(raum.umriss)?.maxOf { it.y } ?: raum.tiefeM.toDouble()

    /**
     * Grundfläche in m².
     *
     * Für den freien Umriss die **Gaußsche Trapezformel** (Shoelace): Sie gilt
     * für jedes einfache Vieleck, also auch für Nischen und L-förmige Räume.
     * Breite × Tiefe wäre dort zu viel – und wer danach Bodenbelag bestellt,
     * kauft zu viel.
     *
     * Für die Kurzbeschreibung reicht die Trapezformel: Mittellinie × Tiefe.
     */
    fun flaecheM2(raum: Raum): Double {
        umrissLesen(raum.umriss)?.let { p ->
            var summe = 0.0
            for (i in p.indices) {
                val q = p[(i + 1) % p.size]
                summe += p[i].x * q.y - q.x * p[i].y
            }
            return abs(summe) / 2
        }
        val hinten = raum.breiteM.toDouble()
        val vorne = raum.breiteVorneM?.toDouble() ?: hinten
        return (hinten + vorne) / 2 * raum.tiefeM.toDouble()
    }

    /** Umfang in m – Summe aller Wandlängen. */
    fun umfangM(raum: Raum): Double = wandLaengen(raum).sum()

    /** Länge jeder einzelnen Wand, in der Reihenfolge der Ecken. */
    fun wandLaengen(raum: Raum): List<Double> {
        val p = ecken(raum)
        return p.indices.map { i ->
            val q = p[(i + 1) % p.size]
            hypot(q.x - p[i].x, q.y - p[i].y)
        }
    }

    /**
     * Name einer Wand für die Oberfläche. Bei einem Viereck sind die
     * Himmelsrichtungen des Raumes gemeint und leichter zu merken als Zahlen;
     * bei mehr Ecken wird schlicht durchgezählt.
     */
    fun wandName(raum: Raum, index: Int): String {
        val n = ecken(raum).size
        if (n == 4) return listOf("vorne", "rechts", "hinten", "links").getOrElse(index) { "Wand ${index + 1}" }
        return "Wand ${index + 1}"
    }

    // -------------------------------------------------------- Wandpunkte

    /** Anfangs- und Endpunkt einer Wand. */
    fun wand(raum: Raum, index: Int): Pair<Punkt, Punkt> {
        val p = ecken(raum)
        val i = ((index % p.size) + p.size) % p.size
        return p[i] to p[(i + 1) % p.size]
    }

    /** Punkt auf einer Wand, [abstand] Meter von ihrem Anfang entfernt. */
    fun punktAufWand(raum: Raum, index: Int, abstand: Double): Punkt {
        val (a, b) = wand(raum, index)
        val len = hypot(b.x - a.x, b.y - a.y)
        if (len < 1e-9) return a
        val t = abstand.coerceIn(0.0, len) / len
        return Punkt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    }

    /** Richtung einer Wand in Grad (0 = nach rechts, im Uhrzeigersinn wachsend). */
    fun wandWinkel(raum: Raum, index: Int): Double {
        val (a, b) = wand(raum, index)
        return Math.toDegrees(Math.atan2(b.y - a.y, b.x - a.x))
    }

    /** Ergebnis der Suche nach der nächstgelegenen Wand. */
    data class WandTreffer(val index: Int, val abstandAufWandM: Double, val entfernungM: Double)

    /**
     * Welche Wand liegt einem Punkt am nächsten, und an welcher Stelle?
     *
     * Gebraucht wird das beim Setzen: Wer eine Steckdose grob in die Nähe
     * einer Wand tippt, meint diese Wand. Ein Schalter schwebt nicht im Raum.
     */
    fun naechsteWand(raum: Raum, x: Double, y: Double): WandTreffer {
        val p = ecken(raum)
        var beste = WandTreffer(0, 0.0, Double.MAX_VALUE)
        for (i in p.indices) {
            val a = p[i]
            val b = p[(i + 1) % p.size]
            val dx = b.x - a.x
            val dy = b.y - a.y
            val l2 = dx * dx + dy * dy
            if (l2 < 1e-9) continue
            val t = (((x - a.x) * dx + (y - a.y) * dy) / l2).coerceIn(0.0, 1.0)
            val px = a.x + dx * t
            val py = a.y + dy * t
            val d = hypot(x - px, y - py)
            if (d < beste.entfernungM) beste = WandTreffer(i, t * Math.sqrt(l2), d)
        }
        return beste
    }

    /** Liegt ein Punkt im Raum? Strahlensatz-Verfahren, gilt für jedes Vieleck. */
    fun imRaum(raum: Raum, x: Double, y: Double): Boolean {
        val p = ecken(raum)
        var drin = false
        var j = p.size - 1
        for (i in p.indices) {
            if ((p[i].y > y) != (p[j].y > y) &&
                x < (p[j].x - p[i].x) * (y - p[i].y) / (p[j].y - p[i].y) + p[i].x
            ) drin = !drin
            j = i
        }
        return drin
    }

    // ------------------------------------------------ Wand mit Öffnungen

    /**
     * Ein Stück Wand, das tatsächlich gemauert ist.
     *
     * [vonM]/[bisM] laufen entlang der Wand, [untenM]/[obenM] über dem Fußboden.
     * Aus diesen Rechtecken baut ein Renderer die Wandscheiben – volle Wand
     * neben der Öffnung, Brüstung darunter, Sturz darüber.
     */
    data class WandStueck(
        val vonM: Double, val bisM: Double,
        val untenM: Double, val obenM: Double
    )

    /**
     * Zerlegt eine Wand in die Stücke, die nach Abzug der Öffnungen übrig
     * bleiben.
     *
     * Das ist der Kern dessen, was eine Tür von einem aufgemalten Symbol
     * unterscheidet: Ohne diese Zerlegung steht man im Modell vor einer
     * geschlossenen Fläche.
     *
     * Überlappende Öffnungen werden zusammengefasst; Öffnungen ausserhalb der
     * Wand werden auf sie begrenzt. Beides kommt bei getippten Werten vor und
     * darf nicht zu Wandstücken mit negativer Länge führen.
     */
    fun wandStuecke(
        raum: Raum,
        wandIndex: Int,
        oeffnungen: List<Oeffnung>
    ): List<WandStueck> {
        val laenge = wandLaengen(raum).getOrElse(wandIndex) { 0.0 }
        val hoehe = raum.hoeheM.toDouble()
        if (laenge <= 0.0 || hoehe <= 0.0) return emptyList()

        val loecher = oeffnungen
            .filter { it.raumId == raum.id && it.wandIndex == wandIndex }
            .map {
                val von = it.abstandM.toDouble().coerceIn(0.0, laenge)
                val bis = (it.abstandM.toDouble() + it.breiteM.toDouble()).coerceIn(0.0, laenge)
                Triple(von, bis, it)
            }
            .filter { it.second > it.first }
            .sortedBy { it.first }

        val stuecke = mutableListOf<WandStueck>()
        var t = 0.0
        for ((von, bis, o) in loecher) {
            if (von > t) stuecke += WandStueck(t, von, 0.0, hoehe)
            val bruestung = min(o.bruestungM.toDouble(), hoehe)
            val sturz = min(o.bruestungM.toDouble() + o.hoeheM.toDouble(), hoehe)
            if (bruestung > 0.0) stuecke += WandStueck(von, bis, 0.0, bruestung)
            if (sturz < hoehe) stuecke += WandStueck(von, bis, sturz, hoehe)
            t = max(t, bis)
        }
        if (t < laenge) stuecke += WandStueck(t, laenge, 0.0, hoehe)
        return stuecke
    }

    // ------------------------------------------------------ Lage im Plan

    /**
     * Wo sitzt ein Einbau im Raumkoordinatensystem, und wie ist er gedreht?
     *
     * An der Wand: auf der Wandlinie, [abrueckenM] in Richtung Raummitte
     * versetzt, damit das Symbol neben der Wand steht und nicht in ihr. Der
     * Winkel ist die Wandrichtung – daran erkennt man im Plan, zu welcher
     * Wand ein Gerät gehört.
     */
    data class Lage(val x: Double, val y: Double, val winkelGrad: Double)

    fun lageImRaum(raum: Raum, einbau: Einbau, abrueckenM: Double = 0.04): Lage {
        if (einbau.befestigung == Befestigung.WAND && einbau.wandIndex != null) {
            val p = punktAufWand(raum, einbau.wandIndex, einbau.abstandM?.toDouble() ?: 0.0)
            val (a, b) = wand(raum, einbau.wandIndex)
            val dx = b.x - a.x
            val dy = b.y - a.y
            val len = hypot(dx, dy).takeIf { it > 1e-9 } ?: 1.0
            // Senkrecht zur Wand abrücken, nicht in Richtung Raummitte: Sonst
            // wandert das Gerät auch ein Stück *an der Wand entlang* und sitzt
            // nicht mehr dort, wo es gemessen wurde. Welche der beiden
            // Senkrechten in den Raum zeigt, entscheidet der Schwerpunkt.
            val e = ecken(raum)
            val mx = e.sumOf { it.x } / e.size
            val my = e.sumOf { it.y } / e.size
            var nx = -dy / len
            var ny = dx / len
            if ((mx - p.x) * nx + (my - p.y) * ny < 0) { nx = -nx; ny = -ny }
            return Lage(
                p.x + nx * abrueckenM,
                p.y + ny * abrueckenM,
                wandWinkel(raum, einbau.wandIndex)
            )
        }
        return Lage(
            einbau.relX.toDouble() * breite(raum),
            einbau.relY.toDouble() * tiefe(raum),
            0.0
        )
    }

    /**
     * Höhe über dem Fußboden, mit der ein Einbau zu zeichnen ist – auch dann,
     * wenn keine erfasst wurde.
     */
    fun hoeheUeberBoden(raum: Raum, einbau: Einbau): Double {
        einbau.hoeheM?.let { return it.toDouble() }
        return when (einbau.befestigung) {
            Befestigung.DECKE -> raum.hoeheM.toDouble()
            Befestigung.BODEN -> 0.0
            else -> Normmasse.hoehe(einbau.art)?.toDouble() ?: 1.20
        }
    }
}
