package de.aufmass.kern

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs

/**
 * Wo liegt ein Raum im Gebäude?
 *
 * Vor Ort kennt niemand Koordinaten, wohl aber die Nachbarschaft: „der
 * Lagerraum liegt hinter der Küche". Genau das wird hier gerechnet, damit auf
 * einem Tablet nicht mit dem Finger geschoben werden muss, bis zwei Wände
 * zufällig aufeinandertreffen.
 *
 * Ergänzend gibt es das Einrasten beim Ziehen: Kanten springen auf benachbarte
 * Kanten, sobald sie nahe genug sind.
 */
object Platzierung {

    /** Auf welcher Seite des Nachbarn der Raum liegt. */
    enum class Seite { LINKS, RECHTS, DAVOR, DAHINTER }

    /**
     * Wie die beiden Räume an der gemeinsamen Wand zueinander stehen.
     *
     * (Der Name ist bewusst ohne Umlaut geschrieben: Klassennamen werden zu
     * Dateinamen, und die überleben nicht jedes Dateisystem und jede
     * Build-Umgebung unbeschadet. In Kommentaren und Texten sind Umlaute
     * dagegen willkommen.)
     */
    enum class Buendig { ANFANG, MITTE, ENDE }

    /**
     * Setzt [raum] an [nachbar] an und gibt die neue Lage zurück.
     *
     * [fugeM] ist der Abstand zwischen den Räumen – etwa für eine
     * Zwischenwand, die im Modell nicht eigens erfasst ist.
     */
    fun anlegen(
        raum: Raum,
        nachbar: Raum,
        seite: Seite,
        buendig: Buendig = Buendig.ANFANG,
        fugeM: Double = 0.0
    ): Raum {
        val rb = Geometrie.breite(raum)
        val rt = Geometrie.tiefe(raum)
        val nb = Geometrie.breite(nachbar)
        val nt = Geometrie.tiefe(nachbar)
        val nx = nachbar.xM.toDouble()
        val ny = nachbar.yM.toDouble()
        val fuge = fugeM.coerceIn(0.0, 5.0)

        fun laengs(eigen: Double, fremd: Double, start: Double) = when (buendig) {
            Buendig.ANFANG -> start
            Buendig.MITTE -> start + (fremd - eigen) / 2
            Buendig.ENDE -> start + fremd - eigen
        }

        val (x, y) = when (seite) {
            Seite.RECHTS -> (nx + nb + fuge) to laengs(rt, nt, ny)
            Seite.LINKS -> (nx - rb - fuge) to laengs(rt, nt, ny)
            Seite.DAHINTER -> laengs(rb, nb, nx) to (ny + nt + fuge)
            Seite.DAVOR -> laengs(rb, nb, nx) to (ny - rt - fuge)
        }
        // Negative Koordinaten würden den Plan links oben abschneiden.
        return raum.copy(
            xM = BigDecimal(maxOf(0.0, x)).setScale(2, RoundingMode.HALF_UP),
            yM = BigDecimal(maxOf(0.0, y)).setScale(2, RoundingMode.HALF_UP)
        )
    }

    /**
     * Rastet eine gezogene Lage an den Kanten der übrigen Räume ein.
     *
     * [fangM] ist der Fangbereich – eine Handbreit ist ein guter Wert: groß
     * genug, um mit dem Finger zu treffen, klein genug, um eine gewollte Fuge
     * nicht wegzuschnappen. Ohne Nachbarn in Reichweite bleibt das Raster.
     */
    fun einrasten(
        raum: Raum,
        xM: Double,
        yM: Double,
        andere: List<Raum>,
        rasterM: Double = 0.25,
        fangM: Double = 0.35
    ): Pair<Double, Double> {
        var x = Math.round(xM / rasterM) * rasterM
        var y = Math.round(yM / rasterM) * rasterM
        val b = Geometrie.breite(raum)
        val t = Geometrie.tiefe(raum)
        for (o in andere) {
            if (o.id == raum.id || o.geschoss != raum.geschoss) continue
            val ox = o.xM.toDouble()
            val oy = o.yM.toDouble()
            val ob = Geometrie.breite(o)
            val ot = Geometrie.tiefe(o)
            // Jede eigene Kante gegen jede fremde Kante prüfen: bündig links,
            // bündig rechts, sowie Anstoßen von beiden Seiten.
            for ((eigen, fremd) in listOf(0.0 to 0.0, 0.0 to ob, b to 0.0, b to ob)) {
                val kandidat = ox + fremd - eigen
                if (abs(xM - kandidat) < fangM) x = kandidat
            }
            for ((eigen, fremd) in listOf(0.0 to 0.0, 0.0 to ot, t to 0.0, t to ot)) {
                val kandidat = oy + fremd - eigen
                if (abs(yM - kandidat) < fangM) y = kandidat
            }
        }
        return maxOf(0.0, Math.round(x * 100.0) / 100.0) to
            maxOf(0.0, Math.round(y * 100.0) / 100.0)
    }

    /**
     * Höhenlage der Geschosse: Jedes Geschoss beginnt über dem höchsten Raum
     * des darunterliegenden, plus Decke.
     *
     * Damit stapeln sich Geschosse ohne weitere Eingabe richtig – und wer nur
     * ein Erdgeschoss erfasst hat, merkt von der Rechnung nichts.
     */
    fun geschossBasis(raeume: List<Raum>, deckeM: Double = 0.30): Map<Int, Double> {
        if (raeume.isEmpty()) return emptyMap()
        val hoeheJe = raeume.groupBy { it.geschoss }
            .mapValues { (_, r) -> r.maxOf { it.hoeheM.toDouble() } }
        val basis = mutableMapOf<Int, Double>()
        var oben = 0.0
        hoeheJe.keys.filter { it >= 0 }.sorted().forEach {
            basis[it] = oben
            oben += hoeheJe.getValue(it) + deckeM
        }
        var unten = 0.0
        hoeheJe.keys.filter { it < 0 }.sortedDescending().forEach {
            unten -= hoeheJe.getValue(it) + deckeM
            basis[it] = unten
        }
        return basis
    }
}
