package de.aufmass.kern

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Aus Messwerten wird eine Raumform.
 *
 * Hier steckt der Unterschied zwischen einem Zeichenprogramm und einem
 * Aufmaßsystem: Niemand kennt vor Ort die Koordinaten einer Ecke. Man kennt
 * Wandlängen und Abbiegungen – und die Frage, ob am Ende alles zusammenpasst.
 */
object Aufmass {

    /**
     * Eine Wand im Aufmaß: ihre Länge und die Drehung an der Ecke **danach**.
     *
     * Positive Drehung = nach rechts (im Uhrzeigersinn, wie man im Grundriss
     * schaut). Übliche Werte sind ±90°, an einer Nische auch mal beides
     * hintereinander. Alles andere ist erlaubt – schiefe Wände gibt es.
     */
    data class Wand(val laengeM: Double, val drehungGrad: Double)

    /**
     * Ergebnis eines Polygonzugs.
     *
     * [restlueckeM] ist die Entfernung zwischen letztem und erstem Punkt. Sie
     * ist die eigentliche Qualitätsaussage des Aufmaßes: Ein Zug, der sich
     * nicht schließt, enthält einen Messfehler. Wir schließen ihn trotzdem –
     * aber nicht stillschweigend, sondern mit der Zahl daneben.
     */
    data class Zug(
        val punkte: List<Punkt>,
        val restlueckeM: Double,
        /** true, wenn die letzte Wand ergänzt wurde, statt gemessen zu sein. */
        val schlusswandErgaenzt: Boolean
    ) {
        val geschlossen: Boolean get() = restlueckeM < 0.02
    }

    /**
     * Rechnet einen Polygonzug in Eckpunkte um.
     *
     * Start ist (0,0) mit Blickrichtung nach rechts. Nach jeder Wand wird um
     * ihren Winkel gedreht. Fällt der Endpunkt auf den Anfang, ist der Zug
     * geschlossen und der doppelte Punkt entfällt; sonst wird die Lücke als
     * Schlusswand aufgefasst.
     *
     * Die Punkte werden anschließend so verschoben, dass sie bei (0,0)
     * beginnen und auf Zentimeter gerundet sind – das ist genauer, als jedes
     * Bandmaß ablesbar ist, und hält die Zahlen lesbar.
     */
    fun zug(waende: List<Wand>): Zug {
        require(waende.size >= 3) { "Ein Raum braucht mindestens drei Wände" }
        var x = 0.0
        var y = 0.0
        var richtung = 0.0
        val roh = mutableListOf(Punkt(0.0, 0.0))
        for (w in waende) {
            val bogen = Math.toRadians(richtung)
            x += w.laengeM * cos(bogen)
            y += w.laengeM * sin(bogen)
            roh += Punkt(x, y)
            richtung += w.drehungGrad
        }
        val luecke = hypot(roh.last().x - roh.first().x, roh.last().y - roh.first().y)
        val geschlossen = luecke < 0.02
        val punkte = if (geschlossen) roh.dropLast(1) else roh.toList()
        return Zug(normieren(punkte), luecke, !geschlossen)
    }

    /** Verschiebt einen Umriss auf den Nullpunkt und rundet auf Zentimeter. */
    fun normieren(punkte: List<Punkt>): List<Punkt> {
        if (punkte.isEmpty()) return punkte
        val minX = punkte.minOf { it.x }
        val minY = punkte.minOf { it.y }
        return punkte.map {
            Punkt(
                Math.round((it.x - minX) * 100.0) / 100.0,
                Math.round((it.y - minY) * 100.0) / 100.0
            )
        }
    }

    /**
     * Der umgekehrte Weg: aus einem vorhandenen Umriss die Wandliste.
     *
     * Damit lässt sich ein Raum, der als Rechteck angelegt wurde, nachträglich
     * Wand für Wand bearbeiten – ohne ihn neu aufnehmen zu müssen.
     */
    fun waende(punkte: List<Punkt>): List<Wand> {
        val n = punkte.size
        require(n >= 3) { "Ein Umriss braucht mindestens drei Ecken" }
        return (0 until n).map { i ->
            val a = punkte[i]
            val b = punkte[(i + 1) % n]
            val c = punkte[(i + 2) % n]
            val laenge = hypot(b.x - a.x, b.y - a.y)
            var drehung = Math.toDegrees(
                Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
            )
            while (drehung > 180) drehung -= 360
            while (drehung <= -180) drehung += 360
            Wand(
                Math.round(laenge * 100.0) / 100.0,
                Math.round(drehung * 10.0) / 10.0
            )
        }
    }

    /**
     * Prüft einen Umriss auf die Fehler, die beim Tippen entstehen.
     *
     * Bewusst **keine** Ausnahme, sondern eine Liste von Hinweisen: Ein
     * Aufmaßsystem soll melden, was auffällt, und den Menschen entscheiden
     * lassen. Ein Raum mit einer 2-cm-Wand ist meistens ein Tippfehler –
     * aber eben nur meistens.
     */
    fun pruefen(punkte: List<Punkt>): List<String> {
        val hinweise = mutableListOf<String>()
        if (punkte.size < 3) return listOf("Weniger als drei Ecken – daraus wird kein Raum.")
        val laengen = punkte.indices.map { i ->
            val q = punkte[(i + 1) % punkte.size]
            hypot(q.x - punkte[i].x, q.y - punkte[i].y)
        }
        laengen.forEachIndexed { i, l ->
            if (l < 0.05) hinweise += "Wand ${i + 1} ist nur ${zentimeter(l)} lang – Tippfehler?"
        }
        if (laengen.sum() > 500) hinweise += "Umfang über 500 m – stimmt die Einheit (Meter)?"
        val flaeche = flaeche(punkte)
        if (flaeche < 0.5) hinweise += "Fläche unter 0,5 m² – der Zug ist vermutlich in sich verdreht."
        if (schneidetSichSelbst(punkte)) hinweise +=
            "Die Wände kreuzen sich. Das ergibt keinen begehbaren Raum – meist ist eine " +
                "Drehung falsch herum eingetragen."
        return hinweise
    }

    private fun zentimeter(m: Double) = "${Math.round(m * 100)} cm"

    /** Gaußsche Trapezformel – auch hier, damit [pruefen] ohne Raum auskommt. */
    fun flaeche(punkte: List<Punkt>): Double {
        var summe = 0.0
        for (i in punkte.indices) {
            val q = punkte[(i + 1) % punkte.size]
            summe += punkte[i].x * q.y - q.x * punkte[i].y
        }
        return abs(summe) / 2
    }

    /**
     * Kreuzen sich zwei nicht benachbarte Wände? Dann ist das Vieleck nicht
     * einfach, und Fläche wie Darstellung wären Unsinn.
     */
    fun schneidetSichSelbst(punkte: List<Punkt>): Boolean {
        val n = punkte.size
        for (i in 0 until n) {
            for (j in i + 1 until n) {
                if (j == i || (j + 1) % n == i || (i + 1) % n == j) continue
                if (schneiden(
                        punkte[i], punkte[(i + 1) % n],
                        punkte[j], punkte[(j + 1) % n]
                    )
                ) return true
            }
        }
        return false
    }

    private fun schneiden(a: Punkt, b: Punkt, c: Punkt, d: Punkt): Boolean {
        fun rich(p: Punkt, q: Punkt, r: Punkt): Int {
            val v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
            return if (abs(v) < 1e-9) 0 else if (v > 0) 1 else 2
        }
        return rich(a, b, c) != rich(a, b, d) && rich(c, d, a) != rich(c, d, b)
    }

    // ------------------------------------------------- Aufmaßliste (Text)

    /** Ein aus einer Textzeile gelesener Raum. */
    data class ZeilenRaum(
        val nummer: String,
        val name: String,
        val breiteVorneM: Double?,
        val breiteM: Double,
        val tiefeM: Double,
        val schraege: Schraege
    )

    /**
     * Liest Raumzeilen so, wie sie beim Aufmaß auf dem Block entstehen.
     *
     * Erlaubt ist alles, was man ohnehin schreibt:
     * ```
     * 0.01; Flur; 2 x 8
     * 0.02; Schulungsraum; 4/6 x 5 rechts
     * Küche; 3,5 × 4
     * # Kommentarzeile
     * ```
     * `4/6 x 5` heißt: vorne 4 m, hinten 6 m, 5 m tief. Das Wort dahinter sagt,
     * auf welcher Seite die schräge Wand sitzt (Vorgabe: rechts).
     *
     * Für alles Kompliziertere ist der Polygonzug da – diese Kurzform soll den
     * Normalfall in einem Rutsch erfassen, nicht jeden Sonderfall abdecken.
     */
    fun zeileLesen(zeile: String): ZeilenRaum? {
        val roh = zeile.trim()
        if (roh.isEmpty() || roh.startsWith("#")) return null
        val teile = roh.split(';').map { it.trim() }
        val masse = teile.last()
        val name = if (teile.size >= 2) teile[teile.size - 2] else ""
        val nummer = if (teile.size >= 3) teile[teile.size - 3] else ""
        if (name.isBlank()) return null

        val norm = masse.replace('×', 'x').replace('*', 'x').lowercase()
        val schraege = when {
            "links" in norm -> Schraege.LINKS
            "beidseitig" in norm || "mittig" in norm -> Schraege.BEIDSEITIG
            else -> Schraege.RECHTS
        }
        val treffer = Regex(
            """([0-9]+(?:[.,][0-9]+)?(?:\s*/\s*[0-9]+(?:[.,][0-9]+)?)?)\s*x\s*([0-9]+(?:[.,][0-9]+)?)"""
        ).find(norm) ?: return null
        val tiefe = zahl(treffer.groupValues[2]) ?: return null
        val breiten = treffer.groupValues[1].split('/').mapNotNull { zahl(it) }
        return when (breiten.size) {
            1 -> ZeilenRaum(nummer, name, null, breiten[0], tiefe, Schraege.KEINE)
            2 -> ZeilenRaum(nummer, name, breiten[0], breiten[1], tiefe, schraege)
            else -> null
        }
    }

    fun listeLesen(text: String): List<ZeilenRaum> = text.lines().mapNotNull { zeileLesen(it) }

    private fun zahl(s: String): Double? = s.trim().replace(',', '.').toDoubleOrNull()
}
